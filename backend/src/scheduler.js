const db = require('./db');
const { recordEvent } = require('./events');

/**
 * Attempt to schedule a single pending pod onto the best available node.
 * Filter: Ready, not cordoned, free_cpu >= req, free_mem >= req.
 * Score: Least-allocated (lowest allocated percentage after placement).
 */
async function schedulePod(client, pod, nodes, nodeAllocations) {
  const readyNodes = nodes.filter(n => n.status === 'Ready' && !n.is_cordoned);

  const candidates = [];
  let reason = 'Insufficient cpu';

  for (const node of readyNodes) {
    const alloc = nodeAllocations.get(node.id) || { cpu: 0, mem: 0 };
    const freeCpu = node.cpu_capacity - alloc.cpu;
    const freeMem = node.memory_capacity - alloc.mem;

    const cpuFits = freeCpu >= pod.cpu_request;
    const memFits = freeMem >= pod.memory_request;

    if (cpuFits && memFits) {
      const cpuRatio = (alloc.cpu + pod.cpu_request) / node.cpu_capacity;
      const memRatio = (alloc.mem + pod.memory_request) / node.memory_capacity;
      const score = (cpuRatio + memRatio) / 2; // lower is least-allocated

      candidates.push({ node, score });
    } else {
      if (!cpuFits && !memFits) {
        reason = 'Insufficient cpu, Insufficient memory';
      } else if (!cpuFits) {
        reason = 'Insufficient cpu';
      } else {
        reason = 'Insufficient memory';
      }
    }
  }

  if (candidates.length > 0) {
    // Sort by lowest score (least-allocated)
    candidates.sort((a, b) => a.score - b.score);
    const chosen = candidates[0].node;

    // Update node allocations map for subsequent pods in this tick
    const currentAlloc = nodeAllocations.get(chosen.id) || { cpu: 0, mem: 0 };
    currentAlloc.cpu += pod.cpu_request;
    currentAlloc.mem += pod.memory_request;
    nodeAllocations.set(chosen.id, currentAlloc);

    await client.query(
      `UPDATE pods 
       SET node_id = $1, status = 'ContainerCreating', state_entered_at = CURRENT_TIMESTAMP, failed_scheduling_logged = false
       WHERE id = $2`,
      [chosen.id, pod.id]
    );

    await recordEvent(client, {
      type: 'Normal',
      reason: 'Scheduled',
      objectKind: 'Pod',
      objectName: pod.name,
      message: `Successfully assigned default/${pod.name} to ${chosen.name}`
    });

    return true;
  } else {
    // Could not schedule
    if (!pod.failed_scheduling_logged) {
      await client.query(
        `UPDATE pods SET failed_scheduling_logged = true WHERE id = $1`,
        [pod.id]
      );

      const failMessage = readyNodes.length === 0
        ? `0/${nodes.length} nodes are available: node(s) were not ready or cordoned.`
        : `0/${nodes.length} nodes are available: ${reason}.`;

      await recordEvent(client, {
        type: 'Warning',
        reason: 'FailedScheduling',
        objectKind: 'Pod',
        objectName: pod.name,
        message: failMessage
      });
    }
    return false;
  }
}

module.exports = {
  schedulePod
};
