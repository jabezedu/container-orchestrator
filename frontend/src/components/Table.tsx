import React from 'react';

interface TableProps {
  headers: React.ReactNode[];
  children: React.ReactNode;
  className?: string;
}

export function Table({ headers, children, className = '' }: TableProps) {
  return (
    <div className={`overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl ${className}`}>
      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            {headers.map((header, idx) => (
              <th
                key={idx}
                scope="col"
                className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({
  title = 'No items found',
  description = 'No resources exist in this view yet.',
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-12 px-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-800">
      <div className="w-12 h-12 mx-auto rounded-full bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-500 text-xl font-bold mb-3">
        ⬡
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <div className="flex justify-center items-center py-4">
      <div
        className={`${className} border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin`}
      />
    </div>
  );
}
