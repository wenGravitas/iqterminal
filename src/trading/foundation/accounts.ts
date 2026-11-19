import Decimal from 'decimal.js';
import { accountScope, type AccountRegistry, type CopyGroup, type ExecutionAccount } from './domain.ts';

export const ACCOUNT_REGISTRY_KEY = 'iq.trading.accounts.v1';
const address = /^0x[\da-f]{40}$/i;
export function validateAccount(account: ExecutionAccount) {
  if (!/^[\w-]{1,80}$/.test(account.id) || !account.name?.trim() || account.name.length > 80) throw Error('Use a name and a stable account identifier');
  if (!['testnet', 'mainnet'].includes(account.environment) || !['read-only', 'simulated'].includes(account.mode)) throw Error('Unknown account environment or permission');
  const i = account.identity;
  if (i.venue === 'hyperliquid') {
    if (!address.test(i.principal) || i.executionAddress !== null && !address.test(i.executionAddress)) throw Error('Hyperliquid requires valid principal and execution addresses');
    if (i.executionAddress?.toLowerCase() === i.principal.toLowerCase()) throw Error('Use no execution address for the master account');
  } else if (i.venue === 'lighter') {
    if (!address.test(i.owner) || !Number.isSafeInteger(i.accountIndex) || i.accountIndex < 0
      || !Number.isInteger(i.apiKeyIndex) || i.apiKeyIndex < 2 || i.apiKeyIndex > 254) throw Error('Lighter requires an owner, account index and dedicated API-key index 2–254');
  } else throw Error('Unsupported execution venue');
  for (const value of Object.values(account.policy)) {
    if (typeof value !== 'string' || value.length > 40 || !new Decimal(value).isFinite() || !new Decimal(value).gt(0)) throw Error('Account limits must be positive decimal amounts');
  }
}
export function validateRegistry(value: AccountRegistry): AccountRegistry {
  if (value.version !== 1 || !Array.isArray(value.accounts) || !Array.isArray(value.groups)
    || value.accounts.length > 32 || value.groups.length > 32) throw Error('Invalid or oversized account registry');
  const ids = new Set<string>(), scopes = new Set<string>();
  for (const account of value.accounts) {
    validateAccount(account);
    const scope = `${account.mode}:${accountScope(account)}`;
    if (ids.has(account.id) || scopes.has(scope)) throw Error('An execution account cannot be registered twice under different names');
    ids.add(account.id); scopes.add(scope);
  }
  for (const group of value.groups) {
    if (!/^[\w-]{1,80}$/.test(group.id) || ids.has(group.id) || !group.name?.trim() || group.name.length > 80
      || !Array.isArray(group.accountIds) || !group.accountIds.length || group.accountIds.length > 32
      || new Set(group.accountIds).size !== group.accountIds.length || group.accountIds.some(id => !value.accounts.some(a => a.id === id))) throw Error('Groups contain distinct accounts only; nested groups and copy loops are unsupported');
    const members = value.accounts.filter(a => group.accountIds.includes(a.id));
    if (new Set(members.map(a => `${a.environment}:${a.mode}`)).size !== 1) throw Error('A group must use one environment and one simulation/read-only mode');
    ids.add(group.id);
  }
  if (value.selectedId !== null && !ids.has(value.selectedId)) throw Error('Selected account/group is unavailable');
  // Explicit allowlist prevents credentials accidentally entering persistence.
  return { version: 1, selectedId: value.selectedId, accounts: value.accounts.map(a => ({ id: a.id, name: a.name.trim(), environment: a.environment, mode: a.mode, identity: a.identity.venue === 'hyperliquid'
    ? { venue: 'hyperliquid', principal: a.identity.principal.toLowerCase(), executionAddress: a.identity.executionAddress?.toLowerCase() ?? null }
    : { venue: 'lighter', owner: a.identity.owner.toLowerCase(), accountIndex: a.identity.accountIndex, apiKeyIndex: a.identity.apiKeyIndex }, policy: { maxRiskCash: a.policy.maxRiskCash, maxGrossNotional: a.policy.maxGrossNotional, maxLeverage: a.policy.maxLeverage } })), groups: value.groups.map(g => ({ id: g.id, name: g.name.trim(), accountIds: [...g.accountIds] })) };
}
export function restoreRegistry(raw: string | null): AccountRegistry {
  if (raw && raw.length <= 50_000) try { return validateRegistry(JSON.parse(raw)); } catch { /* Invalid state never arms or infers an identity. */ }
  return { version: 1, accounts: [], groups: [], selectedId: null };
}
export function groupAccounts(registry: AccountRegistry, selectedId = registry.selectedId): ExecutionAccount[] {
  const group: CopyGroup | undefined = registry.groups.find(g => g.id === selectedId);
  return registry.accounts.filter(a => group ? group.accountIds.includes(a.id) : a.id === selectedId);
}
