'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Table, Spinner, EmptyState } from '@/components/Table';
import { useToast } from '@/components/Toast';
import { useLive } from '@/components/LiveContext';

interface DeploymentItem {
  id: number;
  name: string;
  namespace: string;
  replicas: number;
  ready_replicas: number;
  total_replicas: number;
  image: string;
  current_revision: number;
  max_surge: number;
  max_unavailable: number;
  is_paused: boolean;
  rollout_status: string;
  cpu_request: number;
  memory_request: number;
}

interface ImageOption {
  name: string;
  defaultCpu: number;
  defaultMemory: number;
  description: string;
}

export default function DeploymentsPage() {
  const { isLive } = useLive();
  const { showToast } = useToast();
  const [deployments, setDeployments] = useState<DeploymentItem[]>([]);
  const [images, setImages] = useState<ImageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [selectedImage, setSelectedImage] = useState('nginx:1.25');
  const [replicas, setReplicas] = useState(2);
  const [cpuRequest, setCpuRequest] = useState(250);
  const [memoryRequest, setMemoryRequest] = useState(256);
  const [maxSurge, setMaxSurge] = useState(1);
  const [maxUnavailable, setMaxUnavailable] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Confirm delete dialog
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    name: string;
  }>({
    isOpen: false,
    name: '',
  });

  async function fetchDeployments() {
    try {
      const [depsData, imagesData] = await Promise.all([
        apiRequest<DeploymentItem[]>('/api/deployments'),
        apiRequest<ImageOption[]>('/api/images').catch(() => []),
      ]);
      setDeployments(depsData);
      if (imagesData.length > 0) setImages(imagesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load deployments');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDeployments();
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchDeployments, 2000);
    return () => clearInterval(interval);
  }, [isLive]);

  function handleImageChange(imgName: string) {
    setSelectedImage(imgName);
    const found = images.find(img => img.name === imgName);
    if (found) {
      setCpuRequest(found.defaultCpu);
      setMemoryRequest(found.defaultMemory);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/api/deployments', {
        method: 'POST',
        body: JSON.stringify({
          name,
          image: selectedImage,
          replicas,
          cpu_request: cpuRequest,
          memory_request: memoryRequest,
          max_surge: maxSurge,
          max_unavailable: maxUnavailable,
        }),
      });
      showToast(`Deployment ${name} created`, 'success');
      setIsCreateOpen(false);
      setName('');
      fetchDeployments();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleScale(dep: DeploymentItem, delta: number) {
    const newReplicas = Math.max(0, dep.replicas + delta);
    try {
      await apiRequest(`/api/deployments/${dep.name}/scale`, {
        method: 'PATCH',
        body: JSON.stringify({ replicas: newReplicas }),
      });
      showToast(`Scaled ${dep.name} to ${newReplicas} replicas`, 'info');
      fetchDeployments();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  async function handleDelete() {
    try {
      await apiRequest(`/api/deployments/${deleteDialog.name}`, { method: 'DELETE' });
      showToast(`Deployment ${deleteDialog.name} deleted`, 'success');
      fetchDeployments();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Deployments</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Declarative workload specs with automated replica controllers, rolling updates, and pause/resume
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm shadow-amber-500/20"
        >
          + Create Deployment
        </button>
      </div>

      <Card>
        {loading && deployments.length === 0 ? (
          <Spinner className="w-8 h-8 my-8" />
        ) : error && deployments.length === 0 ? (
          <EmptyState title="Failed to load deployments" description={error} />
        ) : deployments.length === 0 ? (
          <EmptyState
            title="No deployments configured"
            description="Create your first deployment to start orchestrating container pods."
            action={
              <button
                onClick={() => setIsCreateOpen(true)}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg text-xs font-semibold"
              >
                Create Deployment
              </button>
            }
          />
        ) : (
          <Table
            headers={[
              'Name',
              'Ready / Desired',
              'Image',
              'Revision',
              'Update Strategy',
              'Status',
              'Scale Replicas',
              'Actions',
            ]}
          >
            {deployments.map((dep) => (
              <tr key={dep.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                  <Link
                    href={`/deployments/${dep.name}`}
                    className="hover:text-amber-500 transition-colors flex items-center space-x-1.5"
                  >
                    <span>{dep.name}</span>
                    <span className="text-xs text-slate-400">↗</span>
                  </Link>
                </td>

                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-semibold">
                    <span
                      className={
                        dep.ready_replicas === dep.replicas
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {dep.ready_replicas}
                    </span>
                    <span className="text-slate-400">/{dep.replicas}</span>
                  </span>
                </td>

                <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                  {dep.image}
                </td>

                <td className="px-4 py-3 font-mono text-xs text-slate-500">
                  rev {dep.current_revision}
                </td>

                <td className="px-4 py-3 text-xs text-slate-500">
                  Surge: +{dep.max_surge}, Unavail: {dep.max_unavailable}
                </td>

                <td className="px-4 py-3">
                  <Badge status={dep.rollout_status} />
                </td>

                {/* Inline Scale Controls */}
                <td className="px-4 py-3">
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handleScale(dep, -1)}
                      disabled={dep.replicas <= 0}
                      className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 text-xs font-bold flex items-center justify-center"
                    >
                      -
                    </button>
                    <span className="font-mono text-xs font-semibold w-5 text-center">
                      {dep.replicas}
                    </span>
                    <button
                      onClick={() => handleScale(dep, 1)}
                      className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>
                </td>

                {/* Actions */}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/deployments/${dep.name}`}
                      className="text-xs text-amber-500 hover:text-amber-600 font-medium"
                    >
                      Inspect
                    </Link>
                    <button
                      onClick={() => setDeleteDialog({ isOpen: true, name: dep.name })}
                      className="text-xs text-slate-400 hover:text-rose-600 transition-colors"
                      title="Delete deployment"
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

      {/* Create Deployment Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Deployment"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Deployment Name
            </label>
            <input
              type="text"
              placeholder="e.g. order-service"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Container Image
            </label>
            <select
              value={selectedImage}
              onChange={(e) => handleImageChange(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {images.map((img) => (
                <option key={img.name} value={img.name}>
                  {img.name} ({img.description})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Replicas
              </label>
              <input
                type="number"
                min="0"
                max="20"
                value={replicas}
                onChange={(e) => setReplicas(parseInt(e.target.value, 10) || 0)}
                required
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                CPU Request (m)
              </label>
              <input
                type="number"
                min="50"
                max="4000"
                step="50"
                value={cpuRequest}
                onChange={(e) => setCpuRequest(parseInt(e.target.value, 10) || 250)}
                required
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                RAM (MB)
              </label>
              <input
                type="number"
                min="64"
                max="8192"
                step="64"
                value={memoryRequest}
                onChange={(e) => setMemoryRequest(parseInt(e.target.value, 10) || 256)}
                required
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                maxSurge
              </label>
              <input
                type="number"
                min="1"
                max="5"
                value={maxSurge}
                onChange={(e) => setMaxSurge(parseInt(e.target.value, 10) || 1)}
                required
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                maxUnavail
              </label>
              <input
                type="number"
                min="0"
                max="5"
                value={maxUnavailable}
                onChange={(e) => setMaxUnavailable(parseInt(e.target.value, 10) || 0)}
                required
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
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
              {submitting ? 'Creating...' : 'Deploy'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm Delete */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, name: '' })}
        onConfirm={handleDelete}
        title={`Delete Deployment ${deleteDialog.name}?`}
        message={`This will terminate and clean up all replica pods managed by deployment ${deleteDialog.name}.`}
        isDestructive={true}
      />
    </div>
  );
}
