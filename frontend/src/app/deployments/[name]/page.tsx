'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { ProgressBar } from '@/components/ProgressBar';
import { Table, Spinner, EmptyState } from '@/components/Table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useLive } from '@/components/LiveContext';

interface PodDetail {
  id: number;
  name: string;
  image: string;
  status: string;
  is_ready: boolean;
  restart_count: number;
  node_name: string;
  revision_id: number;
  created_at: string;
}

interface RevisionRecord {
  id: number;
  revision_number: number;
  image: string;
  cpu_request: number;
  memory_request: number;
  cause: string;
  created_at: string;
}

interface DeploymentDetail {
  id: number;
  name: string;
  namespace: string;
  replicas: number;
  ready_replicas: number;
  total_replicas: number;
  new_pods_count: number;
  new_pods_ready: number;
  old_pods_count: number;
  old_pods_ready: number;
  image: string;
  current_revision: number;
  max_surge: number;
  max_unavailable: number;
  is_paused: boolean;
  rollout_status: string;
  rollout_started_at?: string;
  simulated_load: number;
  cpu_request: number;
  memory_request: number;
  revisions: RevisionRecord[];
  pods: PodDetail[];
  hpa: {
    id: number;
    min_replicas: number;
    max_replicas: number;
    target_cpu_percent: number;
    is_enabled: boolean;
  } | null;
}

interface ImageOption {
  name: string;
  description: string;
}

