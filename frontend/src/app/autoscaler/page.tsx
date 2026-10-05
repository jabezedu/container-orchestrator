'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/ProgressBar';
import { Table, Spinner, EmptyState } from '@/components/Table';
import { useToast } from '@/components/Toast';
import { useLive } from '@/components/LiveContext';

interface HpaItem {
  id: number;
  deployment_id: number;
  deployment_name: string;
  min_replicas: number;
  max_replicas: number;
  target_cpu_percent: number;
  is_enabled: boolean;
  current_replicas: number;
  ready_pods: number;
  current_cpu_percent: number;
  cpu_request: number;
  simulated_load: number;
  recent_events: {
    id: number;
    reason: string;
    message: string;
    created_at: string;
  }[];
}

interface DeploymentBasic {
  id: number;
  name: string;
  simulated_load: number;
}

export default function AutoscalerPage() {
  const { isLive } = useLive();
  const { showToast } = useToast();
  const [hpas, setHpas] = useState<HpaItem[]>([]);
  const [deployments, setDeployments] = useState<DeploymentBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Global load generator
  const [selectedDep, setSelectedDep] = useState<string>('');
  const [globalLoad, setGlobalLoad] = useState<number>(0);

  async function fetchData() {
    try {
      const [hpasData, depsData] = await Promise.all([
        apiRequest<HpaItem[]>('/api/hpas'),
        apiRequest<DeploymentBasic[]>('/api/deployments'),
      ]);
      setHpas(hpasData);
      setDeployments(depsData);

      if (depsData.length > 0 && !selectedDep) {
        setSelectedDep(depsData[0].name);
        setGlobalLoad(depsData[0].simulated_load || 0);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load autoscaler information');
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

  async function handleLoadApply(val: number) {
    setGlobalLoad(val);
    if (!selectedDep) return;
    try {
      await apiRequest(`/api/deployments/${selectedDep}/load`, {
        method: 'PUT',
        body: JSON.stringify({ load: val }),
      });
      showToast(`Set load to ${val}m for ${selectedDep}`, 'info');
      fetchData();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  function handleSelectDeployment(name: string) {
    setSelectedDep(name);
    const d = deployments.find(item => item.name === name);
    if (d) setGlobalLoad(d.simulated_load || 0);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Horizontal Pod Autoscaler (HPA)</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Automated compute workload scaling driven by target CPU utilization breaches and stabilization windows
        </p>
      </div>

      {/* Global Load Generator Panel */}
      <Card
        title="Interactive Traffic Load Generator"
        subtitle="Simulate burst demand to test real-time autoscaling out and back in"
      >
        <div className="space-y-4 pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Target Deployment:</span>
              <select
                value={selectedDep}
                onChange={(e) => handleSelectDeployment(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold"
              >
                {deployments.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Presets */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400 font-medium">Quick Presets:</span>
              <button
                onClick={() => handleLoadApply(0)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs rounded-lg font-medium"
              >
                Idle (0m)
              </button>
              <button
                onClick={() => handleLoadApply(1500)}
                className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 dark:bg-amber-950 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-300 text-xs rounded-lg font-medium"
              >
                Medium (1500m)
              </button>
              <button
                onClick={() => handleLoadApply(4500)}
                className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 dark:bg-rose-950 dark:hover:bg-rose-900 text-rose-800 dark:text-rose-300 text-xs rounded-lg font-medium"
              >
                Spike (4500m)
              </button>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center text-xs mb-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Active Demand for {selectedDep}:</span>
              <span className="font-mono text-amber-500 font-bold text-sm">{globalLoad}m CPU</span>
            </div>
            <input
              type="range"
              min="0"
              max="6000"
              step="100"
              value={globalLoad}
              onChange={(e) => handleLoadApply(parseInt(e.target.value, 10))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>
        </div>
      </Card>

      {/* HPAs List */}
      <div className="space-y-4">
        {loading && hpas.length === 0 ? (
          <Spinner className="w-8 h-8 my-8" />
        ) : error && hpas.length === 0 ? (
          <EmptyState title="Error loading HPAs" description={error} />
        ) : hpas.length === 0 ? (
          <EmptyState
            title="No HPAs Configured"
            description="Enable HPA on any deployment's detail page to begin automatic horizontal scaling."
          />
        ) : (
          hpas.map((hpa) => {
            const isScaleOutTriggered = hpa.current_cpu_percent > hpa.target_cpu_percent;
            const isScaleInTriggered = hpa.current_cpu_percent < Math.floor(hpa.target_cpu_percent * 0.6);

            return (
              <Card
                key={hpa.id}
                title={
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/deployments/${hpa.deployment_name}`}
                      className="hover:text-amber-500 transition-colors font-bold"
                    >
                      {hpa.deployment_name}
                    </Link>
                    <Badge status={hpa.is_enabled ? 'Ready' : 'Paused'}>
                      {hpa.is_enabled ? 'Autoscaling Active' : 'Disabled'}
                    </Badge>
                  </div>
                }
                action={
                  <div className="flex items-center space-x-2 text-xs">
                    <span className="text-slate-500">Replicas:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {hpa.current_replicas}
                    </span>
                    <span className="text-slate-400 font-mono">
                      (min: {hpa.min_replicas}, max: {hpa.max_replicas})
                    </span>
                  </div>
                }
              >
                <div className="space-y-4">
                  {/* Gauge bar */}
                  <div>
                    <div className="flex justify-between items-center text-xs mb-1.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          CPU Utilization:
                        </span>
                        <span
                          className={`font-mono font-bold ${
                            isScaleOutTriggered
                              ? 'text-rose-500'
                              : isScaleInTriggered
                              ? 'text-sky-500'
                              : 'text-emerald-500'
                          }`}
                        >
                          {hpa.current_cpu_percent}%
                        </span>
                        <span className="text-slate-400">/ Target: {hpa.target_cpu_percent}%</span>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {hpa.ready_pods} ready pods ({hpa.ready_pods * (hpa.cpu_request || 250)}m cap)
                      </span>
                    </div>
                    <ProgressBar
                      value={hpa.current_cpu_percent}
                      color={isScaleOutTriggered ? 'rose' : isScaleInTriggered ? 'sky' : 'amber'}
                    />
                  </div>

                  {/* Recent Scaling Events */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Recent Autoscaling Decisions
                    </div>
                    {hpa.recent_events.length === 0 ? (
                      <div className="text-xs text-slate-400 italic">No recent scale events. Metrics within stable range.</div>
                    ) : (
                      <div className="space-y-1.5 font-mono text-xs">
                        {hpa.recent_events.map((evt) => (
                          <div
                            key={evt.id}
                            className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
                          >
                            <div className="flex items-center space-x-2 truncate">
                              <span className="text-amber-500 font-semibold">{evt.reason}</span>
                              <span className="text-slate-600 dark:text-slate-300 truncate font-sans">
                                {evt.message}
                              </span>
                            </div>
                            <span className="text-slate-400 text-[10px] whitespace-nowrap ml-2">
                              {new Date(evt.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
