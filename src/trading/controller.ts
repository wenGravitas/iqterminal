import {
  isEvmAddress, normalizeAddress, TRADING_DEFAULTS, TRADING_SNAPSHOT_KEY,
  type OrderAttempt, type OrderIntent, type TradingNetwork, type TradingSnapshot,
} from './model';
import type { TradingWorkerEvent, TradingWorkerRequest } from './protocol';
import { SigningOwner, type SigningLease } from './owner';

export interface TradingConfig {
  version: 1;
  network: TradingNetwork;
  principal: string;
  connected: boolean;
  inactivityMinutes: number;
}

export interface VaultState {
  address: string | null;
  unlocked: boolean;
  exists: boolean;
  legacyNeedsBinding: boolean;
  storageAvailable: boolean | null;
  sessionOnly: boolean;
  sessionOnlyAvailable: boolean;
  error: string | null;
}

export interface SigningOwnerState { owned: boolean; otherOwner: boolean; supported: boolean }

export interface TradingControllerState {
  config: TradingConfig;
  snapshot: TradingSnapshot;
  vault: VaultState;
  owner: SigningOwnerState;
  attempts: OrderAttempt[];
  busy: number;
  executionDisabled: boolean;
}

const ATTEMPT_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 45_000;
export const FIXTURE_EXECUTION_DISABLED = 'Agent key handling and exchange actions are disabled while diagnostic fixture mode is selected';
const FIXTURE_BLOCKED_REQUESTS = new Set<TradingWorkerRequest['type']>([
  'vault-generate', 'vault-import', 'vault-session-generate', 'vault-session-import', 'vault-unlock',
  'submit-order', 'modify-order', 'cancel-order', 'set-leverage',
]);
export const DEFAULT_INACTIVITY_MINUTES = 15;
export const MIN_INACTIVITY_MINUTES = 1;
export const MAX_INACTIVITY_MINUTES = 120;
const EMPTY_SNAPSHOT = (network: TradingNetwork, principal: string): TradingSnapshot => ({
  network, principal, feedState: 'disconnected', lastMessageAt: 0, lastSnapshotAt: 0,
  accountValue: null, marginUsed: null, withdrawable: null, totalNotional: null,
  positions: [], orders: [], fills: [], midPrice: null, midPriceUpdatedAt: 0, markPrice: null, markPriceUpdatedAt: 0, szDecimals: null, btcAsset: null,
  agentAddress: null, agentAuthorized: false, agentValidUntil: null, error: null,
});

export function restoreTradingConfig(raw: string | null): TradingConfig {
  if (raw && raw.length <= 4_096) {
    try {
      const value = JSON.parse(raw) as Partial<TradingConfig>;
      if (value.version === 1 && (value.network === 'testnet' || value.network === 'mainnet')
        && typeof value.principal === 'string' && value.principal.length <= 64) {
        const principal = isEvmAddress(value.principal) ? normalizeAddress(value.principal) : '';
        const inactivityMinutes = Number.isInteger(value.inactivityMinutes)
          && value.inactivityMinutes! >= MIN_INACTIVITY_MINUTES && value.inactivityMinutes! <= MAX_INACTIVITY_MINUTES
          ? value.inactivityMinutes! : DEFAULT_INACTIVITY_MINUTES;
        return {
          version: 1, network: value.network, principal,
          connected: typeof value.connected === 'boolean' ? value.connected && !!principal : !!principal,
          inactivityMinutes,
        };
      }
    } catch { /* use safe defaults */ }
  }
  return { version: 1, network: TRADING_DEFAULTS.network, principal: '', connected: false, inactivityMinutes: DEFAULT_INACTIVITY_MINUTES };
}

function attemptStorageKey(network: TradingNetwork, principal: string) {
  return `${TRADING_SNAPSHOT_KEY}.attempts:${network}:${normalizeAddress(principal)}`;
}

