import React from 'react';

interface BadgeProps {
  status?: string;
  children?: React.ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  className?: string;
}

export function Badge({ status, children, variant, className = '' }: BadgeProps) {
  const text = children || status || 'Unknown';
  const val = String(status || children || '').toLowerCase();

  let v = variant;
  if (!v) {
    if (['ready', 'complete', 'running', 'normal'].includes(val)) {
      v = 'success';
    } else if (['pending', 'containercreating', 'progressing', 'warning'].includes(val)) {
      v = 'warning';
    } else if (['crashloopbackoff', 'notready', 'stalled', 'unknown', 'failed', 'error'].includes(val)) {
      v = 'error';
    } else if (['terminating', 'paused', 'cordoned'].includes(val)) {
      v = 'neutral';
    } else {
      v = 'info';
    }
  }

  const styles = {
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300/50 dark:border-emerald-800',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300/50 dark:border-amber-800',
    error: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300/50 dark:border-rose-800',
    info: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border-sky-300/50 dark:border-sky-800',
    neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300/50 dark:border-slate-700',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[v]} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
        v === 'success' ? 'bg-emerald-500' :
        v === 'warning' ? 'bg-amber-500' :
        v === 'error' ? 'bg-rose-500' :
        v === 'info' ? 'bg-sky-500' : 'bg-slate-400'
      }`} />
      {text}
    </span>
  );
}
