'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/ProgressBar';
import { Spinner, EmptyState } from '@/components/Table';
import { useLive } from '@/components/LiveContext';

interface NodeDetail {
  id: number;
  name: string;
  status: string;
  is_cordoned: boolean;
  cpu_capacity: number;
  memory_capacity: number;
  allocated_cpu: number;
  allocated_memory: number;
  cpu_percent: number;
  memory_percent: number;
  pod_count: number;
  pods: { name: string; status: string; is_ready: boolean }[];
}

interface OverviewData {
  nodes: {
    ready: number;
    total: number;
    total_cpu_capacity: number;
    total_memory_capacity: number;
    allocated_cpu: number;
    allocated_memory: number;
    cpu_usage_percent: number;
    memory_usage_percent: number;
    breakdown: NodeDetail[];
  };
  pods: {
    running: number;
    ready: number;
    pending: number;
    container_creating: number;
    failing: number;
    total: number;
  };
  deployments: {
    healthy: number;
    total: number;
    total_replicas_desired: number;
    total_replicas_ready: number;
  };
  latest_events: {
    id: number;
    type: string;
    reason: string;
    object_kind: string;
    object_name: string;
    message: string;
    created_at: string;
  }[];
}

interface MetricPoint {
  id: number;
  pods_running: number;
  pods_pending: number;
  pods_ready: number;
  pods_failing: number;
  cpu_requested: number;
  memory_requested: number;
  ready_nodes: number;
  total_nodes: number;
  created_at: string;
}

