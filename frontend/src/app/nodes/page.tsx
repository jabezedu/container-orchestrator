'use client';

import React, { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/ProgressBar';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Spinner, EmptyState } from '@/components/Table';
import { useToast } from '@/components/Toast';
import { useLive } from '@/components/LiveContext';

interface NodeItem {
  id: number;
  name: string;
  cpu_capacity: number;
  memory_capacity: number;
  status: string;
  is_cordoned: boolean;
  allocated_cpu: number;
  allocated_memory: number;
  cpu_percent: number;
  memory_percent: number;
  pod_count: number;
  pods: {
    id: number;
    name: string;
    image: string;
    status: string;
    is_ready: boolean;
    deployment_name?: string;
  }[];
}

export default function NodesPage() {
  const { isLive } = useLive();
  const { showToast } = useToast();
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add node modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [nodeName, setNodeName] = useState('');
  const [cpuCapacity, setCpuCapacity] = useState('4000');
  const [memoryCapacity, setMemoryCapacity] = useState('8192');
  const [submitting, setSubmitting] = useState(false);

  // Confirm action dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  async function fetchNodes() {
    try {
      const data = await apiRequest<NodeItem[]>('/api/nodes');
      setNodes(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load nodes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNodes();
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchNodes, 2000);
    return () => clearInterval(interval);
  }, [isLive]);

  async function handleAddNode(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/api/nodes', {
        method: 'POST',
        body: JSON.stringify({
          name: nodeName,
          cpu_capacity: parseInt(cpuCapacity, 10),
          memory_capacity: parseInt(memoryCapacity, 10),
        }),
      });
      showToast(`Node ${nodeName} created successfully`, 'success');
      setIsAddOpen(false);
      setNodeName('');
      fetchNodes();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCordonToggle(node: NodeItem) {
    try {
      await apiRequest(`/api/nodes/${node.id}/cordon`, {
        method: 'PATCH',
        body: JSON.stringify({ is_cordoned: !node.is_cordoned }),
      });
      showToast(`Node ${node.name} ${node.is_cordoned ? 'uncordoned' : 'cordoned'}`, 'info');
      fetchNodes();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  async function handleDrain(node: NodeItem) {
    setConfirmDialog({
      isOpen: true,
      title: `Drain Node ${node.name}?`,
      message: `Draining will cordon the node and evict all ${node.pod_count} running pods to reschedule them onto other nodes.`,
      isDestructive: false,
      onConfirm: async () => {
        try {
          await apiRequest(`/api/nodes/${node.id}/drain`, { method: 'POST' });
          showToast(`Drain initiated for ${node.name}`, 'success');
          fetchNodes();
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      },
    });
  }

  async function handleFail(node: NodeItem) {
    setConfirmDialog({
      isOpen: true,
      title: `Simulate Hardware Failure on ${node.name}?`,
      message: `Setting ${node.name} to NotReady will mark its pods as Unknown. After 5s they will be evicted and rescheduled.`,
      isDestructive: true,
      onConfirm: async () => {
        try {
          await apiRequest(`/api/nodes/${node.id}/fail`, { method: 'POST' });
          showToast(`Node ${node.name} marked as NotReady`, 'warning');
          fetchNodes();
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      },
    });
  }

  async function handleRecover(node: NodeItem) {
    try {
      await apiRequest(`/api/nodes/${node.id}/recover`, { method: 'POST' });
      showToast(`Node ${node.name} recovered to Ready`, 'success');
      fetchNodes();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  async function handleRemove(node: NodeItem) {
    setConfirmDialog({
      isOpen: true,
      title: `Remove Node ${node.name}?`,
      message: `Are you sure you want to permanently delete ${node.name} from the cluster? (Node must have 0 active pods).`,
      isDestructive: true,
      onConfirm: async () => {
        try {
          await apiRequest(`/api/nodes/${node.id}`, { method: 'DELETE' });
          showToast(`Node ${node.name} removed`, 'success');
          fetchNodes();
        } catch (err: any) {
          showToast(err.message, 'error');
        }
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Worker Nodes</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage worker nodes, cordoning, drainage, simulated node failure and capacity allocation
          </p>
        </div>
        <button
          onClick={() => setIsAddOpen(true)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm shadow-amber-500/20"
        >
          + Add Node
        </button>
      </div>

      {loading && nodes.length === 0 ? (
        <Spinner className="w-10 h-10 mt-16" />
      ) : error && nodes.length === 0 ? (
        <EmptyState title="Failed to load nodes" description={error} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {nodes.map((node) => (
            <Card
              key={node.id}
              className="flex flex-col justify-between"
              title={
                <div className="flex items-center space-x-2">
                  <span>{node.name}</span>
                  {node.is_cordoned && (
                    <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded font-mono">
                      Cordoned
                    </span>
                  )}
                </div>
              }
              action={<Badge status={node.status} />}
            >
              <div className="space-y-4">
                {/* Resource Allocations */}
                <div className="space-y-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <div>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
                      <span>CPU: {node.allocated_cpu}m / {node.cpu_capacity}m</span>
                      <span className="font-semibold">{node.cpu_percent}%</span>
                    </div>
                    <ProgressBar value={node.cpu_percent} color="amber" />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
                      <span>Memory: {node.allocated_memory}MB / {node.memory_capacity}MB</span>
                      <span className="font-semibold">{node.memory_percent}%</span>
                    </div>
                    <ProgressBar value={node.memory_percent} color="sky" />
                  </div>
                </div>

                {/* Pods on this node */}
                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex justify-between items-center">
                    <span>Pods ({node.pod_count})</span>
                    <span className="text-[10px] text-slate-400">
                      {node.pods.filter(p => p.is_ready).length} Ready
                    </span>
                  </div>
                  {node.pods.length === 0 ? (
                    <div className="text-xs text-slate-400 italic py-3 text-center bg-slate-50 dark:bg-slate-800/20 rounded-lg">
                      No active pods scheduled
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                      {node.pods.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between text-xs px-2.5 py-1.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700/60"
                        >
                          <div className="truncate max-w-[170px]">
                            <span className="font-medium text-slate-800 dark:text-slate-200 block truncate">{p.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono block">{p.image}</span>
                          </div>
                          <Badge status={p.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Node Control Action Buttons */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => handleCordonToggle(node)}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition-colors font-medium"
                  >
                    {node.is_cordoned ? 'Uncordon' : 'Cordon'}
                  </button>

                  <button
                    onClick={() => handleDrain(node)}
                    className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/80 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-300 rounded-lg transition-colors font-medium"
                  >
                    Drain
                  </button>

                  {node.status === 'Ready' ? (
                    <button
                      onClick={() => handleFail(node)}
                      className="px-2.5 py-1.5 bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/80 dark:hover:bg-rose-900/60 text-rose-800 dark:text-rose-300 rounded-lg transition-colors font-medium"
                    >
                      Fail Node
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRecover(node)}
                      className="px-2.5 py-1.5 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/80 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 rounded-lg transition-colors font-medium"
                    >
                      Recover
                    </button>
                  )}

                  <button
                    onClick={() => handleRemove(node)}
                    className="px-2.5 py-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors ml-auto"
                    title="Remove node"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add Node Modal */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Add Worker Node"
      >
        <form onSubmit={handleAddNode} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Node Name
            </label>
            <input
              type="text"
              placeholder="e.g. node-4"
              value={nodeName}
              onChange={(e) => setNodeName(e.target.value)}
              required
              className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              CPU Capacity (millicores)
            </label>
            <input
              type="number"
              min="1000"
              max="32000"
              step="500"
              value={cpuCapacity}
              onChange={(e) => setCpuCapacity(e.target.value)}
              required
              className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="text-[11px] text-slate-400">4000m = 4 CPU cores</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Memory Capacity (MB)
            </label>
            <input
              type="number"
              min="1024"
              max="65536"
              step="1024"
              value={memoryCapacity}
              onChange={(e) => setMemoryCapacity(e.target.value)}
              required
              className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="text-[11px] text-slate-400">8192 MB = 8 GB RAM</span>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              {submitting ? 'Adding...' : 'Register Node'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        isDestructive={confirmDialog.isDestructive}
      />
    </div>
  );
}
