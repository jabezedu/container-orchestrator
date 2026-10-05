'use client';

import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '@/lib/api';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Table, Spinner, EmptyState } from '@/components/Table';
import { useLive } from '@/components/LiveContext';

interface EventItem {
  id: number;
  type: string;
  reason: string;
  object_kind: string;
  object_name: string;
  message: string;
  created_at: string;
}

export default function EventsPage() {
  const { isLive } = useLive();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  async function fetchEvents() {
    try {
      const queryParams = new URLSearchParams();
      if (typeFilter) queryParams.set('type', typeFilter);
      if (kindFilter) queryParams.set('object_kind', kindFilter);
      if (search) queryParams.set('search', search);
      queryParams.set('limit', '200');

      const data = await apiRequest<EventItem[]>(`/api/events?${queryParams.toString()}`);
      setEvents(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve cluster events');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEvents();
  }, [typeFilter, kindFilter, search]);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchEvents, 2000);
    return () => clearInterval(interval);
  }, [isLive, typeFilter, kindFilter, search]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Cluster Events Stream</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Audit logging stream for scheduler decisions, rolling update milestones, health alerts, and autoscaling
          </p>
        </div>

        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoScroll(prev => !prev)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors flex items-center space-x-1.5 ${
            autoScroll
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border-amber-300 dark:border-amber-800'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${autoScroll ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`} />
          <span>Auto-scroll to latest: {autoScroll ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* Filter toolbar */}
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Filter by Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
            >
              <option value="">All Event Types</option>
              <option value="Normal">Normal</option>
              <option value="Warning">Warning</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Filter by Object Kind</label>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
            >
              <option value="">All Resource Kinds</option>
              <option value="Pod">Pod</option>
              <option value="Deployment">Deployment</option>
              <option value="Node">Node</option>
              <option value="HorizontalPodAutoscaler">HorizontalPodAutoscaler</option>
              <option value="Service">Service</option>
              <option value="Cluster">Cluster</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">Search Message / Reason</label>
            <input
              type="text"
              placeholder="e.g. Scheduled, FailedScheduling..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
            />
          </div>
        </div>
      </Card>

      {/* Events Stream Table */}
      <Card>
        {loading && events.length === 0 ? (
          <Spinner className="w-8 h-8 my-8" />
        ) : error && events.length === 0 ? (
          <EmptyState title="Error fetching events" description={error} />
        ) : events.length === 0 ? (
          <EmptyState title="No events recorded" description="No events match the selected criteria." />
        ) : (
          <div ref={containerRef} className="max-h-[600px] overflow-y-auto">
            <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-left text-xs font-mono">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 font-sans">
                <tr className="text-slate-500 uppercase font-semibold">
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Reason</th>
                  <th className="py-2.5 px-4">Involved Object</th>
                  <th className="py-2.5 px-4">Message</th>
                  <th className="py-2.5 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900">
                {events.map((evt) => (
                  <tr key={evt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-sans">
                      <Badge variant={evt.type === 'Normal' ? 'info' : 'warning'}>{evt.type}</Badge>
                    </td>
                    <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200">
                      {evt.reason}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                      {evt.object_kind}/{evt.object_name}
                    </td>
                    <td className="py-2.5 px-4 font-sans text-slate-600 dark:text-slate-300">
                      {evt.message}
                    </td>
                    <td className="py-2.5 px-4 text-slate-400 whitespace-nowrap">
                      {new Date(evt.created_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
