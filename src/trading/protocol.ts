import type { OrderAttempt, OrderIntent, TradingNetwork, TradingSnapshot } from './model';

export type TradingWorkerRequest =
  | { type: 'configure'; id: number; network: TradingNetwork; principal: string; inactivityMinutes: number; fixtureMode: boolean }
  | { type: 'set-inactivity-timeout'; id: number; minutes: number }
  | { type: 'refresh'; id: number }
  | { type: 'vault-info'; id: number }
  | { type: 'vault-generate'; id: number; passphrase: string }
  | { type: 'vault-import'; id: number; privateKey: string; passphrase: string }
  | { type: 'vault-session-generate'; id: number }
  | { type: 'vault-session-import'; id: number; privateKey: string }
  | { type: 'vault-unlock'; id: number; passphrase: string }
  | { type: 'vault-lock'; id: number }
  | { type: 'vault-remove'; id: number }
  | { type: 'submit-order'; id: number; intent: OrderIntent; kind?: 'limit' | 'market' | 'takeProfit' | 'stopLoss'; triggerPrice?: string; slippageBps?: number; grouping?: 'na' | 'positionTpsl' }
  | { type: 'set-leverage'; id: number; leverage: number; isCross: boolean }
  | { type: 'modify-order'; id: number; orderId: number; price: string; size: string }
  | { type: 'cancel-order'; id: number; orderId: number }
  | { type: 'order-status'; id: number; cloid: string; attempt?: OrderAttempt }
  | { type: 'activity' }
  | { type: 'dispose' };

export type TradingWorkerEvent =
  | { type: 'result'; id: number; value?: unknown; error?: string }
  | { type: 'snapshot'; snapshot: TradingSnapshot }
  | { type: 'vault-state'; address: string | null; unlocked: boolean; exists: boolean; storageAvailable?: boolean | null; sessionOnlyAvailable?: boolean; sessionOnly?: boolean; error?: string }
  | { type: 'attempt'; attempt: OrderAttempt };

