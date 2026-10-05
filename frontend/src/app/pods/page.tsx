'use client';

import React, { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Table, Spinner, EmptyState } from '@/components/Table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useLive } from '@/components/LiveContext';

interface PodItem {
  id: number;
  name: string;
  namespace: string;
  deployment_id: number;
  deployment_name: string;
  node_id: number | null;
  node_name: string | null;
  image: string;
  cpu_request: number;
  memory_request: number;
  status: string;
  is_ready: boolean;
  restart_count: number;
  created_at: string;
  state_entered_at: string;
  events?: {
    id: number;
    type: string;
    reason: string;
    message: string;
    created_at: string;
  }[];
}

export default function PodsPage() {
  const { isLive } = useLive();
  const { showToast } = useToast();
  const [pods, setPods] = useState<PodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [depFilter, setDepFilter] = useState('');

  // Selected pod for drawer
  const [selectedPod, setSelectedPod] = useState<PodItem | null>(null);
  const [loadingPodDetail, setLoadingPodDetail] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  async function fetchPods() {
    try {
      const data = await apiRequest<PodItem[]>('/api/pods');
      setPods(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve pods');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPods();
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchPods, 2000);
    return () => clearInterval(interval);
  }, [isLive]);

  async function handleOpenDetail(podName: string) {
    setLoadingPodDetail(true);
    try {
      const detail = await apiRequest<PodItem>(`/api/pods/${podName}`);
      setSelectedPod(detail);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoadingPodDetail(false);
    }
  }

  async function handleDeletePod() {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/api/pods/${deleteTarget}`, { method: 'DELETE' });
      showToast(`Pod ${deleteTarget} marked for termination`, 'info');
      fetchPods();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setDeleteTarget(null);
    }
  }

  // Filter lists
  const availableNodes = Array.from(new Set(pods.map(p => p.node_name).filter(Boolean)));
  const availableDeps = Array.from(new Set(pods.map(p => p.deployment_name).filter(Boolean)));

  const filteredPods = pods.filter(pod => {
    if (search && !pod.name.toLowerCase().includes(search.toLowerCase()) && !pod.image.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (statusFilter && pod.status.toLowerCase() !== statusFilter.toLowerCase()) {
      return false;
    }
    if (nodeFilter && pod.node_name !== nodeFilter) {
      return false;
    }
    if (depFilter && pod.deployment_name !== depFilter) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Pods Fleet</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Inspect container instance states, node scheduling assignments, readiness, and restart timelines
        </p>
      </div>

      {/* Filters Toolbar */}
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search by pod name or image..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">State</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">All States</option>
              <option value="Ready">Ready</option>
              <option value="Running">Running</option>
              <option value="Pending">Pending</option>
              <option value="ContainerCreating">ContainerCreating</option>
              <option value="CrashLoopBackOff">CrashLoopBackOff</option>
              <option value="Terminating">Terminating</option>
              <option value="Unknown">Unknown</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Node</label>
            <select
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">All Nodes</option>
              {availableNodes.map((n) => (
                <option key={n as string} value={n as string}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Deployment</label>
            <select
              value={depFilter}
              onChange={(e) => setDepFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">All Deployments</option>
              {availableDeps.map((d) => (
                <option key={d as string} value={d as string}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Pods Table */}
      <Card>
        {loading && pods.length === 0 ? (
          <Spinner className="w-8 h-8 my-8" />
        ) : error && pods.length === 0 ? (
          <EmptyState title="Error loading pods" description={error} />
        ) : filteredPods.length === 0 ? (
          <EmptyState
            title="No pods matching criteria"
            description="No pods were found matching the selected search or filter conditions."
          />
        ) : (
          <Table
            headers={[
              'Pod Name',
              'Deployment',
              'Node',
              'Image',
              'Status',
              'Ready',
              'Restarts',
              'Age',
              'Actions',
            ]}
          >
            {filteredPods.map((pod) => (
              <tr key={pod.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs">
                <td className="px-4 py-3 font-mono font-medium text-slate-900 dark:text-white">
                  <button
                    onClick={() => handleOpenDetail(pod.name)}
                    className="hover:text-amber-500 transition-colors text-left flex items-center space-x-1"
                  >
                    <span>{pod.name}</span>
                    <span className="text-[10px] text-slate-400">🔍</span>
                  </button>
                </td>

                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {pod.deployment_name || 'Standalone'}
                </td>

                <td className="px-4 py-3 font-mono text-slate-500">
                  {pod.node_name ? (
                    <span>{pod.node_name}</span>
                  ) : (
                    <span className="text-amber-500 italic">Unscheduled</span>
                  )}
                </td>

                <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                  {pod.image}
                </td>

                <td className="px-4 py-3">
                  <Badge status={pod.status} />
                </td>

                <td className="px-4 py-3">
                  <span
                    className={`font-semibold ${
                      pod.is_ready ? 'text-emerald-500' : 'text-slate-400'
                    }`}
                  >
                    {pod.is_ready ? 'Yes' : 'No'}
                  </span>
                </td>

                <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                  {pod.restart_count > 0 ? (
                    <span className="text-rose-500 font-bold">{pod.restart_count}</span>
                  ) : (
                    0
                  )}
                </td>

                <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                  {new Date(pod.created_at).toLocaleTimeString()}
                </td>

                <td className="px-4 py-3 text-right">
                  <div className="flex items-center space-x-2 justify-end">
                    <button
                      onClick={() => handleOpenDetail(pod.name)}
                      className="text-amber-500 hover:text-amber-600 font-semibold"
                    >
                      Detail
                    </button>
                    <button
                      onClick={() => setDeleteTarget(pod.name)}
                      className="text-slate-400 hover:text-rose-500 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Pod Detail Drawer / Modal */}
      {selectedPod && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm"
            onClick={() => setSelectedPod(null)}
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white font-mono">
                    {selectedPod.name}
                  </h3>
                  <div className="flex items-center space-x-2 mt-1">
                    <Badge status={selectedPod.status} />
                    <span className="text-xs text-slate-400">
                      Node: {selectedPod.node_name || 'Pending'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedPod(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg p-1"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 flex-1 overflow-y-auto space-y-6 text-xs">
                {/* Specs Box */}
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Image:</span>
                    <span className="font-mono text-slate-900 dark:text-white">{selectedPod.image}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">CPU Request:</span>
                    <span className="font-mono text-slate-900 dark:text-white">{selectedPod.cpu_request}m</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Memory Request:</span>
                    <span className="font-mono text-slate-900 dark:text-white">{selectedPod.memory_request} MB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Restarts:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">{selectedPod.restart_count}</span>
                  </div>
                </div>

                {/* State Timeline */}
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white text-sm mb-3">
                    State Lifecycle Timeline
                  </h4>
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                    <div className="relative">
                      <span className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
                      <div className="font-semibold text-slate-900 dark:text-white">Created</div>
                      <div className="text-[11px] text-slate-400">{new Date(selectedPod.created_at).toLocaleString()}</div>
                    </div>
                    {selectedPod.node_name && (
                      <div className="relative">
                        <span className="absolute -left-6 top-0.5 w-3 h-3 rounded-full bg-sky-500 border-2 border-white dark:border-slate-900" />
                        <div className="font-semibold text-slate-900 dark:text-white">Scheduled to Node</div>
                        <div className="text-[11px] text-slate-400">Assigned to {selectedPod.node_name}</div>
                      </div>
                    )}
                    <div className="relative">
                      <span className={`absolute -left-6 top-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${
                        selectedPod.is_ready ? 'bg-emerald-500' : 'bg-amber-500'
                      }`} />
                      <div className="font-semibold text-slate-900 dark:text-white">Current Status: {selectedPod.status}</div>
                      <div className="text-[11px] text-slate-400">Active state</div>
                    </div>
                  </div>
                </div>

                {/* Associated Events */}
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white text-sm mb-2">
                    Pod Events
                  </h4>
                  {(!selectedPod.events || selectedPod.events.length === 0) ? (
                    <div className="text-slate-400 italic">No recorded events for this pod.</div>
                  ) : (
                    <div className="space-y-2">
                      {selectedPod.events.map((evt) => (
                        <div
                          key={evt.id}
                          className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{evt.reason}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {new Date(evt.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{evt.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button
                  onClick={() => {
                    setDeleteTarget(selectedPod.name);
                    setSelectedPod(null);
                  }}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold"
                >
                  Terminate Pod
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeletePod}
        title={`Terminate Pod ${deleteTarget}?`}
        message={`This will transition container ${deleteTarget} to Terminating state (2s grace period) before removing it.`}
        isDestructive={true}
      />
    </div>
  );
}
