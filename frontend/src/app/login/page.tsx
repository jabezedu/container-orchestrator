'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest, setToken } from '@/lib/api';
import { useToast } from '@/components/Toast';

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState('admin@demo.com');
  const [password, setPassword] = useState('demo123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      setToken(data.token);
      showToast('Logged in successfully', 'success');
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-amber-500/30 mx-auto mb-4">
            ⎈
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">KubeMini Console</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Mini Kubernetes-style Container Orchestrator Simulator
          </p>
        </div>

        {/* Demo Credentials Box */}
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 rounded-xl p-3.5 mb-6 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-semibold mb-1 flex items-center">
            <span className="mr-1.5">🔑</span> Demo Credentials:
          </div>
          <div className="font-mono text-[11px] space-y-0.5">
            <div>Email: <span className="font-semibold">admin@demo.com</span></div>
            <div>Password: <span className="font-semibold">demo123</span></div>
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs rounded-lg p-3 mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 dark:text-white"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium text-sm rounded-xl transition-colors shadow-md shadow-amber-500/20"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
