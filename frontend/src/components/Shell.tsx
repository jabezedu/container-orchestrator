'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { getToken } from '@/lib/api';

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const isLoginPage = pathname === '/login';

  useEffect(() => {
    const token = getToken();
    if (!token && !isLoginPage) {
      router.push('/login');
    } else {
      setCheckingAuth(false);
    }
  }, [pathname, isLoginPage, router]);

  if (isLoginPage) {
    return <main className="min-h-screen bg-slate-50 dark:bg-slate-950">{children}</main>;
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <Header onToggleSidebar={() => setSidebarOpen(prev => !prev)} />
        <main className="flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
