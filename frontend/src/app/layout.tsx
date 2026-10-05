import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { LiveProvider } from '@/components/LiveContext';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'KubeMini | Container Orchestrator Simulator',
  description: 'Mini Kubernetes-style container orchestrator simulator with rolling updates, autoscaling, node failure handling, and chaos engineering.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-amber-500 selection:text-white">
        <ToastProvider>
          <LiveProvider>
            <Shell>{children}</Shell>
          </LiveProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
