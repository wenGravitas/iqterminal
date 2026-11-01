const LOCK_NAME = 'basis.hyperliquid.signing-owner.v1';
const CHANNEL_NAME = 'basis.hyperliquid.signing-owner.v1';

type OwnerMessage = { type: 'query' } | { type: 'owner' | 'released'; id: string };
export interface SigningLease { id: number }
let fallbackOwnerId = 0;

function ownerLabel() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* the label is not a credential or signing nonce */ }
  return `owner-${Date.now().toString(36)}-${(++fallbackOwnerId).toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class SigningOwner {
  readonly id = ownerLabel();
  private channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  private heldRelease: { id: number; release: () => void } | null = null;
  private activeLease: SigningLease | null = null;
  private activeRequest: { id: number; promise: Promise<void> } | null = null;
  private acquisition: { id: number; promise: Promise<SigningLease | null> } | null = null;
  private nextLeaseId = 0;
  private disposed = false;
  private owned = false;
  private otherOwner = false;
  private listeners = new Set<(owned: boolean, otherOwner: boolean) => void>();

  constructor() {
    if (!this.channel) return;
    this.channel.onmessage = event => {
      const message = event.data as OwnerMessage;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'query' && this.owned) this.channel?.postMessage({ type: 'owner', id: this.id } satisfies OwnerMessage);
      if (message.type === 'owner' && message.id !== this.id) this.otherOwner = true;
      if (message.type === 'released') this.otherOwner = false;
      this.publish();
    };
    this.channel.postMessage({ type: 'query' } satisfies OwnerMessage);
  }

  get state() { return { owned: this.owned, otherOwner: this.otherOwner, supported: typeof navigator !== 'undefined' && !!navigator.locks }; }
  subscribe(listener: (owned: boolean, otherOwner: boolean) => void) { this.listeners.add(listener); listener(this.owned, this.otherOwner); return () => this.listeners.delete(listener); }

  async acquire(): Promise<SigningLease | null> {
    if (this.disposed) throw new Error('Signing owner is closed');
    if (this.activeLease && this.owned) return this.activeLease;
    if (this.acquisition) return this.acquisition.promise;
    if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('This browser does not support Web Locks; agent signing stays locked');

    const id = ++this.nextLeaseId;
    let resolveAcquired!: (lease: SigningLease | null) => void;
    let rejectAcquired!: (error: unknown) => void;
    let settled = false;
    const acquired = new Promise<SigningLease | null>((resolve, reject) => { resolveAcquired = resolve; rejectAcquired = reject; });
    const finish = (lease: SigningLease | null) => { if (!settled) { settled = true; resolveAcquired(lease); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; rejectAcquired(error); } };
    const acquisition = { id, promise: acquired };
    this.acquisition = acquisition;

    let releaseHeld!: () => void;
    const held = new Promise<void>(resolve => { releaseHeld = resolve; });
    const request = navigator.locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock || this.disposed || this.acquisition !== acquisition) { finish(null); return; }
      const lease = { id };
      this.activeLease = lease; this.owned = true; this.otherOwner = false;
      this.heldRelease = { id, release: releaseHeld };
      this.publish();
      this.channel?.postMessage({ type: 'owner', id: this.id } satisfies OwnerMessage);
      finish(lease);
      await held;
      if (this.activeLease?.id === id) {
        this.activeLease = null; this.heldRelease = null; this.owned = false;
        this.publish();
        this.channel?.postMessage({ type: 'released', id: this.id } satisfies OwnerMessage);
      }
    }).catch(error => {
      if (this.acquisition === acquisition) this.acquisition = null;
      if (this.activeLease?.id === id) { this.activeLease = null; this.heldRelease = null; this.owned = false; this.publish(); }
      fail(error);
      // The rejection is reported through the separate `acquired` promise.
      // Consume this Web Locks request rejection as well so callers that
      // handle acquire() do not leave an unhandled secondary rejection.
    });
    this.activeRequest = { id, promise: request };
    try { return await acquired; }
    finally {
      if (this.acquisition === acquisition) this.acquisition = null;
      if (this.activeRequest?.id === id && !this.activeLease) this.activeRequest = null;
    }
  }

  async release(lease?: SigningLease) {
    if (lease && this.activeLease?.id !== lease.id) return;
    const activeId = this.activeLease?.id;
    if (activeId !== undefined) {
      if (lease && lease.id !== activeId) return;
      const request = this.activeRequest?.id === activeId ? this.activeRequest.promise : null;
      this.activeLease = null; this.owned = false;
      const held = this.heldRelease?.id === activeId ? this.heldRelease.release : null;
      this.heldRelease = null;
      this.publish();
      this.channel?.postMessage({ type: 'released', id: this.id } satisfies OwnerMessage);
      held?.();
      await request?.catch(() => {});
      if (this.activeRequest?.id === activeId) this.activeRequest = null;
      return;
    }
    if (lease) return;
    // Releasing without a lease is the explicit cancellation path for a
    // controller that is still awaiting this acquisition callback.
    this.acquisition = null;
    const pendingRequest = this.activeRequest;
    this.activeRequest = null;
    if (pendingRequest) void pendingRequest.promise.catch(() => {});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    void this.release();
    this.channel?.close();
    this.listeners.clear();
  }

  private publish() { for (const listener of this.listeners) listener(this.owned, this.otherOwner); }
}
