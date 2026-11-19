/** Explicit public-data probe. Does not load a signer or accept a private key. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PublicTradingAdapter, VENUE_ENDPOINTS, LIGHTER_TESTNET_CHAIN_ID, LIGHTER_SIGNER_COMMIT } from '../../src/trading/foundation/public-adapters.ts';

const records = await Promise.all(['hyperliquid', 'lighter'].flatMap(venue => ['testnet', 'mainnet'].map(async environment => {
  const account = { id: `public-${venue}-${environment}`, name: 'Public metadata probe (no customer account)', environment, mode: 'read-only',
    identity: venue === 'hyperliquid' ? { venue, principal: `0x${'0'.repeat(40)}`, executionAddress: null } : { venue, owner: `0x${'0'.repeat(40)}`, accountIndex: 1, apiKeyIndex: 2 }, policy: { maxRiskCash: '1', maxGrossNotional: '1', maxLeverage: '1' } };
  const adapter = new PublicTradingAdapter(account), markets = [];
  for (const base of ['BTC', 'ETH']) {
    const start = performance.now();
    try {
      const result = await adapter.readMarket(base);
      markets.push({ base, status: 'public-read-ok', elapsedMs: Math.round(performance.now() - start), spec: result.spec, quote: result.quote });
    } catch (error) { markets.push({ base, status: 'unavailable', elapsedMs: Math.round(performance.now() - start), error: String(error.message).slice(0, 240) }); }
  }
  adapter.dispose(); return { venue, environment, endpoint: VENUE_ENDPOINTS[venue][environment], markets };
})));
const result = { checkedAt: new Date().toISOString(), evidence: 'read-only public REST; no customer account authorization and no signed order submission',
  lighterSignerCommit: LIGHTER_SIGNER_COMMIT, lighterTestnetChainId: LIGHTER_TESTNET_CHAIN_ID, records };
const output = process.argv[process.argv.indexOf('--output') + 1];
if (process.argv.includes('--output')) { if (!output) throw Error('Missing evidence output path'); await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(result, null, 2)}\n`); }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
