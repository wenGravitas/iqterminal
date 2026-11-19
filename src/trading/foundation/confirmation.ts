import type { ExecutionAccount } from './domain.ts';

/** Public identities are included in every review; account names alone never establish routing. */
export function executionIdentityDescription(account: ExecutionAccount): string {
  const i = account.identity;
  return i.venue === 'hyperliquid'
    ? `${account.environment.toUpperCase()} · Principal ${i.principal} · ${i.executionAddress ? `Subaccount ${i.executionAddress}` : `Master execution ${i.principal}`}`
    : `${account.environment.toUpperCase()} · Owner ${i.owner} · Account index ${i.accountIndex} · API-key index ${i.apiKeyIndex}`;
}