function validAttempt(value: unknown, network: TradingNetwork, principal: string): value is OrderAttempt {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<OrderAttempt>;
  return item.network === network && typeof item.principal === 'string' && normalizeAddress(item.principal) === normalizeAddress(principal)
    && typeof item.cloid === 'string' && /^0x[0-9a-f]{32}$/.test(item.cloid)
    && item.intent !== undefined && ['buy', 'sell'].includes(item.intent.side)
    && typeof item.intent.size === 'string' && typeof item.intent.price === 'string'
    && typeof item.intent.reduceOnly === 'boolean' && ['Gtc', 'Ioc'].includes(item.intent.tif)
    && ['submitting', 'resting', 'partiallyFilled', 'filled', 'triggering', 'canceled', 'rejected', 'unknown'].includes(item.phase ?? '')
    && (item.filledSize === undefined || typeof item.filledSize === 'string' && item.filledSize.length <= 64)
    && (item.remainingSize === undefined || typeof item.remainingSize === 'string' && item.remainingSize.length <= 64)
    && typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
    && typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
    && typeof item.message === 'string' && item.message.length <= 300;
}

function restoreAttempts(network: TradingNetwork, principal: string): OrderAttempt[] {
  if (!principal) return [];
  try {
    const raw = localStorage.getItem(attemptStorageKey(network, principal));
    if (!raw || raw.length > 120_000) return [];
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(item => validAttempt(item, network, principal)).slice(-ATTEMPT_LIMIT)
      .map(item => ({ ...item, filledSize: item.filledSize ?? '0', remainingSize: item.remainingSize ?? item.intent.size })) : [];
  } catch { return []; }
}

function safeOwnerState(owner: SigningOwner): SigningOwnerState { return owner.state; }

/** Owns the public account worker and serializes access to its in-memory signer. */
export class TradingController {
  private worker: Worker | null = null;
  private readonly workerFactory: () => Worker;
  private readonly owner: SigningOwner;
  private readonly fixtureMode: boolean;
  private readonly listeners = new Set<(state: TradingControllerState) => void>();
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private dead = false;
  private configValue: TradingConfig;
  private snapshotValue: TradingSnapshot;
  private vaultValue: VaultState = { address: null, unlocked: false, exists: false, legacyNeedsBinding: false, storageAvailable: null, sessionOnly: false, sessionOnlyAvailable: false, error: null };
  private ownerValue: SigningOwnerState;
  private attemptsValue: OrderAttempt[];
  private busyValue = 0;
  private ownerLease: SigningLease | null = null;
  private ownerActionGeneration = 0;
  private ownerTransitionBusy = false;
  private pendingLegacyBinding: { token: string; network: TradingNetwork; principal: string; address: string; generation: number } | null = null;
  readonly ready: Promise<unknown>;

