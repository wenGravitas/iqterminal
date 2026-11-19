import type { BaseAsset, ExecutionAccount, ExecutionQuote, ExecutionSnapshot, InstrumentSpec } from './domain.ts';

export interface AccountRead { snapshot: ExecutionSnapshot; spec: InstrumentSpec; quote: ExecutionQuote }
export class FoundationAccountClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: AccountRead): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  read(account: ExecutionAccount, base: BaseAsset): Promise<AccountRead> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'trading-account-reads' });
      this.worker.onmessage = event => {
        const { id, error, value } = event.data, pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id); clearTimeout(pending.timer);
        if (error) pending.reject(Error(error)); else pending.resolve(value);
      };
      this.worker.onerror = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Account worker failed; refresh to reconnect')); } this.pending.clear(); this.worker?.terminate(); this.worker = null; };
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Account read timed out; no fixture fallback')); }, 20_000);
      this.pending.set(id, { resolve, reject, timer }); this.worker!.postMessage({ id, type: 'read', account, base });
    });
  }
  dispose() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Account panel disposed')); }
    this.pending.clear(); this.worker?.postMessage({ id: 0, type: 'dispose' }); this.worker?.terminate(); this.worker = null;
  }
}
