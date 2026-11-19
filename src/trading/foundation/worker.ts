import type { BaseAsset, ExecutionAccount } from './domain.ts';
import { PublicTradingAdapter } from './public-adapters.ts';

const adapters = new Map<string, { signature: string; adapter: PublicTradingAdapter }>();
const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async (event: MessageEvent<{ id: number; type: 'read' | 'dispose'; account?: ExecutionAccount; base?: BaseAsset }>) => {
  const request = event.data;
  if (request.type === 'dispose') { for (const a of adapters.values()) a.adapter.dispose(); adapters.clear(); worker.close(); return; }
  try {
    if (!request.account || !request.base) throw Error('Missing execution account or instrument');
    const signature = JSON.stringify(request.account);
    let entry = adapters.get(request.account.id);
    if (entry?.signature !== signature) { entry?.adapter.dispose(); adapters.delete(request.account.id); entry = undefined; }
    if (!entry) {
      if (adapters.size >= 32) throw Error('Account connection limit reached');
      entry = { signature, adapter: new PublicTradingAdapter(request.account) }; adapters.set(request.account.id, entry);
    }
    const [snapshot, market] = await Promise.all([entry.adapter.readAccount(), entry.adapter.readMarket(request.base)]);
    worker.postMessage({ id: request.id, value: { snapshot, ...market } });
  } catch (error) { worker.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Account read failed' }); }
};
