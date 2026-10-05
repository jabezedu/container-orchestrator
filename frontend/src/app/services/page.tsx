'use client';

import React, { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { Table, Spinner, EmptyState } from '@/components/Table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useLive } from '@/components/LiveContext';

interface ServiceItem {
  id: number;
  name: string;
  namespace: string;
  type: string;
  port: number;
  target_port: number;
  selector: string;
  endpoints: {
    id: number;
    name: string;
    status: string;
    is_ready: boolean;
    image: string;
    node_name: string;
  }[];
  endpoints_count: number;
}

interface DeploymentBasic {
  id: number;
  name: string;
}

export default function ServicesPage() {
  const { isLive } = useLive();
  const { showToast } = useToast();
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [deployments, setDeployments] = useState<DeploymentBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Service Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('ClusterIP');
  const [port, setPort] = useState('80');
  const [targetPort, setTargetPort] = useState('80');
  const [selector, setSelector] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Traffic test state
  const [trafficCounts, setTrafficCounts] = useState<Record<string, number>>({});
  const [trafficResults, setTrafficResults] = useState<Record<string, { pod_name: string; count: number }[]>>({});
  const [sendingTraffic, setSendingTraffic] = useState<Record<string, boolean>>({});

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  async function fetchData() {
    try {
      const [svcData, depsData] = await Promise.all([
        apiRequest<ServiceItem[]>('/api/services'),
        apiRequest<DeploymentBasic[]>('/api/deployments'),
      ]);
      setServices(svcData);
      setDeployments(depsData);
      if (depsData.length > 0 && !selector) {
        setSelector(depsData[0].name);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve services');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [isLive]);

  async function handleCreateService(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/api/services', {
        method: 'POST',
        body: JSON.stringify({
          name,
          type,
          port: parseInt(port, 10),
          target_port: parseInt(targetPort, 10),
          selector,
        }),
      });
      showToast(`Service ${name} created`, 'success');
      setIsCreateOpen(false);
      setName('');
      fetchData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendTraffic(svcName: string) {
    const count = trafficCounts[svcName] || 30;
    setSendingTraffic(prev => ({ ...prev, [svcName]: true }));
    try {
      const res = await apiRequest<{
        service: string;
        total_requests: number;
        distribution: { pod_name: string; count: number }[];
      }>(`/api/services/${svcName}/traffic`, {
        method: 'POST',
        body: JSON.stringify({ count }),
      });
      setTrafficResults(prev => ({ ...prev, [svcName]: res.distribution }));
      showToast(`Dispatched ${count} requests across ${res.distribution.length} endpoints`, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSendingTraffic(prev => ({ ...prev, [svcName]: false }));
    }
  }

  async function handleDeleteService() {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/api/services/${deleteTarget}`, { method: 'DELETE' });
      showToast(`Service ${deleteTarget} deleted`, 'success');
      fetchData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Services & Ingress</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Layer 4 load balancing abstraction mapping stable virtual IP endpoints to dynamic pod targets
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm shadow-amber-500/20"
        >
          + Create Service
        </button>
      </div>

      {loading && services.length === 0 ? (
        <Spinner className="w-8 h-8 my-12" />
      ) : error && services.length === 0 ? (
        <EmptyState title="Failed to load services" description={error} />
      ) : services.length === 0 ? (
        <EmptyState
          title="No services found"
          description="Create a service with a deployment selector to route traffic to active container pods."
          action={
            <button
              onClick={() => setIsCreateOpen(true)}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg text-xs font-semibold"
            >
              Create Service
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {services.map((svc) => (
            <Card
              key={svc.id}
              title={
                <div className="flex items-center space-x-2">
                  <span>{svc.name}</span>
                  <Badge variant="info">{svc.type}</Badge>
                </div>
              }
              subtitle={`Port ${svc.port} → TargetPort ${svc.target_port} • Selector: app=${svc.selector}`}
              action={
                <button
                  onClick={() => setDeleteTarget(svc.name)}
                  className="text-xs text-slate-400 hover:text-rose-600 transition-colors p-1"
                  title="Delete service"
                >
                  Delete
                </button>
              }
            >
              <div className="space-y-4">
                {/* Endpoints section */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-2">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      Live Endpoints ({svc.endpoints_count})
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {svc.endpoints_count > 0 ? (
                        <span className="text-emerald-500">Routing Active</span>
                      ) : (
                        <span className="text-rose-500 font-semibold">503 No Endpoints</span>
                      )}
                    </span>
                  </div>

                  {svc.endpoints.length === 0 ? (
                    <div className="p-3 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 italic text-center">
                      No ready pods matching selector &quot;{svc.selector}&quot;. Traffic will return HTTP 503.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {svc.endpoints.map((ep) => (
                        <div
                          key={ep.id}
                          className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs flex items-center space-x-1.5"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{ep.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">({ep.node_name})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Traffic Generator & Distribution Chart */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Send Requests:
                    </span>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={trafficCounts[svc.name] || 30}
                      onChange={(e) =>
                        setTrafficCounts(prev => ({
                          ...prev,
                          [svc.name]: parseInt(e.target.value, 10) || 1,
                        }))
                      }
                      className="w-16 px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-center"
                    />
                    <button
                      onClick={() => handleSendTraffic(svc.name)}
                      disabled={sendingTraffic[svc.name] || svc.endpoints_count === 0}
                      className="px-3 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors"
                    >
                      {sendingTraffic[svc.name] ? 'Dispatching...' : 'Simulate Traffic'}
                    </button>
                  </div>

                  {/* Distribution Bar Chart */}
                  {trafficResults[svc.name] && (
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Round-Robin Request Distribution
                      </div>
                      <div className="space-y-1.5">
                        {trafficResults[svc.name].map((dist) => {
                          const total = trafficCounts[svc.name] || 30;
                          const pct = Math.round((dist.count / total) * 100);
                          return (
                            <div key={dist.pod_name} className="space-y-0.5">
                              <div className="flex justify-between text-[11px] font-mono">
                                <span className="text-slate-700 dark:text-slate-300">{dist.pod_name}</span>
                                <span className="text-amber-500 font-bold">{dist.count} req ({pct}%)</span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-500 rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create Service Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Service"
      >
        <form onSubmit={handleCreateService} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Service Name
            </label>
            <input
              type="text"
              placeholder="e.g. web-service"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
              >
                <option value="ClusterIP">ClusterIP</option>
                <option value="NodePort">NodePort</option>
                <option value="LoadBalancer">LoadBalancer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Port
              </label>
              <input
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Target Port
              </label>
              <input
                type="number"
                min="1"
                max="65535"
                value={targetPort}
                onChange={(e) => setTargetPort(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Pod Selector (Deployment Target)
            </label>
            <select
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              required
              className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
            >
              {deployments.map((d) => (
                <option key={d.id} value={d.name}>
                  app={d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              {submitting ? 'Creating...' : 'Create Service'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteService}
        title={`Delete Service ${deleteTarget}?`}
        message={`This will remove the virtual service IP and stop routing traffic for ${deleteTarget}.`}
        isDestructive={true}
      />
    </div>
  );
}
