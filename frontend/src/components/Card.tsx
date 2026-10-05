import React from 'react';

interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, subtitle, action, children, className = '' }: CardProps) {
  return (
    <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div>
            {title && <h3 className="text-base font-semibold text-slate-900 dark:text-white leading-tight">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="flex items-center space-x-2">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