  constructor(options: { workerFactory?: () => Worker; owner?: SigningOwner; fixtureMode?: boolean } = {}) {
    this.fixtureMode = options.fixtureMode === true;
    this.configValue = restoreTradingConfig(localStorage.getItem(TRADING_SNAPSHOT_KEY));
    this.snapshotValue = EMPTY_SNAPSHOT(this.configValue.network, this.configValue.principal);
    this.attemptsValue = restoreAttempts(this.configValue.network, this.configValue.principal);
    this.owner = options.owner ?? new SigningOwner();
    this.ownerValue = safeOwnerState(this.owner);
    this.workerFactory = options.workerFactory ?? (() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'hyperliquid-trading' }));
    this.owner.subscribe((owned, otherOwner) => {
      this.ownerValue = { ...safeOwnerState(this.owner), owned, otherOwner };
      this.publish();
    });
    // A remembered principal needs public state restored immediately. A fresh
    // workspace does not need to download the trading SDK worker until the
    // user connects or opens a vault action.
    this.ready = this.configValue.connected && this.configValue.principal ? this.configureWorker() : Promise.resolve(undefined);
  }

  get state(): TradingControllerState {
    return {
      config: { ...this.configValue }, snapshot: this.snapshotValue, vault: { ...this.vaultValue },
      owner: { ...this.ownerValue }, attempts: [...this.attemptsValue], busy: this.busyValue + Number(this.ownerTransitionBusy),
      executionDisabled: this.fixtureMode,
    };
  }

  subscribe(listener: (state: TradingControllerState) => void, signal?: AbortSignal) {
    this.listeners.add(listener); listener(this.state);
    signal?.addEventListener('abort', () => this.listeners.delete(listener), { once: true });
    return () => this.listeners.delete(listener);
  }

  async setConfig(network: TradingNetwork, principal: string) {
    const normalized = isEvmAddress(principal) ? normalizeAddress(principal) : '';
    if (network === this.configValue.network && normalized === this.configValue.principal && this.configValue.connected) return;
    await this.lock().catch(() => {});
    this.configValue = { ...this.configValue, version: 1, network, principal: normalized, connected: Boolean(normalized) };
    this.snapshotValue = EMPTY_SNAPSHOT(network, normalized);
    this.vaultValue = { ...this.vaultValue, address: null, unlocked: false, exists: false, legacyNeedsBinding: false,
      sessionOnly: false, error: null };
    this.attemptsValue = restoreAttempts(network, normalized);
    try { localStorage.setItem(TRADING_SNAPSHOT_KEY, JSON.stringify(this.configValue)); }
    catch { this.vaultValue = { ...this.vaultValue, error: 'Account settings are session-only because browser storage is unavailable' }; }
    this.publish();
    await this.configureWorker();
  }

  async disconnect() {
    if (!this.configValue.connected) return;
    await this.lock().catch(() => {});
    this.configValue = { ...this.configValue, connected: false };
    this.snapshotValue = EMPTY_SNAPSHOT(this.configValue.network, '');
    this.vaultValue = { ...this.vaultValue, address: null, unlocked: false, exists: false, legacyNeedsBinding: false,
      sessionOnly: false, error: null };
    try { localStorage.setItem(TRADING_SNAPSHOT_KEY, JSON.stringify(this.configValue)); }
    catch { this.vaultValue = { ...this.vaultValue, error: 'Disconnect is session-only because browser storage is unavailable' }; }
    this.publish();
    await this.configureWorker();
  }

  async forgetDevice() {
    await this.lock().catch(() => {});
    await this.request('vault-forget');
    const prefix = `${TRADING_SNAPSHOT_KEY}.attempts:`;
    try {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (key === TRADING_SNAPSHOT_KEY || key?.startsWith(prefix)) localStorage.removeItem(key);
      }
    } catch { /* an unavailable browser store is already session-only */ }
    this.configValue = { version: 1, network: TRADING_DEFAULTS.network, principal: '', connected: false, inactivityMinutes: DEFAULT_INACTIVITY_MINUTES };
    this.snapshotValue = EMPTY_SNAPSHOT(this.configValue.network, '');
    this.attemptsValue = [];
    this.vaultValue = {
      address: null, exists: false, unlocked: false, sessionOnly: false,
      legacyNeedsBinding: false,
      storageAvailable: this.vaultValue.storageAvailable,
      sessionOnlyAvailable: this.vaultValue.sessionOnlyAvailable,
      error: this.vaultValue.storageAvailable === false ? 'Encrypted key was session-only and has been discarded' : null,
    };
    this.publish();
    if (this.worker) await this.configureWorker();
  }

  async setInactivityMinutes(value: number) {
    if (!Number.isInteger(value) || value < MIN_INACTIVITY_MINUTES || value > MAX_INACTIVITY_MINUTES) {
      throw new RangeError(`Lock timeout must be ${MIN_INACTIVITY_MINUTES}–${MAX_INACTIVITY_MINUTES} minutes`);
    }
    if (this.configValue.inactivityMinutes === value) return;
    this.configValue = { ...this.configValue, inactivityMinutes: value };
    try { localStorage.setItem(TRADING_SNAPSHOT_KEY, JSON.stringify(this.configValue)); }
    catch { this.vaultValue = { ...this.vaultValue, error: 'Lock timeout is session-only because browser storage is unavailable' }; }
    this.publish(); this.activity();
    if (this.worker) await this.request('set-inactivity-timeout', { minutes: value });
  }

  refresh() { return this.request('refresh'); }
  generateAgent(passphrase: string) { return this.request('vault-generate', { passphrase }); }
  importAgent(privateKey: string, passphrase: string) { return this.request('vault-import', { privateKey, passphrase }); }
  async removeAgent() { await this.lock(); return this.request('vault-remove'); }

  async generateSessionAgent() { return this.sessionAgentRequest('vault-session-generate'); }
  async importSessionAgent(privateKey: string) { return this.sessionAgentRequest('vault-session-import', { privateKey }); }

  private beginOwnerTransition() {
    if (this.ownerTransitionBusy) throw new Error('Another agent vault action is already in progress');
    this.ownerTransitionBusy = true;
    const generation = ++this.ownerActionGeneration;
    this.publish();
    return generation;
  }

  private assertOwnerTransitionCurrent(generation: number) {
    if (this.dead || generation !== this.ownerActionGeneration) throw new Error('Agent action was canceled because the selected account or lock state changed');
  }

  private finishOwnerTransition(generation: number) {
    if (generation !== this.ownerActionGeneration) return;
    this.ownerTransitionBusy = false;
    this.publish();
  }

  private async releaseOwnerLease(lease: SigningLease | null | undefined) {
    if (!lease) { await this.owner.release(); return; }
    if (this.ownerLease?.id === lease.id) this.ownerLease = null;
    await this.owner.release(lease);
  }

  private async sessionAgentRequest(type: 'vault-session-generate' | 'vault-session-import', fields: Record<string, unknown> = {}) {
    if (this.fixtureMode) throw new Error(FIXTURE_EXECUTION_DISABLED);
    if (!this.configValue.connected || !this.configValue.principal) throw new Error('Connect an account before creating a session-only agent');
    if (this.vaultValue.storageAvailable !== false || !this.vaultValue.sessionOnlyAvailable) throw new Error('Session-only mode is available only when IndexedDB is unavailable and secure signing is supported');
    const generation = this.beginOwnerTransition();
    let lease: SigningLease | null = null;
    try {
      lease = await this.owner.acquire();
      this.assertOwnerTransitionCurrent(generation);
      if (!lease) throw new Error('Another tab owns the signing session; lock it there before continuing');
      this.ownerLease = lease;
      const value = await this.request(type, fields);
      this.assertOwnerTransitionCurrent(generation);
      return value;
    } catch (error) {
      if (lease) await this.releaseOwnerLease(lease);
      throw error;
    } finally { this.finishOwnerTransition(generation); }
  }

  async unlock(passphrase: string) {
    if (this.fixtureMode) throw new Error(FIXTURE_EXECUTION_DISABLED);
    if (!this.configValue.connected || !this.configValue.principal) throw new Error('Connect a principal address before unlocking the agent');
    const generation = this.beginOwnerTransition();
    let lease: SigningLease | null = null;
    try {
      lease = await this.owner.acquire();
      this.assertOwnerTransitionCurrent(generation);
      if (!lease) throw new Error('Another tab owns the signing session; lock it there before unlocking here');
      this.ownerLease = lease;
      const value = await this.request('vault-unlock', { passphrase });
      this.assertOwnerTransitionCurrent(generation);
      if (value && typeof value === 'object' && (value as Record<string, unknown>).legacyBindingRequired === true) {
        const prompt = value as Record<string, unknown>;
        const network = prompt.network, principal = prompt.principal, address = prompt.address, token = prompt.token;
        if ((network !== 'mainnet' && network !== 'testnet') || typeof principal !== 'string' || typeof address !== 'string'
          || typeof token !== 'string' || normalizeAddress(principal) !== normalizeAddress(this.configValue.principal)
          || network !== this.configValue.network) throw new Error('Legacy key binding response does not match the selected account');
        this.pendingLegacyBinding = { token, network, principal: normalizeAddress(principal), address, generation };
        this.publish();
      }
      return value;
    } catch (error) {
      if (lease) await this.releaseOwnerLease(lease);
      throw error;
    } finally { this.finishOwnerTransition(generation); }
  }

  async bindLegacyAgent(token: string) {
    const pending = this.pendingLegacyBinding;
    if (!pending || pending.token !== token) throw new Error('Legacy key binding expired; unlock it again');
    if (pending.network !== this.configValue.network || pending.principal !== normalizeAddress(this.configValue.principal)) {
      throw new Error('Selected account changed before legacy key binding; no key was moved');
    }
    if (pending.generation !== this.ownerActionGeneration || !this.ownerLease || !this.owner.state.owned) {
      throw new Error('Signing ownership changed before legacy key binding; unlock again');
    }
    if (this.ownerTransitionBusy) throw new Error('Another agent vault action is already in progress');
    const generation = pending.generation;
    this.ownerTransitionBusy = true; this.publish();
    try {
      const value = await this.request('vault-bind-legacy', { token, network: pending.network, principal: pending.principal });
      this.assertOwnerTransitionCurrent(generation);
      this.pendingLegacyBinding = null;
      return value;
    } catch (error) {
      if (generation === this.ownerActionGeneration) {
        this.pendingLegacyBinding = null;
        const lease = this.ownerLease; this.ownerLease = null;
        if (lease) await this.owner.release(lease);
      }
      throw error;
    } finally { this.finishOwnerTransition(generation); }
  }

  async cancelLegacyBinding(token: string) {
    const pending = this.pendingLegacyBinding;
    if (!pending) return;
    if (pending.token !== token) throw new Error('Legacy key binding token does not match the pending confirmation');
    if (this.ownerTransitionBusy) throw new Error('Another agent vault action is already in progress');
    const generation = ++this.ownerActionGeneration;
    this.ownerTransitionBusy = true; this.pendingLegacyBinding = null; this.publish();
    const lease = this.ownerLease; this.ownerLease = null;
    try { await this.request('vault-cancel-legacy-binding', { token }); }
    finally {
      if (lease) await this.owner.release(lease); else await this.owner.release();
      this.finishOwnerTransition(generation);
    }
  }

  async lock() {
    const generation = ++this.ownerActionGeneration;
    this.ownerTransitionBusy = true; this.pendingLegacyBinding = null; this.publish();
    const lease = this.ownerLease; this.ownerLease = null;
    if (this.dead) {
      if (lease) await this.owner.release(lease); else await this.owner.release();
      this.finishOwnerTransition(generation); return;
    }
    try { await this.request('vault-lock'); }
    finally {
      if (lease) await this.owner.release(lease); else await this.owner.release();
      this.finishOwnerTransition(generation);
    }
  }

  async submit(intent: OrderIntent, options: { kind?: 'limit' | 'market' | 'takeProfit' | 'stopLoss'; triggerPrice?: string; slippageBps?: number } = {}) {
    return this.request('submit-order', { intent, ...options });
  }
  modify(orderId: number, price: string, size: string) { return this.request('modify-order', { orderId, price, size }); }
  cancel(orderId: number) { return this.request('cancel-order', { orderId }); }
  setLeverage(leverage: number, isCross: boolean) { return this.request('set-leverage', { leverage, isCross }); }
  reconcileAttempt(attempt: OrderAttempt) { return this.request('order-status', { cloid: attempt.cloid, attempt }); }
  activity() { this.worker?.postMessage({ type: 'activity' } satisfies TradingWorkerRequest); }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    if (this.worker) {
      this.worker.removeEventListener('message', this.onMessage as EventListener);
      this.worker.removeEventListener('error', this.onWorkerError as EventListener);
      this.worker.postMessage({ type: 'dispose' } satisfies TradingWorkerRequest);
      this.worker.terminate();
      this.worker = null;
    }
    this.owner.dispose();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer); pending.reject(new Error('Trading worker was closed')); this.pending.delete(id);
    }
    this.listeners.clear();
  }

  private async configureWorker() {
    const restoredAttempts = this.attemptsValue.map(attempt => attempt.phase === 'submitting'
      ? { ...attempt, phase: 'unknown' as const, updatedAt: Date.now(), message: 'The previous browser session ended during submission. Check this client order ID; do not resubmit.' }
      : attempt);
    const result = await this.request('configure', {
      network: this.configValue.network, principal: this.configValue.connected ? this.configValue.principal : '',
      inactivityMinutes: this.configValue.inactivityMinutes, fixtureMode: this.fixtureMode, attempts: restoredAttempts,
    });
    await this.request('vault-info');
    if (!this.configValue.connected) return result;
    for (const attempt of [...this.attemptsValue]) {
      const restored = attempt.phase === 'submitting'
        ? { ...attempt, phase: 'unknown' as const, updatedAt: Date.now(), message: 'The previous browser session ended during submission. Check this client order ID; do not resubmit.' }
        : attempt;
      if (restored !== attempt) this.saveAttempt(restored);
      if (['unknown', 'submitting', 'resting', 'partiallyFilled', 'triggering'].includes(restored.phase)) {
        void this.reconcileAttempt(restored).catch(() => {});
      }
    }
    return result;
  }

  private request(type: TradingWorkerRequest['type'], fields: Record<string, unknown> = {}): Promise<unknown> {
    if (this.dead) return Promise.reject(new Error('Trading controller is closed'));
    if (this.fixtureMode && FIXTURE_BLOCKED_REQUESTS.has(type)) return Promise.reject(new Error(FIXTURE_EXECUTION_DISABLED));
    const worker = this.ensureWorker();
    const id = ++this.nextId;
    const message = { type, id, ...fields } as TradingWorkerRequest;
    this.busyValue++;
    this.publish();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); this.busyValue = Math.max(0, this.busyValue - 1); this.publish();
        reject(new Error('Hyperliquid request timed out. Refresh status before trying the action again.'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage(message);
    });
  }

  private ensureWorker() {
    if (this.dead) throw new Error('Trading controller is closed');
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.worker.addEventListener('message', this.onMessage as EventListener);
      this.worker.addEventListener('error', this.onWorkerError as EventListener);
    }
    return this.worker;
  }

  private onMessage = (event: MessageEvent<TradingWorkerEvent>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'snapshot') {
      const expectedPrincipal = this.configValue.connected ? this.configValue.principal : '';
      if (message.snapshot.network !== this.configValue.network || normalizeAddress(message.snapshot.principal) !== normalizeAddress(expectedPrincipal)) return;
      this.snapshotValue = message.snapshot; this.publish(); return;
    }
    if (message.type === 'attempt') { this.saveAttempt(message.attempt); return; }
    if (message.type === 'vault-state') {
      const expectedPrincipal = this.configValue.connected ? this.configValue.principal : '';
      if (message.network !== this.configValue.network || normalizeAddress(message.principal) !== normalizeAddress(expectedPrincipal)) return;
      this.vaultValue = {
        address: message.address, exists: message.exists, unlocked: message.unlocked,
        legacyNeedsBinding: message.legacyNeedsBinding ?? false,
        storageAvailable: message.storageAvailable === undefined ? this.vaultValue.storageAvailable : message.storageAvailable,
        sessionOnly: message.sessionOnly ?? false,
        sessionOnlyAvailable: message.sessionOnlyAvailable ?? this.vaultValue.sessionOnlyAvailable,
        error: message.error ?? null,
      };
      this.publish();
      if (message.releaseOwner) {
        this.ownerActionGeneration++;
        this.ownerTransitionBusy = false;
        this.pendingLegacyBinding = null;
        const lease = this.ownerLease; this.ownerLease = null;
        void (lease ? this.owner.release(lease) : this.owner.release());
      }
      return;
    }
    if (message.type !== 'result') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    this.busyValue = Math.max(0, this.busyValue - 1); this.publish();
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.value);
  };

  private onWorkerError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'Hyperliquid trading worker failed');
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer); pending.reject(error); this.pending.delete(id);
    }
    this.busyValue = 0;
    this.snapshotValue = { ...this.snapshotValue, feedState: 'failed', error: error.message };
    this.publish();
  };

  private saveAttempt(attempt: OrderAttempt) {
    if (!validAttempt(attempt, attempt.network, attempt.principal)) return;
    const key = attempt.cloid.toLowerCase();
    const currentPrincipal = this.configValue.connected ? this.configValue.principal : '';
    if (attempt.network !== this.configValue.network || normalizeAddress(attempt.principal) !== normalizeAddress(currentPrincipal)) {
      const accountAttempts = restoreAttempts(attempt.network, attempt.principal);
      const merged = [...accountAttempts.filter(item => item.cloid.toLowerCase() !== key), { ...attempt }].slice(-ATTEMPT_LIMIT);
      try { localStorage.setItem(attemptStorageKey(attempt.network, attempt.principal), JSON.stringify(merged)); }
      catch { /* retain the active account view when another account's late event arrives */ }
      return;
    }
    this.attemptsValue = [...this.attemptsValue.filter(item => item.cloid.toLowerCase() !== key), { ...attempt }].slice(-ATTEMPT_LIMIT);
    try { localStorage.setItem(attemptStorageKey(attempt.network, attempt.principal), JSON.stringify(this.attemptsValue.filter(item => item.network === attempt.network && normalizeAddress(item.principal) === normalizeAddress(attempt.principal)))); }
    catch { /* attempts stay available for this session */ }
    this.publish();
  }

  private publish() { const state = this.state; for (const listener of this.listeners) listener(state); }
}