export default function DeploymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const name = params?.name as string;
  const { isLive } = useLive();
  const { showToast } = useToast();

  const [deployment, setDeployment] = useState<DeploymentDetail | null>(null);
  const [images, setImages] = useState<ImageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Image update state
  const [selectedImage, setSelectedImage] = useState('');
  const [updatingImage, setUpdatingImage] = useState(false);

  // Load slider state
  const [loadValue, setLoadValue] = useState(0);

  // HPA config state
  const [hpaMin, setHpaMin] = useState(1);
  const [hpaMax, setHpaMax] = useState(10);
  const [hpaTarget, setHpaTarget] = useState(70);
  const [hpaEnabled, setHpaEnabled] = useState(true);
  const [savingHpa, setSavingHpa] = useState(false);

  // Chart data
  const [metricHistory, setMetricHistory] = useState<{ time: string; replicas: number; cpu: number }[]>([]);

  // Rollback dialog
  const [rollbackRev, setRollbackRev] = useState<number | null>(null);

  async function fetchDeployment() {
    try {
      const [depData, imgsData] = await Promise.all([
        apiRequest<DeploymentDetail>(`/api/deployments/${name}`),
        apiRequest<ImageOption[]>('/api/images').catch(() => []),
      ]);
      setDeployment(depData);
      if (imgsData.length > 0) setImages(imgsData);
      if (!selectedImage) setSelectedImage(depData.image);
      setLoadValue(depData.simulated_load || 0);

      if (depData.hpa) {
        setHpaMin(depData.hpa.min_replicas);
        setHpaMax(depData.hpa.max_replicas);
        setHpaTarget(depData.hpa.target_cpu_percent);
        setHpaEnabled(depData.hpa.is_enabled);
      }

      // Track metric point for mini chart
      const cap = depData.ready_replicas * (depData.cpu_request || 250);
      const calculatedCpu = cap > 0 ? Math.min(100, Math.round(((depData.simulated_load || 0) / cap) * 100)) : 0;

      setMetricHistory(prev => [
        ...prev.slice(-19),
        { time: new Date().toLocaleTimeString(), replicas: depData.ready_replicas, cpu: calculatedCpu }
      ]);

      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load deployment');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDeployment();
  }, [name]);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchDeployment, 2000);
    return () => clearInterval(interval);
  }, [isLive, name]);

  async function handleImageUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedImage) return;
    setUpdatingImage(true);
    try {
      await apiRequest(`/api/deployments/${name}`, {
        method: 'PUT',
        body: JSON.stringify({ image: selectedImage }),
      });
      showToast(`Initiated rolling update to ${selectedImage}`, 'success');
      fetchDeployment();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setUpdatingImage(false);
    }
  }

  async function handleTogglePause() {
    if (!deployment) return;
    try {
      const endpoint = deployment.is_paused ? 'resume' : 'pause';
      await apiRequest(`/api/deployments/${name}/${endpoint}`, { method: 'POST' });
      showToast(`Rollout ${deployment.is_paused ? 'resumed' : 'paused'}`, 'info');
      fetchDeployment();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  async function handleScale(delta: number) {
    if (!deployment) return;
    const newReplicas = Math.max(0, deployment.replicas + delta);
    try {
      await apiRequest(`/api/deployments/${name}/scale`, {
        method: 'PATCH',
        body: JSON.stringify({ replicas: newReplicas }),
      });
      showToast(`Scaled ${name} to ${newReplicas} replicas`, 'info');
      fetchDeployment();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  async function handleLoadChange(val: number) {
    setLoadValue(val);
    try {
      await apiRequest(`/api/deployments/${name}/load`, {
        method: 'PUT',
        body: JSON.stringify({ load: val }),
      });
    } catch (err: any) {
      console.error('Update load error:', err);
    }
  }

  async function handleHpaSave(e: React.FormEvent) {
    e.preventDefault();
    setSavingHpa(true);
    try {
      await apiRequest('/api/hpas', {
        method: 'POST',
        body: JSON.stringify({
          deployment_name: name,
          min_replicas: hpaMin,
          max_replicas: hpaMax,
          target_cpu_percent: hpaTarget,
          is_enabled: hpaEnabled,
        }),
      });
      showToast('Autoscaler policy updated', 'success');
      fetchDeployment();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSavingHpa(false);
    }
  }

  async function handleRollbackConfirm() {
    if (!rollbackRev) return;
    try {
      await apiRequest(`/api/deployments/${name}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ revision_number: rollbackRev }),
      });
      showToast(`Rolled back to revision ${rollbackRev}`, 'success');
      fetchDeployment();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setRollbackRev(null);
    }
  }

  async function handleDeletePod(podName: string) {
    try {
      await apiRequest(`/api/pods/${podName}`, { method: 'DELETE' });
      showToast(`Pod ${podName} marked for termination`, 'info');
      fetchDeployment();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  if (loading && !deployment) {
    return <Spinner className="w-10 h-10 mt-20" />;
  }

  if (error || !deployment) {
    return (
      <EmptyState
        title="Deployment not found"
        description={error || `Could not find deployment ${name}`}
        action={
          <Link href="/deployments" className="px-4 py-2 bg-amber-500 text-white rounded-lg text-xs font-semibold">
            ← Back to Deployments
          </Link>
        }
      />
    );
  }

  // Rollout progress calculation
  const totalPods = deployment.new_pods_count + deployment.old_pods_count;
  const newPercent = totalPods > 0 ? Math.round((deployment.new_pods_ready / deployment.replicas) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <Link href="/deployments" className="text-xs text-amber-500 hover:text-amber-600 font-semibold mb-1 block">
            ← Back to Deployments
          </Link>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{deployment.name}</h1>
            <Badge status={deployment.rollout_status} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Active Revision: rev {deployment.current_revision} • Image: {deployment.image}
          </p>
        </div>

        {/* Quick Scale Replicas Controls */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-xl shadow-sm">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Replicas:</span>
            <button
              onClick={() => handleScale(-1)}
              disabled={deployment.replicas <= 0}
              className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 disabled:opacity-40"
            >
              -
            </button>
            <span className="font-mono text-sm font-bold w-6 text-center">{deployment.replicas}</span>
            <button
              onClick={() => handleScale(1)}
              className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Rollout Progress Panel */}
      <Card
        title="Rolling Update Lifecycle Tracker"
        subtitle={`Strategy: maxSurge = +${deployment.max_surge}, maxUnavailable = ${deployment.max_unavailable}`}
        action={
          <div className="flex items-center space-x-2">
            <button
              onClick={handleTogglePause}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                deployment.is_paused
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
              }`}
            >
              {deployment.is_paused ? '▶ Resume Rollout' : '⏸ Pause Rollout'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] uppercase font-semibold text-slate-400">Target Replicas</span>
              <div className="text-lg font-bold text-slate-900 dark:text-white">{deployment.replicas}</div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] uppercase font-semibold text-slate-400">New Revision Pods</span>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {deployment.new_pods_ready} / {deployment.new_pods_count}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] uppercase font-semibold text-slate-400">Old Revision Pods</span>
              <div className="text-lg font-bold text-slate-500">
                {deployment.old_pods_ready} / {deployment.old_pods_count}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] uppercase font-semibold text-slate-400">Rollout Status</span>
              <div className="mt-1"><Badge status={deployment.rollout_status} /></div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
              <span>New Revision Fulfillment (rev {deployment.current_revision})</span>
              <span className="font-semibold">{newPercent}%</span>
            </div>
            <ProgressBar value={newPercent} color="emerald" />
          </div>

          {deployment.rollout_status === 'Stalled' && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 p-3 rounded-xl text-xs text-rose-800 dark:text-rose-300 flex items-center justify-between">
              <div>
                <span className="font-semibold block">Rollout Stalled: ProgressDeadlineExceeded</span>
                New pods failed to become ready within the 30-second deadline. Previous revision pods continue serving traffic.
              </div>
              <button
                onClick={() => setRollbackRev(deployment.current_revision - 1)}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition-colors shrink-0 ml-3"
              >
                Rollback Now
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Grid: Image Update & Revision History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Deploy Image Update Form */}
        <Card title="Deploy Image Update" subtitle="Trigger an automated zero-downtime rolling update">
          <form onSubmit={handleImageUpdate} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Select Target Container Image
              </label>
              <select
                value={selectedImage}
                onChange={(e) => setSelectedImage(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {images.map((img) => (
                  <option key={img.name} value={img.name}>
                    {img.name} - {img.description}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-[11px] text-slate-500">
              Applying a new image bumps the revision number, spawns new pods up to maxSurge, verifies readiness, and gracefully terminates older pods.
            </p>

            <button
              type="submit"
              disabled={updatingImage || selectedImage === deployment.image}
              className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm shadow-amber-500/20"
            >
              {updatingImage ? 'Deploying...' : 'Deploy Update'}
            </button>
          </form>
        </Card>

        {/* Revision History Table */}
        <Card className="lg:col-span-2" title="Revision History" subtitle="Rollback to any previously deployed container release">
          <Table headers={['Rev #', 'Image', 'Deployed At', 'Cause', 'Action']}>
            {deployment.revisions.map((rev) => (
              <tr key={rev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs">
                <td className="px-4 py-2.5 font-bold font-mono">
                  rev {rev.revision_number}
                  {rev.revision_number === deployment.current_revision && (
                    <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                      active
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-300">{rev.image}</td>
                <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                  {new Date(rev.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{rev.cause}</td>
                <td className="px-4 py-2.5 text-right">
                  {rev.revision_number !== deployment.current_revision && (
                    <button
                      onClick={() => setRollbackRev(rev.revision_number)}
                      className="px-2.5 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
                    >
                      Rollback
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {/* Pods Table for this deployment */}
      <Card title={`Active Pod Instances (${deployment.pods.length})`} subtitle="Live status of pods belonging to this deployment">
        <Table headers={['Pod Name', 'Node', 'Status', 'Ready', 'Restarts', 'Age', 'Action']}>
          {deployment.pods.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs">
              <td className="px-4 py-2.5 font-mono font-medium text-slate-900 dark:text-white">
                <Link href={`/pods`} className="hover:text-amber-500 transition-colors">
                  {p.name}
                </Link>
              </td>
              <td className="px-4 py-2.5 font-mono text-slate-500">{p.node_name}</td>
              <td className="px-4 py-2.5">
                <Badge status={p.status} />
              </td>
              <td className="px-4 py-2.5">
                <span className={p.is_ready ? 'text-emerald-500 font-bold' : 'text-slate-400'}>
                  {p.is_ready ? 'True' : 'False'}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-300">{p.restart_count}</td>
              <td className="px-4 py-2.5 text-slate-400">{new Date(p.created_at).toLocaleTimeString()}</td>
              <td className="px-4 py-2.5 text-right">
                <button
                  onClick={() => handleDeletePod(p.name)}
                  className="text-xs text-rose-500 hover:text-rose-700 font-medium"
                >
                  Kill
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* Autoscaler & Load Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Load Slider & Live SVG Chart */}
        <Card title="Simulated Traffic Load" subtitle="Inject compute workload demand into this deployment">
          <div className="space-y-4 pt-2">
            <div>
              <div className="flex justify-between items-center text-xs mb-2">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Load Demand:</span>
                <span className="font-mono text-amber-500 font-bold text-sm">{loadValue}m</span>
              </div>
              <input
                type="range"
                min="0"
                max="6000"
                step="100"
                value={loadValue}
                onChange={(e) => handleLoadChange(parseInt(e.target.value, 10))}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-mono">
                <span>0m (Idle)</span>
                <span>2000m (Medium)</span>
                <span>4000m (High)</span>
                <span>6000m (Overload)</span>
              </div>
            </div>

            {/* Mini SVG Telemetry Chart */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Live CPU % & Replicas</span>
                <span className="text-[11px] text-slate-400">
                  Avg CPU: {metricHistory.length > 0 ? metricHistory[metricHistory.length - 1].cpu : 0}%
                </span>
              </div>
              <div className="h-28 w-full flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 rounded-xl p-2 border border-slate-100 dark:border-slate-800">
                {metricHistory.length < 2 ? (
                  <span className="text-xs text-slate-400">Awaiting telemetry...</span>
                ) : (
                  <svg viewBox="0 0 300 90" className="w-full h-full overflow-visible">
                    <line x1="0" y1="45" x2="300" y2="45" stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeDasharray="3 3" />
                    <path
                      d={metricHistory
                        .map((m, i) => {
                          const x = (i / (metricHistory.length - 1)) * 300;
                          const y = 90 - (m.cpu / 100) * 80 - 5;
                          return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
                        })
                        .join(' ')}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2.5"
                    />
                  </svg>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* HPA Settings Form */}
        <Card title="Horizontal Pod Autoscaler (HPA)" subtitle="Automatic replica elasticity policies">
          <form onSubmit={handleHpaSave} className="space-y-4 pt-2">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="hpa-enable"
                checked={hpaEnabled}
                onChange={(e) => setHpaEnabled(e.target.checked)}
                className="w-4 h-4 accent-amber-500 rounded"
              />
              <label htmlFor="hpa-enable" className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Enable Autoscaler for this Deployment
              </label>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Min Replicas
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={hpaMin}
                  onChange={(e) => setHpaMin(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Max Replicas
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={hpaMax}
                  onChange={(e) => setHpaMax(parseInt(e.target.value, 10) || 10)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Target CPU %
                </label>
                <input
                  type="number"
                  min="10"
                  max="95"
                  value={hpaTarget}
                  onChange={(e) => setHpaTarget(parseInt(e.target.value, 10) || 70)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              Scales out when avg CPU exceeds {hpaTarget}%. Scales in when below {Math.floor(hpaTarget * 0.6)}% (with 15s stabilization window).
            </p>

            <button
              type="submit"
              disabled={savingHpa}
              className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors"
            >
              {savingHpa ? 'Saving...' : 'Save HPA Configuration'}
            </button>
          </form>
        </Card>
      </div>

      {/* Rollback Confirmation */}
      <ConfirmDialog
        isOpen={rollbackRev !== null}
        onClose={() => setRollbackRev(null)}
        onConfirm={handleRollbackConfirm}
        title={`Rollback to Revision ${rollbackRev}?`}
        message={`This will trigger a rolling update reverting ${deployment.name} back to revision ${rollbackRev}.`}
      />
    </div>
  );
}
