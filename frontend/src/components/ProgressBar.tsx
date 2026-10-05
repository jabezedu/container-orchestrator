import React from 'react';

interface ProgressBarProps {
  value: number; // 0 to 100
  label?: string;
  sublabel?: string;
  color?: 'amber' | 'emerald' | 'rose' | 'sky' | 'slate';
  className?: string;
}

export function ProgressBar({ value, label, sublabel, color = 'amber', className = '' }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  const colorStyles = {
    amber: 'bg-amber-500',
    emerald: 'bg-emerald-500',
    rose: 'bg-rose-500',
    sky: 'bg-sky-500',
    slate: 'bg-slate-500',
  };

  // Determine dynamic alert color if not specified
  let barColor = colorStyles[color];
  if (color === 'amber' && clamped >= 85) {
    barColor = 'bg-rose-500';
  } else if (color === 'amber' && clamped >= 70) {
    barColor = 'bg-amber-500';
  }

  return (
    <div className={`w-full ${className}`}>
      {(label || sublabel) && (
        <div className="flex justify-between text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          <span>{label}</span>
          <span>{sublabel || `${clamped}%`}</span>
        </div>
      )}
      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
