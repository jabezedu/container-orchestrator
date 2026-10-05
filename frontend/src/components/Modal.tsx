import React, { useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, footer, maxWidth = 'md' }: ModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxW = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  }[maxWidth];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4 text-center">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />

        {/* Dialog panel */}
        <div
          className={`w-full ${maxW} transform overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left align-middle shadow-xl transition-all relative z-10`}
        >
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 rounded-lg p-1 text-sm inline-flex items-center"
            >
              ✕
            </button>
          </div>
          <div className="px-6 py-5 text-sm text-slate-600 dark:text-slate-300 max-h-[75vh] overflow-y-auto">
            {children}
          </div>
          {footer && (
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex justify-end space-x-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
