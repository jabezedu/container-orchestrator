'use client';

import React, { useState } from 'react';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';

interface LogEntry {
  step: number;
  text: string;
  type?: 'info' | 'success' | 'warn' | 'error';
  time: string;
}

export default function ChaosLabPage() {
  const { showToast } = useToast();
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  function addLog(text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') {
    setLogs(prev => [
      ...prev,
      { step: prev.length + 1, text, type, time: new Date().toLocaleTimeString() },
    ]);
  }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  // 1. Scenario: Bad Rollout & Rollback
  async function runBadRolloutScenario() {
    setRunningScenario('bad-rollout');
    setLogs([]);
    addLog('Starting Scenario: Bad Rollout and Automated Rollback', 'info');

    try {
      addLog('Step 1: Inspecting current deployment web-app revision baseline...', 'info');
      const baseline = await apiRequest('/api/deployments/web-app');
      addLog(`Baseline active: rev ${baseline.current_revision} running ${baseline.image}`, 'info');
      await sleep(1000);

      addLog('Step 2: Deploying faulty image "api:broken" (simulates code crash on boot)...', 'warn');
      await apiRequest('/api/deployments/web-app', {
        method: 'PUT',
        body: JSON.stringify({ image: 'api:broken' }),
      });
      addLog('Triggered rolling update to rev ' + (baseline.current_revision + 1), 'info');
      await sleep(1500);

      addLog('Step 3: New pods start booting; controller detects crash after 3s...', 'warn');
      for (let i = 0; i < 4; i++) {
        await apiRequest('/api/tick', { method: 'POST' });
        await sleep(800);
      }

      addLog('Step 4: New pods entered CrashLoopBackOff! Old pods continue serving to preserve availability.', 'warn');
      await sleep(1000);

      addLog('Step 5: Progress deadline exceeded (30s timeout elapsed). Rollout status marked as "Stalled".', 'error');
      await sleep(1200);

      addLog(`Step 6: Executing automated rollback to safe revision ${baseline.current_revision}...`, 'info');
      await apiRequest('/api/deployments/web-app/rollback', {
        method: 'POST',
        body: JSON.stringify({ revision_number: baseline.current_revision }),
      });
      addLog('Rollback initiated; spawning healthy container instances...', 'info');

      for (let i = 0; i < 5; i++) {
        await apiRequest('/api/tick', { method: 'POST' });
        await sleep(600);
      }

      addLog('Scenario Complete: Cluster restored to stable revision!', 'success');
      showToast('Bad rollout scenario completed successfully', 'success');
    } catch (err: any) {
      addLog(`Scenario failed: ${err.message}`, 'error');
    } finally {
      setRunningScenario(null);
    }
  }

  // 2. Scenario: Node Failure
  async function runNodeFailureScenario() {
    setRunningScenario('node-failure');
    setLogs([]);
    addLog('Starting Scenario: Node Failure & Pod Eviction', 'info');

    try {
      addLog('Step 1: Identifying target ready worker node with active workloads...', 'info');
      const nodes = await apiRequest<any[]>('/api/nodes');
      const targetNode = nodes.find(n => n.status === 'Ready' && n.pod_count > 0) || nodes[0];
      addLog(`Selected target node: ${targetNode.name} (${targetNode.pod_count} active pods)`, 'info');
      await sleep(1000);

      addLog(`Step 2: Simulating hardware crash on ${targetNode.name}...`, 'warn');
      await apiRequest(`/api/nodes/${targetNode.id}/fail`, { method: 'POST' });
      addLog(`Node ${targetNode.name} status transitioned to NotReady`, 'error');
      await sleep(1000);

      addLog('Step 3: Controller marks pods on failed node as Unknown...', 'warn');
      await apiRequest('/api/tick', { method: 'POST' });
      await sleep(1200);

      addLog('Step 4: 5-second node eviction grace period elapses; controller deletes lost pods...', 'info');
      for (let i = 0; i < 3; i++) {
        await apiRequest('/api/tick', { method: 'POST' });
        await sleep(800);
      }

      addLog('Step 5: Scheduler redistributes pods to surviving healthy nodes!', 'success');
      await sleep(1000);

      addLog(`Step 6: Recovering node ${targetNode.name} back to Ready state...`, 'info');
      await apiRequest(`/api/nodes/${targetNode.id}/recover`, { method: 'POST' });
      addLog(`Node ${targetNode.name} recovered to Ready`, 'success');
      showToast('Node failure scenario completed', 'success');
    } catch (err: any) {
      addLog(`Scenario error: ${err.message}`, 'error');
    } finally {
      setRunningScenario(null);
    }
  }

  // 3. Scenario: Traffic Spike
  async function runTrafficSpikeScenario() {
    setRunningScenario('traffic-spike');
    setLogs([]);
    addLog('Starting Scenario: Traffic Spike & Horizontal Pod Autoscaling', 'info');

    try {
      addLog('Step 1: Verifying HPA configuration on web-app deployment...', 'info');
      await apiRequest('/api/hpas', {
        method: 'POST',
        body: JSON.stringify({
          deployment_name: 'web-app',
          min_replicas: 1,
          max_replicas: 5,
          target_cpu_percent: 60,
          is_enabled: true,
        }),
      });
      addLog('HPA active: Target CPU = 60%, Min = 1, Max = 5', 'info');
      await sleep(1000);

      addLog('Step 2: Injecting severe traffic spike (4500m load demand)...', 'warn');
      await apiRequest('/api/deployments/web-app/load', {
        method: 'PUT',
        body: JSON.stringify({ load: 4500 }),
      });
      addLog('Traffic spike applied: 4500m CPU demand registered', 'warn');
      await sleep(1000);

      addLog('Step 3: HPA evaluates breach: CPU utilization exceeds 60% target!', 'warn');
      for (let i = 0; i < 5; i++) {
        await apiRequest('/api/tick', { method: 'POST' });
        await sleep(500);
      }

      addLog('Step 4: Scale-out triggered! Deployment scaled to handle demand.', 'success');
      await sleep(1200);

      addLog('Step 5: Relieving traffic demand back to 0m (Idle)...', 'info');
      await apiRequest('/api/deployments/web-app/load', {
        method: 'PUT',
        body: JSON.stringify({ load: 0 }),
      });
      addLog('Load returned to baseline 0m', 'info');
      await sleep(1000);

      addLog('Scenario Complete: Scale-in stabilization window will safely scale down replicas.', 'success');
      showToast('Traffic spike scenario completed', 'success');
    } catch (err: any) {
      addLog(`Scenario error: ${err.message}`, 'error');
    } finally {
      setRunningScenario(null);
    }
  }

  // 4. Scenario: Resource Exhaustion
  async function runExhaustionScenario() {
    setRunningScenario('exhaustion');
    setLogs([]);
    addLog('Starting Scenario: Resource Exhaustion & Unschedulable Pods', 'info');

    try {
      addLog('Step 1: Attempting to create massive deployment requesting 999999 MB RAM...', 'warn');
      const huge = await apiRequest('/api/deployments', {
        method: 'POST',
        body: JSON.stringify({
          name: 'oversized-db',
          image: 'memory-hog:1.0',
          replicas: 1,
          cpu_request: 500,
          memory_request: 999999,
        }),
      });
      addLog(`Created deployment ${huge.name} with impossible memory request`, 'info');
      await sleep(1000);

      addLog('Step 2: Scheduler filters worker nodes: 0/3 nodes have sufficient memory!', 'warn');
      await apiRequest('/api/tick', { method: 'POST' });
      await sleep(1000);

      addLog('Step 3: Pod status remains "Pending"; FailedScheduling warning event emitted once.', 'error');
      await sleep(1200);

      addLog('Step 4: Cleaning up unfulfillable deployment...', 'info');
      await apiRequest('/api/deployments/oversized-db', { method: 'DELETE' });
      addLog('Oversized deployment removed; cluster cleaned.', 'success');
      showToast('Resource exhaustion scenario completed', 'success');
    } catch (err: any) {
      addLog(`Scenario error: ${err.message}`, 'error');
    } finally {
      setRunningScenario(null);
    }
  }

  // Single Chaos Actions
  async function handleKillRandomPod() {
    try {
      const res = await apiRequest<{ message: string; pod_name: string }>('/api/chaos/kill-pod', {
        method: 'POST',
      });
      showToast(res.message, 'warning');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  async function handleFailRandomNode() {
    try {
      const res = await apiRequest<{ message: string; node_name: string }>('/api/chaos/fail-node', {
        method: 'POST',
      });
      showToast(res.message, 'warning');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  async function handleResetCluster() {
    try {
      await apiRequest('/api/chaos/reset-cluster', { method: 'POST' });
      showToast('Cluster restored to baseline seed state', 'success');
      setLogs([]);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2">
            <span>Chaos Engineering Lab</span>
            <span className="text-xs bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 px-2 py-0.5 rounded-full font-mono font-bold">
              ☣ LIVE
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Test resilience against crash loops, rolling update stalls, hardware outages, load surges, and capacity exhaustion
          </p>
        </div>

        {/* Quick single actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleKillRandomPod}
            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 rounded-xl text-xs font-semibold transition-colors"
          >
            ⚡ Kill Random Pod
          </button>
          <button
            onClick={handleFailRandomNode}
            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 rounded-xl text-xs font-semibold transition-colors"
          >
            🛑 Fail Random Node
          </button>
          <button
            onClick={() => setResetConfirmOpen(true)}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors"
          >
            ↺ Reset Cluster
          </button>
        </div>
      </div>

      {/* Guided Scenarios Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Scenario 1 */}
        <Card
          title="1. Bad Rollout & Rollback"
          subtitle="Deploy a crashing image, observe deadline stall, and restore safe release"
        >
          <div className="space-y-3 pt-1">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Deploys the faulty <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">api:broken</code> image.
              Pods enter CrashLoopBackOff. The controller detects <span className="font-semibold text-rose-500">ProgressDeadlineExceeded</span> after
              30s while older pods remain online. Then rolls back to restore service.
            </p>
            <button
              onClick={runBadRolloutScenario}
              disabled={runningScenario !== null}
              className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
            >
              {runningScenario === 'bad-rollout' ? 'Executing Scenario...' : 'Run Bad Rollout Scenario'}
            </button>
          </div>
        </Card>

        {/* Scenario 2 */}
        <Card
          title="2. Node Hardware Outage"
          subtitle="Simulate sudden server loss and automatic pod evacuation"
        >
          <div className="space-y-3 pt-1">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Marks an active worker node as <span className="font-semibold text-rose-500">NotReady</span>.
              Its pods transition to <span className="font-semibold text-amber-500">Unknown</span> state.
              After the 5s grace period expires, the controller evicts and reschedules them to healthy nodes.
            </p>
            <button
              onClick={runNodeFailureScenario}
              disabled={runningScenario !== null}
              className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
            >
              {runningScenario === 'node-failure' ? 'Executing Scenario...' : 'Run Node Failure Scenario'}
            </button>
          </div>
        </Card>

        {/* Scenario 3 */}
        <Card
          title="3. Traffic Spike & HPA Scale-Out"
          subtitle="Flood a service with 4500m demand and observe autoscaling response"
        >
          <div className="space-y-3 pt-1">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Spikes compute load demand to 4500m on <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">web-app</code>.
              The HPA detects average CPU surpassing target thresholds and adds pods. Removing the load observes the 15s stabilization window.
            </p>
            <button
              onClick={runTrafficSpikeScenario}
              disabled={runningScenario !== null}
              className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
            >
              {runningScenario === 'traffic-spike' ? 'Executing Scenario...' : 'Run Traffic Spike Scenario'}
            </button>
          </div>
        </Card>

        {/* Scenario 4 */}
        <Card
          title="4. Resource Capacity Exhaustion"
          subtitle="Attempt to schedule an oversized container exceeding all node memory"
        >
          <div className="space-y-3 pt-1">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Creates a deployment requesting 999999 MB RAM. The least-allocated scheduler rejects placement across all nodes,
              leaving the pod in <span className="font-semibold text-amber-500">Pending</span> state with a <span className="font-semibold text-rose-500">FailedScheduling</span> warning event.
            </p>
            <button
              onClick={runExhaustionScenario}
              disabled={runningScenario !== null}
              className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
            >
              {runningScenario === 'exhaustion' ? 'Executing Scenario...' : 'Run Resource Exhaustion Scenario'}
            </button>
          </div>
        </Card>
      </div>

      {/* Live Narration Panel */}
      <Card
        title="Live Scenario Execution Narration Panel"
        subtitle="Step-by-step real API execution audit logs"
        action={
          logs.length > 0 && (
            <button
              onClick={() => setLogs([])}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Clear Logs
            </button>
          )
        }
      >
        {logs.length === 0 ? (
          <div className="text-xs text-slate-400 italic py-8 text-center bg-slate-50 dark:bg-slate-800/20 rounded-xl">
            Click any scenario above to watch step-by-step API orchestrator actions in real time.
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto font-mono text-xs p-3 bg-slate-900 text-slate-200 rounded-xl">
            {logs.map((log) => (
              <div key={log.step} className="flex items-start space-x-2 leading-relaxed">
                <span className="text-slate-500 select-none">[{log.time}]</span>
                <span
                  className={
                    log.type === 'success'
                      ? 'text-emerald-400 font-bold'
                      : log.type === 'warn'
                      ? 'text-amber-400'
                      : log.type === 'error'
                      ? 'text-rose-400 font-bold'
                      : 'text-slate-300'
                  }
                >
                  {log.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Reset Confirmation */}
      <ConfirmDialog
        isOpen={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={handleResetCluster}
        title="Reset Cluster to Baseline?"
        message="This will wipe all dynamically generated pods, events, and metrics, restoring the 3 seed nodes and 2 baseline deployments."
        isDestructive={true}
      />
    </div>
  );
}
