const db = require('./db');
const { getImageInfo } = require('./images');
const { schedulePod } = require('./scheduler');
const { evaluateHPAs } = require('./hpa');
const { recordEvent } = require('./events');

let isReconciling = false;
let tickCounter = 0;

function generatePodName(deploymentName) {
  const rand = Math.random().toString(36).substring(2, 7);
  return `${deploymentName}-${rand}`;
}

async function runReconcileCycle() {
  if (isReconciling) {
    return;
  }
  isReconciling = true;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    tickCounter++;
    const now = Date.now();

    // 1. Fetch current cluster state
    const nodesRes = await client.query('SELECT * FROM nodes ORDER BY id ASC');
    const nodes = nodesRes.rows;

    const deploymentsRes = await client.query('SELECT * FROM deployments ORDER BY id ASC');
    const deployments = deploymentsRes.rows;

    const podsRes = await client.query('SELECT * FROM pods ORDER BY id ASC');
    const pods = podsRes.rows;

    // 2. Node Failure Detection & Pod Relocation
    for (const node of nodes) {
      if (node.status === 'NotReady') {
        const nodePods = pods.filter(p => p.node_id === node.id && p.status !== 'Terminating');
        for (const p of nodePods) {
          if (p.status !== 'Unknown') {
            await client.query(
              `UPDATE pods 
               SET status = 'Unknown', is_ready = false, node_failed_at = CURRENT_TIMESTAMP, state_entered_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [p.id]
            );
            await recordEvent(client, {
              type: 'Warning',
              reason: 'NodeNotReady',
              objectKind: 'Pod',
              objectName: p.name,
              message: `Node ${node.name} is NotReady; pod marked Unknown`
            });
            p.status = 'Unknown';
            p.node_failed_at = new Date();
          } else if (p.node_failed_at) {
            const timeSinceFailed = now - new Date(p.node_failed_at).getTime();
            if (timeSinceFailed >= 5000) {
              // Grace period expired (5s) -> Delete pod so controller can reschedule on another node
              await client.query('DELETE FROM pods WHERE id = $1', [p.id]);
              await recordEvent(client, {
                type: 'Warning',
                reason: 'NodeLost',
                objectKind: 'Pod',
                objectName: p.name,
                message: `Evicting pod ${p.name} from failed node ${node.name}`
              });
              // Remove from in-memory array
              const idx = pods.findIndex(item => item.id === p.id);
              if (idx !== -1) pods.splice(idx, 1);
            }
          }
        }
      }
    }

    // 3. Pod Lifecycle Transitions
    for (const pod of [...pods]) {
      const stateEnteredMs = new Date(pod.state_entered_at).getTime();
      const imgInfo = getImageInfo(pod.image);

      if (pod.status === 'Terminating') {
        const termMs = pod.terminating_since ? new Date(pod.terminating_since).getTime() : stateEnteredMs;
        if (now - termMs >= 2000) {
          await client.query('DELETE FROM pods WHERE id = $1', [pod.id]);
          await recordEvent(client, {
            type: 'Normal',
            reason: 'Killing',
            objectKind: 'Pod',
            objectName: pod.name,
            message: `Stopping container ${pod.name}`
          });
          const idx = pods.findIndex(p => p.id === pod.id);
          if (idx !== -1) pods.splice(idx, 1);
        }
      } else if (pod.status === 'ContainerCreating') {
        if (now - stateEnteredMs >= 2000) {
          await client.query(
            `UPDATE pods 
             SET status = 'Running', state_entered_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [pod.id]
          );
          await recordEvent(client, {
            type: 'Normal',
            reason: 'Pulled',
            objectKind: 'Pod',
            objectName: pod.name,
            message: `Successfully pulled image "${pod.image}"`
          });
          await recordEvent(client, {
            type: 'Normal',
            reason: 'Started',
            objectKind: 'Pod',
            objectName: pod.name,
            message: `Started container ${pod.name}`
          });
          pod.status = 'Running';
          pod.state_entered_at = new Date();
        }
      } else if (pod.status === 'Running') {
        if (imgInfo.crashes) {
          // Crashes after crashDelaySeconds
          if (now - stateEnteredMs >= imgInfo.crashDelaySeconds * 1000) {
            const nextRestartCount = pod.restart_count + 1;
            const nextBackoffCount = pod.backoff_count + 1;
            const backoffSeconds = Math.min(30, Math.pow(2, nextBackoffCount));
            const backoffUntil = new Date(now + backoffSeconds * 1000);

            await client.query(
              `UPDATE pods 
               SET status = 'CrashLoopBackOff', 
                   is_ready = false, 
                   restart_count = $1, 
                   backoff_count = $2, 
                   backoff_until = $3, 
                   state_entered_at = CURRENT_TIMESTAMP 
               WHERE id = $4`,
              [nextRestartCount, nextBackoffCount, backoffUntil, pod.id]
            );

            await recordEvent(client, {
              type: 'Warning',
              reason: 'BackOff',
              objectKind: 'Pod',
              objectName: pod.name,
              message: `Back-off restarting failed container ${pod.name} in pod ${pod.name}_default (delay: ${backoffSeconds}s)`
            });

            pod.status = 'CrashLoopBackOff';
            pod.is_ready = false;
            pod.restart_count = nextRestartCount;
            pod.backoff_count = nextBackoffCount;
            pod.backoff_until = backoffUntil;
            pod.state_entered_at = new Date();
          }
        } else {
          // Becomes ready after readyDelaySeconds
          if (!pod.is_ready && (now - stateEnteredMs >= imgInfo.readyDelaySeconds * 1000)) {
            await client.query(
              `UPDATE pods 
               SET status = 'Ready', is_ready = true, state_entered_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [pod.id]
            );
            pod.status = 'Ready';
            pod.is_ready = true;
            pod.state_entered_at = new Date();
          }
        }
      } else if (pod.status === 'CrashLoopBackOff') {
        if (pod.backoff_until && now >= new Date(pod.backoff_until).getTime()) {
          // Backoff timer expired -> try starting again
          await client.query(
            `UPDATE pods 
             SET status = 'ContainerCreating', state_entered_at = CURRENT_TIMESTAMP, backoff_until = NULL
             WHERE id = $1`,
            [pod.id]
          );
          pod.status = 'ContainerCreating';
          pod.state_entered_at = new Date();
          pod.backoff_until = null;
        }
      }
    }

    // 4. Deployment Rolling Updates & Replicas Management
    for (const dep of deployments) {
      const depPods = pods.filter(p => p.deployment_id === dep.id && p.status !== 'Terminating');
      const currentRev = dep.current_revision;

      // Fetch active revision record
      const revRes = await client.query(
        'SELECT id FROM deployment_revisions WHERE deployment_id = $1 AND revision_number = $2',
        [dep.id, currentRev]
      );
      const currentRevId = revRes.rows.length > 0 ? revRes.rows[0].id : null;

      const newPods = depPods.filter(p => p.revision_id === currentRevId);
      const oldPods = depPods.filter(p => p.revision_id !== currentRevId);

      const desired = dep.replicas;
      const maxSurge = dep.max_surge !== undefined ? dep.max_surge : 1;
      const maxUnavailable = dep.max_unavailable !== undefined ? dep.max_unavailable : 0;
      const minReadyReplicas = Math.max(0, desired - maxUnavailable);
      const maxTotalPods = desired + maxSurge;

      const readyNewPods = newPods.filter(p => p.is_ready).length;
      const readyOldPods = oldPods.filter(p => p.is_ready).length;
      const totalReadyPods = readyNewPods + readyOldPods;
      const totalActivePods = newPods.length + oldPods.length;

      // Check rollout deadline timeout (30 seconds)
      if (oldPods.length > 0 || (newPods.length > 0 && readyNewPods < desired)) {
        if (dep.rollout_started_at) {
          const rolloutElapsed = now - new Date(dep.rollout_started_at).getTime();
          if (rolloutElapsed >= 30000 && readyNewPods < desired) {
            if (dep.rollout_status !== 'Stalled') {
              await client.query(
                `UPDATE deployments SET rollout_status = 'Stalled' WHERE id = $1`,
                [dep.id]
              );
              await recordEvent(client, {
                type: 'Warning',
                reason: 'RolloutStalled',
                objectKind: 'Deployment',
                objectName: dep.name,
                message: `Deployment ${dep.name} rollout stalled: ProgressDeadlineExceeded (new pods failed to become ready within 30s)`
              });
              dep.rollout_status = 'Stalled';
            }
          }
        }
      }

      if (dep.is_paused) {
        if (dep.rollout_status !== 'Paused') {
          await client.query(`UPDATE deployments SET rollout_status = 'Paused' WHERE id = $1`, [dep.id]);
          dep.rollout_status = 'Paused';
        }
        continue;
      }

      // Rollout or Scaling Actions
      if (oldPods.length > 0) {
        // We are in an active rolling update!
        if (dep.rollout_status !== 'Progressing' && dep.rollout_status !== 'Stalled') {
          await client.query(`UPDATE deployments SET rollout_status = 'Progressing' WHERE id = $1`, [dep.id]);
          dep.rollout_status = 'Progressing';
        }

        // 1. Can we create a new pod without exceeding maxTotalPods?
        if (totalActivePods < maxTotalPods && newPods.length < desired) {
          const podName = generatePodName(dep.name);
          const insertPod = await client.query(
            `INSERT INTO pods (name, namespace, deployment_id, revision_id, image, cpu_request, memory_request, status, is_ready)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', false)
             RETURNING *`,
            [podName, dep.namespace, dep.id, currentRevId, dep.image, dep.cpu_request, dep.memory_request]
          );
          pods.push(insertPod.rows[0]);
          newPods.push(insertPod.rows[0]);
        }

        // 2. Can we terminate an old pod without violating maxUnavailable?
        // Terminate an unready old pod immediately
        let terminatedOne = false;
        const unreadyOldPod = oldPods.find(p => !p.is_ready);
        if (unreadyOldPod) {
          await client.query(
            `UPDATE pods SET status = 'Terminating', terminating_since = CURRENT_TIMESTAMP WHERE id = $1`,
            [unreadyOldPod.id]
          );
          unreadyOldPod.status = 'Terminating';
          terminatedOne = true;
        } else if (totalReadyPods > minReadyReplicas && oldPods.length > 0) {
          // An old pod is ready, but terminating it keeps totalReadyPods >= minReadyReplicas
          const oldPodToKill = oldPods[0];
          await client.query(
            `UPDATE pods SET status = 'Terminating', is_ready = false, terminating_since = CURRENT_TIMESTAMP WHERE id = $1`,
            [oldPodToKill.id]
          );
          oldPodToKill.status = 'Terminating';
          oldPodToKill.is_ready = false;
          const oIdx = oldPods.findIndex(p => p.id === oldPodToKill.id);
          if (oIdx !== -1) oldPods.splice(oIdx, 1);
          terminatedOne = true;
        }
      } else {
        // No old pods -> Standard Replica Scaling
        if (newPods.length < desired) {
          const podName = generatePodName(dep.name);
          const insertPod = await client.query(
            `INSERT INTO pods (name, namespace, deployment_id, revision_id, image, cpu_request, memory_request, status, is_ready)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', false)
             RETURNING *`,
            [podName, dep.namespace, dep.id, currentRevId, dep.image, dep.cpu_request, dep.memory_request]
          );
          pods.push(insertPod.rows[0]);
          newPods.push(insertPod.rows[0]);
        } else if (newPods.length > desired) {
          // Terminate excess pod (prefer unready or newest)
          const podToKill = newPods.find(p => !p.is_ready) || newPods[newPods.length - 1];
          await client.query(
            `UPDATE pods SET status = 'Terminating', terminating_since = CURRENT_TIMESTAMP WHERE id = $1`,
            [podToKill.id]
          );
          podToKill.status = 'Terminating';
          const pIdx = newPods.findIndex(p => p.id === podToKill.id);
          if (pIdx !== -1) newPods.splice(pIdx, 1);
        }

        // Check if rollout is completed
        if (newPods.length === desired && newPods.every(p => p.is_ready)) {
          if (dep.rollout_status !== 'Complete') {
            await client.query(
              `UPDATE deployments SET rollout_status = 'Complete', rollout_started_at = NULL WHERE id = $1`,
              [dep.id]
            );
            await recordEvent(client, {
              type: 'Normal',
              reason: 'ScalingReplicaSet',
              objectKind: 'Deployment',
              objectName: dep.name,
              message: `Scaled up replica set ${dep.name} to ${desired}`
            });
            dep.rollout_status = 'Complete';
          }
        }
      }
    }

    // 5. Scheduler: Schedule any Pending Pods
    const nodeAllocations = new Map();
    for (const n of nodes) {
      nodeAllocations.set(n.id, { cpu: 0, mem: 0 });
    }
    for (const p of pods) {
      if (p.node_id && p.status !== 'Terminating') {
        const alloc = nodeAllocations.get(p.node_id) || { cpu: 0, mem: 0 };
        alloc.cpu += p.cpu_request;
        alloc.mem += p.memory_request;
        nodeAllocations.set(p.node_id, alloc);
      }
    }

    const pendingPods = pods.filter(p => p.status === 'Pending' && !p.node_id);
    for (const pod of pendingPods) {
      await schedulePod(client, pod, nodes, nodeAllocations);
    }

    // 6. HPA Evaluation every 5 ticks
    if (tickCounter % 5 === 0) {
      await evaluateHPAs(client);
    }

    // 7. Metrics Snapshot every 2 ticks (keep last 300)
    if (tickCounter % 2 === 0) {
      const podsRunning = pods.filter(p => p.status === 'Running').length;
      const podsPending = pods.filter(p => p.status === 'Pending').length;
      const podsReady = pods.filter(p => p.is_ready).length;
      const podsFailing = pods.filter(p => p.status === 'CrashLoopBackOff' || p.status === 'Unknown').length;

      let cpuRequested = 0;
      let memoryRequested = 0;
      pods.forEach(p => {
        if (p.status !== 'Terminating') {
          cpuRequested += p.cpu_request;
          memoryRequested += p.memory_request;
        }
      });

      const readyNodes = nodes.filter(n => n.status === 'Ready').length;
      const totalNodes = nodes.length;

      await client.query(
        `INSERT INTO metrics_history 
         (pods_running, pods_pending, pods_ready, pods_failing, cpu_requested, memory_requested, ready_nodes, total_nodes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [podsRunning, podsPending, podsReady, podsFailing, cpuRequested, memoryRequested, readyNodes, totalNodes]
      );

      await client.query(
        `DELETE FROM metrics_history 
         WHERE id NOT IN (
           SELECT id FROM metrics_history ORDER BY created_at DESC, id DESC LIMIT 300
         )`
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reconcile cycle error:', err);
  } finally {
    client.release();
    isReconciling = false;
  }
}

let tickerInterval = null;

function startController(tickMs = 1000) {
  if (tickerInterval) clearInterval(tickerInterval);
  tickerInterval = setInterval(runReconcileCycle, tickMs);
  console.log(`Controller loop started (interval: ${tickMs}ms)`);
}

function stopController() {
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
}

module.exports = {
  runReconcileCycle,
  startController,
  stopController
};
