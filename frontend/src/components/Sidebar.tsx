'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  { name: 'Overview', href: '/', icon: '◫' },
  { name: 'Nodes', href: '/nodes', icon: '▦' },
  { name: 'Deployments', href: '/deployments', icon: '▥' },
  { name: 'Pods', href: '/pods', icon: '⬡' },
  { name: 'Services', href: '/services', icon: '⇄' },
  { name: 'Autoscaler', href: '/autoscaler', icon: '⤢' },
  { name: 'Events', href: '/events', icon: '⚡' },
  { name: 'Chaos Lab', href: '/chaos', icon: '☣' },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-slate-900 text-slate-300 border-r border-slate-800 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand header */}
        <div className="h-16 flex items-center px-6 border-b border-slate-800 justify-between">
          <Link href="/" className="flex items-center space-x-2.5">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center text-white font-bold text-lg shadow-md shadow-amber-500/20">
              ⎈
            </span>
            <div>
              <span className="font-bold text-white text-sm tracking-tight block">KubeMini</span>
              <span className="text-[10px] text-amber-400 font-mono tracking-wider block">ORCHESTRATOR</span>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden text-slate-400 hover:text-white p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <span className="mr-3 text-base">{item.icon}</span>
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Footer info */}
        <div className="p-4 border-t border-slate-800 text-xs text-slate-500 flex flex-col space-y-1">
          <div className="flex justify-between items-center text-slate-400 font-mono text-[11px]">
            <span>CLUSTER: orchestrator</span>
            <span className="text-emerald-400">● LIVE</span>
          </div>
          <span className="text-[10px]">Kubernetes v1.29-sim</span>
        </div>
      </aside>
    </>
  );
}