export default function OverviewPage() {
  const { isLive } = useLive();
  const [data, setData] = useState<OverviewData | null>(null);
  const [history, setHistory] = useState<MetricPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    try {
      const [overviewData, historyData] = await Promise.all([
        apiRequest<OverviewData>('/api/overview'),
        apiRequest<MetricPoint[]>('/api/metrics/history'),
      ]);
      setData(overviewData);
      setHistory(historyData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load cluster overview');
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

  if (loading && !data) {
    return <Spinner className="w-10 h-10 mt-20" />;
  }

  if (error && !data) {
    return (
      <EmptyState
        title="Unable to load cluster overview"
        description={error}
        action={
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg text-xs font-semibold"
          >
            Retry Connection
          </button>
        }
      />
    );
  }

  if (!data) return null;

  // Hand-drawn SVG chart calculations
  const chartHeight = 160;
  const chartWidth = 500;
  const pointsCount = Math.max(history.length, 2);
  const maxPodCount = Math.max(10, ...history.map(h => Math.max(h.pods_running, h.pods_ready, h.pods_pending, h.pods_failing) + 2));

  function getSvgPath(metricKey: keyof MetricPoint) {
    if (history.length === 0) return '';
    return history
      .map((pt, i) => {
        const x = (i / (pointsCount - 1)) * (chartWidth - 20) + 10;
        const val = Number(pt[metricKey]) || 0;
        const y = chartHeight - (val / maxPodCount) * (chartHeight - 30) - 15;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  return (
    <div className="space-y-6">
      {/* Top Welcome & Summary Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Cluster Overview</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time status of nodes, workloads, pod scheduling, and cluster metrics
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            href="/chaos"
            className="px-3.5 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60 border border-rose-300 dark:border-rose-800 rounded-xl text-xs font-semibold transition-colors flex items-center space-x-1.5 shadow-sm"
          >
            <span>☣</span>
            <span>Chaos Lab</span>
          </Link>
          <Link
            href="/deployments"
            className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm shadow-amber-500/20"
          >
            + Deploy Application
          </Link>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Ready Nodes
            </span>
            <span className="text-lg">▦</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {data.nodes.ready}
              <span className="text-sm font-normal text-slate-400">/{data.nodes.total}</span>
            </span>
            <Badge status={data.nodes.ready === data.nodes.total ? 'Ready' : 'NotReady'}>
              {data.nodes.ready === data.nodes.total ? 'All Ready' : 'Degraded'}
            </Badge>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {data.nodes.total} registered worker nodes
          </div>
        </Card>

        <Card className="hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Pod Fleet
            </span>
            <span className="text-lg">⬡</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {data.pods.ready}
              <span className="text-sm font-normal text-slate-400">/{data.pods.total}</span>
            </span>
            <span className="text-xs font-mono font-medium text-slate-500">
              {data.pods.failing > 0 ? (
                <span className="text-rose-500 font-bold">{data.pods.failing} failing</span>
              ) : (
                <span className="text-emerald-500">0 failing</span>
              )}
            </span>
          </div>
          <div className="mt-3 flex items-center space-x-1.5 text-[11px] text-slate-500">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{data.pods.ready} Ready</span>
            <span>•</span>
            <span className="text-amber-600 dark:text-amber-400 font-semibold">{data.pods.pending} Pending</span>
            <span>•</span>
            <span className="text-slate-500">{data.pods.container_creating} Creating</span>
          </div>
        </Card>

        <Card className="hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Deployments
            </span>
            <span className="text-lg">▥</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {data.deployments.healthy}
              <span className="text-sm font-normal text-slate-400">/{data.deployments.total}</span>
            </span>
            <Badge status={data.deployments.healthy === data.deployments.total ? 'Complete' : 'Progressing'}>
              {data.deployments.healthy === data.deployments.total ? 'Healthy' : 'Syncing'}
            </Badge>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Active workload deployments
          </div>
        </Card>

        <Card className="hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Replicas
            </span>
            <span className="text-lg">◫</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900 dark:text-white">
              {data.deployments.total_replicas_ready}
              <span className="text-sm font-normal text-slate-400">/{data.deployments.total_replicas_desired}</span>
            </span>
            <span className="text-xs font-mono font-medium text-slate-500">
              {data.deployments.total_replicas_desired > 0
                ? `${Math.round((data.deployments.total_replicas_ready / data.deployments.total_replicas_desired) * 100)}%`
                : '100%'}
            </span>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Target replica fulfillment
          </div>
        </Card>
      </div>

      {/* Gauges & Telemetry Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Capacity Gauges */}
        <Card title="Cluster Resource Utilization" subtitle="Allocated CPU requests and Memory reservations">
          <div className="space-y-6 pt-2">
            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="font-semibold text-slate-700 dark:text-slate-200">CPU Allocation</span>
                <span className="font-mono text-slate-500">
                  {data.nodes.allocated_cpu}m / {data.nodes.total_cpu_capacity}m ({data.nodes.cpu_usage_percent}%)
                </span>
              </div>
              <ProgressBar
                value={data.nodes.cpu_usage_percent}
                color={data.nodes.cpu_usage_percent > 85 ? 'rose' : 'amber'}
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                Free compute headroom: {Math.max(0, data.nodes.total_cpu_capacity - data.nodes.allocated_cpu)}m
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Memory Allocation</span>
                <span className="font-mono text-slate-500">
                  {data.nodes.allocated_memory} MB / {data.nodes.total_memory_capacity} MB ({data.nodes.memory_usage_percent}%)
                </span>
              </div>
              <ProgressBar
                value={data.nodes.memory_usage_percent}
                color={data.nodes.memory_usage_percent > 85 ? 'rose' : 'amber'}
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                Free memory headroom: {Math.max(0, data.nodes.total_memory_capacity - data.nodes.allocated_memory)} MB
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-3 text-center">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg">
                <div className="text-[10px] uppercase font-semibold text-slate-400">Total Nodes</div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">{data.nodes.total}</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg">
                <div className="text-[10px] uppercase font-semibold text-slate-400">Scheduler Strategy</div>
                <div className="text-xs font-semibold text-amber-500 mt-1.5">Least-Allocated</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Pods by State SVG Line Chart */}
        <Card
          className="lg:col-span-2"
          title="Pods by State Over Time"
          subtitle="Real-time time-series telemetry snapshot history"
          action={
            <div className="flex items-center space-x-3 text-xs">
              <div className="flex items-center space-x-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-slate-600 dark:text-slate-300">Ready</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-slate-600 dark:text-slate-300">Pending</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span className="text-slate-600 dark:text-slate-300">Failing</span>
              </div>
            </div>
          }
        >
          <div className="h-44 w-full flex items-center justify-center">
            {history.length < 2 ? (
              <div className="text-xs text-slate-400 text-center">
                Collecting cluster telemetry snapshots...
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-full overflow-visible"
              >
                {/* Horizontal Guide Lines */}
                <line x1="10" y1={chartHeight - 15} x2={chartWidth - 10} y2={chartHeight - 15} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="1" />
                <line x1="10" y1={(chartHeight - 15) / 2} x2={chartWidth - 10} y2={(chartHeight - 15) / 2} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="1" strokeDasharray="3 3" />

                {/* Lines */}
                <path
                  d={getSvgPath('pods_ready')}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={getSvgPath('pods_pending')}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={getSvgPath('pods_failing')}
                  fill="none"
                  stroke="#f43f5e"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        </Card>
      </div>

      {/* Node Map: A box per node with colored squares for each pod */}
      <Card
        title="Node Cluster Topology Map"
        subtitle="Live workload distribution across available compute worker nodes"
        action={
          <div className="flex items-center space-x-3 text-xs">
            <span className="flex items-center space-x-1">
              <span className="w-2.5 h-2.5 rounded bg-emerald-500" />
              <span className="text-slate-500">Ready</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2.5 h-2.5 rounded bg-amber-500" />
              <span className="text-slate-500">Starting</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2.5 h-2.5 rounded bg-rose-500" />
              <span className="text-slate-500">Crashing/Unknown</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-2.5 h-2.5 rounded bg-slate-400" />
              <span className="text-slate-500">Terminating</span>
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.nodes.breakdown.map((node) => (
            <div
              key={node.id}
              className={`rounded-xl border p-4 transition-all ${
                node.status === 'Ready'
                  ? 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40'
                  : 'border-rose-300 dark:border-rose-900 bg-rose-50/20 dark:bg-rose-950/20'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-sm text-slate-900 dark:text-white">{node.name}</span>
                  {node.is_cordoned && (
                    <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded font-mono">
                      Cordoned
                    </span>
                  )}
                </div>
                <Badge status={node.status} />
              </div>

              {/* Usage meters */}
              <div className="space-y-1.5 mb-3 text-xs">
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>CPU: {node.allocated_cpu}m / {node.cpu_capacity}m</span>
                  <span>{node.cpu_percent}%</span>
                </div>
                <ProgressBar value={node.cpu_percent} color="amber" />

                <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                  <span>RAM: {node.allocated_memory}MB / {node.memory_capacity}MB</span>
                  <span>{node.memory_percent}%</span>
                </div>
                <ProgressBar value={node.memory_percent} color="sky" />
              </div>

              {/* Pod Squares Grid */}
              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Assigned Pods ({node.pod_count})
                </div>
                {node.pods.length === 0 ? (
                  <div className="text-xs text-slate-400 italic py-1">No pods assigned</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {node.pods.map((p, idx) => {
                      let squareColor = 'bg-emerald-500';
                      if (['crashloopbackoff', 'unknown'].includes(p.status.toLowerCase())) {
                        squareColor = 'bg-rose-500';
                      } else if (!p.is_ready) {
                        squareColor = 'bg-amber-500';
                      } else if (p.status.toLowerCase() === 'terminating') {
                        squareColor = 'bg-slate-400';
                      }

                      return (
                        <div
                          key={idx}
                          title={`${p.name} (${p.status})`}
                          className={`w-6 h-6 rounded-md ${squareColor} shadow-sm flex items-center justify-center text-[10px] font-bold text-white cursor-pointer hover:scale-110 transition-transform`}
                        >
                          {p.name.slice(-2)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Latest 8 Events Table */}
      <Card
        title="Recent Cluster Events"
        subtitle="Real-time controller, scheduler, and node audit event log"
        action={
          <Link href="/events" className="text-xs font-semibold text-amber-500 hover:text-amber-600">
            View All Events →
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-left text-xs">
            <thead>
              <tr className="text-slate-400 uppercase font-semibold">
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Reason</th>
                <th className="py-2 px-3">Resource</th>
                <th className="py-2 px-3">Message</th>
                <th className="py-2 px-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
              {data.latest_events.map((evt) => (
                <tr key={evt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-3 font-sans">
                    <Badge variant={evt.type === 'Normal' ? 'info' : 'warning'}>{evt.type}</Badge>
                  </td>
                  <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                    {evt.reason}
                  </td>
                  <td className="py-2 px-3 text-slate-500">
                    {evt.object_kind}/{evt.object_name}
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-300 font-sans max-w-md truncate">
                    {evt.message}
                  </td>
                  <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                    {new Date(evt.created_at).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
