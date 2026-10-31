import type { MonitoredFeedStatus } from './feed/observed-status';

export const MAX_CONNECTION_ACTIVITY = 100;

export type ConnectionIndicatorState = 'idle' | 'live' | 'pending' | 'failed' | 'offline' | 'fixture';
export interface ConnectionSummary {
  state: ConnectionIndicatorState;
  label: string;
  live: number;
  pending: number;
  failed: number;
  active: number;
}
export interface ConnectionActivity {
  at: number;
  source: string;
  label: string;
  from: string;
  to: string;
  detail: string;
}

const failedStates = new Set(['failed', 'unavailable']);
const pendingStates = new Set(['starting', 'loading', 'reconnecting', 'stale', 'awaiting', 'syncing']);
const liveStates = new Set(['live', 'ready']);

export function summarizeMonitoredFeeds(feeds: readonly MonitoredFeedStatus[], online: boolean, fixtureMode: boolean): ConnectionSummary {
  const active = feeds.length;
  const live = feeds.filter(feed => feed.observed && liveStates.has(feed.state)).length;
  const failed = feeds.filter(feed => failedStates.has(feed.state)).length;
  const pending = feeds.filter(feed => !feed.observed || pendingStates.has(feed.state)
    || !liveStates.has(feed.state) && !failedStates.has(feed.state)).length;
  if (!online) return { state: 'offline', label: 'Browser offline', live, pending, failed, active };
  if (fixtureMode) return { state: 'fixture', label: 'Diagnostic fixtures', live, pending, failed, active };
  if (!active) return { state: 'idle', label: 'No monitored feeds', live: 0, pending: 0, failed: 0, active: 0 };
  if (failed === active) return { state: 'failed', label: `${failed} feed${failed === 1 ? '' : 's'} failed`, live, pending, failed, active };
  if (failed) return { state: 'pending', label: `${failed} failed · ${live} live${pending ? ` · ${pending} pending` : ''}`, live, pending, failed, active };
  if (pending) return { state: 'pending', label: `${live} live · ${pending} pending`, live, pending, failed: 0, active };
  return { state: 'live', label: `${live} monitored feed${live === 1 ? '' : 's'} live`, live, pending: 0, failed: 0, active };
}

function statusName(state: string) {
  if (state === 'live' || state === 'ready') return 'Live';
  if (state === 'starting') return 'Starting';
  if (state === 'loading' || state === 'syncing' || state === 'awaiting') return 'Waiting';
  if (state === 'failed' || state === 'unavailable') return 'Failed';
  return state.slice(0, 1).toUpperCase() + state.slice(1);
}

/** Logs observed state/message transitions only; timestamps and revisions do not create entries. */
export class ConnectionActivityLog {
  private previous = new Map<string, { source: string; label: string; state: string; message: string; observed: boolean }>();
  private previousOnline?: boolean;
  private rows: ConnectionActivity[] = [];

  update(feeds: readonly MonitoredFeedStatus[], online: boolean, now = Date.now()) {
    const current = new Map(feeds.map(feed => [feed.key, feed]));
    for (const feed of feeds) {
      const before = this.previous.get(feed.key);
      if (feed.observed && (!before?.observed || before.state !== feed.state || before.message !== feed.message)) {
        this.add({ at: now, source: feed.source, label: feed.label,
          from: before?.observed ? statusName(before.state) : before ? 'Starting' : 'New', to: statusName(feed.state), detail: feed.message });
      }
      this.previous.set(feed.key, { source: feed.source, label: feed.label, state: feed.state, message: feed.message, observed: feed.observed });
    }
    for (const [key, before] of this.previous) {
      if (current.has(key)) continue;
      if (before.observed) this.add({ at: now, source: before.source, label: before.label, from: statusName(before.state), to: 'Idle', detail: 'No active subscription' });
      this.previous.delete(key);
    }
    if (this.previousOnline !== undefined && this.previousOnline !== online) {
      this.add({ at: now, source: 'browser', label: 'Browser network', from: this.previousOnline ? 'Online' : 'Offline', to: online ? 'Online' : 'Offline', detail: online ? 'Browser reports online' : 'Browser reports offline' });
    }
    this.previousOnline = online;
  }

  clear() { this.rows = []; }
  snapshot() { return this.rows.map(row => ({ ...row })); }

  private add(row: ConnectionActivity) {
    this.rows.unshift(row);
    if (this.rows.length > MAX_CONNECTION_ACTIVITY) this.rows.length = MAX_CONNECTION_ACTIVITY;
  }
}
