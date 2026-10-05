'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { removeToken, apiRequest } from '@/lib/api';
import { useLive } from './LiveContext';

interface HeaderProps {
  onToggleSidebar: () => void;
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const router = useRouter();
  const { isLive, toggleLive } = useLive();
  const [clusterStatus, setClusterStatus] = useState<'Healthy' | 'Degraded'>('Healthy');
  const [ticking, setTicking] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function checkHealth() {
      try {
        const overview = await apiRequest('/api/overview');
        if (isMounted) {
          const isHealthy =
            overview.nodes.ready === overview.nodes.total &&
            overview.pods.failing === 0;
          setClusterStatus(isHealthy ? 'Healthy' : 'Degraded');
        }
      } catch (e) {
        // Ignored
      }
    }

    checkHealth();
    const interval = setInterval(checkHealth, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  async function handleManualTick() {
    try {
      setTicking(true);
      await apiRequest('/api/tick', { method: 'POST' });
    } catch (e) {
      console.error('Tick error:', e);
    } finally {
      setTimeout(() => setTicking(false), 300);
    }
  }

  function handleLogout() {
    removeToken();
    router.push('/login');
  }

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-30">
      <div className="flex items-center space-x-3">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 p-2 rounded-lg"
          aria-label="Toggle Navigation"
        >
          ☰
        </button>

        {/* Cluster Health Pill */}
        <div className="flex items-center space-x-2 bg-slate-100 dark:bg-slate-800/80 px-3 py-1 rounded-full text-xs font-medium">
          <span
            className={`w-2 h-2 rounded-full ${
              clusterStatus === 'Healthy' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-ping'
            }`}
          />
          <span className="text-slate-600 dark:text-slate-300">Cluster:</span>
          <span
            className={`font-semibold ${
              clusterStatus === 'Healthy'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {clusterStatus}
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Manual Tick Button */}
        <button
          onClick={handleManualTick}
          disabled={ticking}
          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center space-x-1"
          title="Trigger one reconcile tick"
        >
          <span>⏱</span>
          <span className="hidden sm:inline">Tick</span>
        </button>

        {/* Pause / Resume Live Toggle */}
        <button
          onClick={toggleLive}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1.5 ${
            isLive
              ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:hover:bg-amber-900/60 border border-amber-300 dark:border-amber-800'
              : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`} />
          <span>{isLive ? 'Live (2s)' : 'Paused'}</span>
        </button>

        {/* User / Logout */}
        <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden sm:block" />

        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 hidden md:inline font-mono">
            admin@demo.com
          </span>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
