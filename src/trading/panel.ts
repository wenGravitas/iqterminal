import type { IContentRenderer, IDockviewPanelProps } from 'dockview-core';
import { closePositionSize, isFreshPrice, marketIocLimit, orderFilledSize, orderIntent, positiveDecimal, validateLeverage, validateOrderNotional, validatePrice, validateSize, type OrderAttempt, type TradingOrder, type TradingPosition, type TradingNetwork } from './model';
import { DEFAULT_INACTIVITY_MINUTES, MAX_INACTIVITY_MINUTES, MIN_INACTIVITY_MINUTES, type TradingController, type TradingControllerState } from './controller';

function button(label: string, title = label, className = '') {
  const value = document.createElement('button'); value.type = 'button'; value.textContent = label; value.title = title;
  if (className) value.className = className;
  return value;
}

function field(label: string, control: HTMLElement, className = '') {
  const node = document.createElement('label'); node.className = `hl-field${className ? ` ${className}` : ''}`;
  const caption = document.createElement('span'); caption.textContent = label; node.append(caption, control); return node;
}

function input(label: string, type: 'text' | 'password' = 'text') {
  const node = document.createElement('input'); node.type = type; node.autocomplete = 'off'; node.spellcheck = false;
  node.setAttribute('aria-label', label); return node;
}

function format(value: string | null, digits = 2) {
  if (value === null) return '—';
  const parsed = positiveDecimal(value);
  return parsed ? parsed.toNumber().toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
}

function option(select: HTMLSelectElement, label: string, value: string) { select.add(new Option(label, value)); }

interface OrderRow {
  root: HTMLElement;
  title: HTMLDivElement;
  detail: HTMLDivElement;
  operation: HTMLDivElement;
  price: HTMLInputElement;
  size: HTMLInputElement;
  modify: HTMLButtonElement;
  cancel: HTMLButtonElement;
}
interface ActionIdentity { network: TradingNetwork; principal: string }

/** Compact native DOM Hyperliquid BTC perpetual panel. */
export class TradingPanel implements IContentRenderer {
  readonly element = document.createElement('section');
  private readonly abort = new AbortController();
  private readonly status = document.createElement('div');
  private readonly accountValues = document.createElement('div');
  private readonly positions = document.createElement('div');
  private readonly orders = document.createElement('div');
  private readonly fills = document.createElement('div');
  private readonly attempts = document.createElement('div');
  private readonly agentStatus = document.createElement('p');
  private readonly vaultAddress = document.createElement('span');
  private readonly ownerStatus = document.createElement('span');
  private readonly persistentVaultActions = document.createElement('div');
  private readonly sessionVaultActions = document.createElement('div');
  private readonly principal = input('Hyperliquid principal address');
  private readonly inactivityMinutes = input('Agent inactivity timeout in minutes');
  private readonly network = document.createElement('select');
  private readonly passphrase = input('Agent vault passphrase', 'password');
  private readonly privateKey = input('Agent private key to import', 'password');
  private readonly kind = document.createElement('select');
  private readonly side = document.createElement('select');
  private readonly size = input('BTC order size');
  private readonly price = input('BTC order limit price');
  private readonly triggerPrice = input('BTC trigger price');
  private readonly slippage = input('Market slippage basis points');
  private readonly tif = document.createElement('select');
  private readonly reduceOnly = document.createElement('input');
  private readonly leverage = input('BTC leverage');
  private readonly leverageMode = document.createElement('select');
  private readonly message = document.createElement('p');
  private readonly confirmDialog = document.createElement('dialog');
  private readonly confirmTitle = document.createElement('h2');
  private readonly confirmText = document.createElement('p');
  private readonly confirmGuard = input('Type MAINNET to confirm a mainnet action');
  private readonly confirmLabel = document.createElement('label');
  private readonly confirmAccept = button('Confirm action');
  private readonly orderRows = new Map<number, OrderRow>();
  private state!: TradingControllerState;
  private params!: IDockviewPanelProps;
  private release?: () => void;
  private dead = false;
  private ordersKey = '\u0000';

  constructor(private readonly controller: TradingController) {
    this.element.className = 'hyperliquid-trading';
    const header = document.createElement('header'); header.className = 'hl-toolbar';
    const title = document.createElement('strong'); title.textContent = 'Hyperliquid · BTC Perpetual';
    const refresh = button('↻', 'Refresh public account snapshot', 'hl-icon-button'); refresh.setAttribute('aria-label', 'Refresh account');
    header.append(title, refresh);

    const identity = document.createElement('div'); identity.className = 'hl-identity';
    option(this.network, 'Testnet', 'testnet'); option(this.network, 'Mainnet', 'mainnet');
    this.principal.maxLength = 42; this.principal.placeholder = '0x principal / sub-account';
    this.principal.autocapitalize = 'off';
    const applyIdentity = button('Connect'); applyIdentity.dataset.action = 'configure';
    const disconnect = button('Disconnect'); disconnect.dataset.action = 'disconnect';
    identity.append(field('Network', this.network), field('Principal account', this.principal), applyIdentity, disconnect);

    this.status.className = 'hl-status'; this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.accountValues.className = 'hl-account-values';
    const account = this.section('ACCOUNT', this.accountValues);
    this.positions.className = 'hl-position-list';
    const positions = this.section('BTC POSITION', this.positions);
    const leverageForm = document.createElement('div'); leverageForm.className = 'hl-leverage-form';
    this.leverage.inputMode = 'numeric'; this.leverage.value = '5'; this.leverage.maxLength = 3;
    option(this.leverageMode, 'Cross', 'cross'); option(this.leverageMode, 'Isolated', 'isolated');
    const setLeverage = button('Set leverage'); setLeverage.dataset.action = 'leverage';
    leverageForm.append(field('Leverage', this.leverage), field('Margin mode', this.leverageMode), setLeverage);
    positions.append(leverageForm);

    this.kind.className = 'hl-order-kind'; option(this.kind, 'Limit · GTC', 'limit'); option(this.kind, 'Market · IOC', 'market');
    option(this.kind, 'Take profit', 'takeProfit'); option(this.kind, 'Stop loss', 'stopLoss');
    option(this.side, 'Buy / long', 'buy'); option(this.side, 'Sell / short', 'sell');
    option(this.tif, 'GTC', 'Gtc'); option(this.tif, 'IOC', 'Ioc');
    this.size.inputMode = 'decimal'; this.size.placeholder = 'BTC size';
    this.price.inputMode = 'decimal'; this.price.placeholder = 'Limit price';
    this.triggerPrice.inputMode = 'decimal'; this.triggerPrice.placeholder = 'Trigger price';
    this.slippage.inputMode = 'numeric'; this.slippage.value = '50'; this.slippage.maxLength = 3;
    this.reduceOnly.type = 'checkbox'; this.reduceOnly.checked = false;
    const reduceLabel = field('Reduce only', this.reduceOnly, 'hl-checkbox');
    const orderForm = document.createElement('form'); orderForm.className = 'hl-order-form';
    const orderHeading = document.createElement('strong'); orderHeading.textContent = 'NEW ORDER · BTC';
    const orderGrid = document.createElement('div'); orderGrid.className = 'hl-order-grid';
    orderGrid.append(field('Order', this.kind), field('Side', this.side), field('Size · BTC', this.size), field('Limit price · USD', this.price), field('Trigger price · USD', this.triggerPrice), field('IOC slippage · bps', this.slippage), field('Time in force', this.tif), reduceLabel);
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'hl-submit'; submit.textContent = 'Review order';
    const bracketNote = document.createElement('small'); bracketNote.className = 'hl-bracket-note'; bracketNote.textContent = 'Take-profit and stop-loss are separate reduce-only trigger orders. They are not atomic with an entry order.';
    const order = this.section('ORDER ENTRY', orderForm); orderForm.append(orderHeading, orderGrid, submit, bracketNote);

    const agent = document.createElement('div'); agent.className = 'hl-agent';
    const vaultHead = document.createElement('div'); vaultHead.className = 'hl-agent-heading';
    const vaultTitle = document.createElement('strong'); vaultTitle.textContent = 'LOCAL AGENT VAULT';
    this.vaultAddress.className = 'hl-agent-address'; this.ownerStatus.className = 'hl-owner-state';
    vaultHead.append(vaultTitle, this.ownerStatus);
    const vaultInfo = document.createElement('div'); vaultInfo.className = 'hl-vault-info'; vaultInfo.append(this.vaultAddress);
    const vaultFields = document.createElement('div'); vaultFields.className = 'hl-vault-fields';
    this.passphrase.placeholder = 'Vault passphrase · 12+ characters'; this.passphrase.maxLength = 1024;
    this.privateKey.placeholder = 'Import key · 0x…'; this.privateKey.maxLength = 66;
    this.inactivityMinutes.type = 'number'; this.inactivityMinutes.min = String(MIN_INACTIVITY_MINUTES); this.inactivityMinutes.max = String(MAX_INACTIVITY_MINUTES); this.inactivityMinutes.step = '1'; this.inactivityMinutes.inputMode = 'numeric';
    const vaultButtons = document.createElement('div'); vaultButtons.className = 'hl-vault-buttons';
    const generate = button('Generate agent'); generate.dataset.action = 'generate';
    const importAgent = button('Import agent'); importAgent.dataset.action = 'import';
    const unlock = button('Unlock'); unlock.dataset.action = 'unlock';
    const lock = button('Lock'); lock.dataset.action = 'lock';
    const remove = button('Remove encrypted key'); remove.dataset.action = 'remove';
    const forget = button('Forget this device'); forget.dataset.action = 'forget';
    this.persistentVaultActions.className = 'hl-vault-actions'; this.persistentVaultActions.append(generate, importAgent, unlock, lock, remove);
    const sessionGenerate = button('Generate session-only agent'); sessionGenerate.dataset.action = 'session-generate';
    const sessionImport = button('Import session-only agent'); sessionImport.dataset.action = 'session-import';
    const sessionLock = button('Lock session-only agent'); sessionLock.dataset.action = 'lock';
    this.sessionVaultActions.className = 'hl-vault-actions'; this.sessionVaultActions.hidden = true; this.sessionVaultActions.append(sessionGenerate, sessionImport, sessionLock);
    vaultFields.append(field('Passphrase', this.passphrase), field('Agent private key', this.privateKey), field('Lock after inactivity · minutes', this.inactivityMinutes));
    vaultButtons.append(this.persistentVaultActions, this.sessionVaultActions, forget);
    this.agentStatus.className = 'hl-agent-status'; this.agentStatus.setAttribute('role', 'status'); this.agentStatus.setAttribute('aria-live', 'polite');
    agent.append(vaultHead, vaultInfo, vaultFields, vaultButtons, this.agentStatus);

    const orderList = document.createElement('div'); orderList.className = 'hl-data-section';
    this.orders.className = 'hl-order-list';
    orderList.append(this.section('OPEN ORDERS', this.orders));
    this.attempts.className = 'hl-attempt-list'; orderList.append(this.section('RECENT ORDER STATUS', this.attempts));
    this.fills.className = 'hl-fill-list'; orderList.append(this.section('RECENT FILLS', this.fills));

    this.message.className = 'hl-message'; this.message.setAttribute('role', 'status'); this.message.setAttribute('aria-live', 'polite');
    this.confirmDialog.className = 'hl-confirm'; this.confirmDialog.setAttribute('aria-label', 'Confirm Hyperliquid action');
    this.confirmTitle.textContent = 'Confirm action'; this.confirmText.className = 'hl-confirm-copy';
    this.confirmGuard.type = 'text'; this.confirmGuard.autocomplete = 'off'; this.confirmGuard.maxLength = 8;
    this.confirmGuard.placeholder = 'MAINNET'; this.confirmLabel.className = 'hl-mainnet-guard';
    this.confirmLabel.append(document.createTextNode('Type MAINNET to approve this mainnet action'), this.confirmGuard);
    const confirmCancel = button('Back'); confirmCancel.dataset.confirm = 'cancel';
    this.confirmAccept.dataset.confirm = 'accept';
    const confirmActions = document.createElement('footer'); confirmActions.append(confirmCancel, this.confirmAccept);
    this.confirmDialog.append(this.confirmTitle, this.confirmText, this.confirmLabel, confirmActions);
    const body = document.createElement('div'); body.className = 'hl-scroll-body';
    body.append(identity, this.status, account, positions, order, agent, orderList, this.message);
    this.element.append(header, body, this.confirmDialog);

    const signal = this.abort.signal;
    refresh.addEventListener('click', () => void this.perform(() => this.controller.refresh(), 'Account refresh requested'), { signal });
    applyIdentity.addEventListener('click', () => void this.applyIdentity(), { signal });
    disconnect.addEventListener('click', () => void this.perform(() => this.controller.disconnect(), 'Disconnected · account, attempt history and encrypted agent remain on this device'), { signal });
    this.inactivityMinutes.addEventListener('change', () => void this.changeInactivityTimeout(), { signal });
    this.kind.addEventListener('change', () => this.syncEntryFields(), { signal });
    this.kind.addEventListener('change', () => this.controller.activity(), { signal });
    orderForm.addEventListener('submit', event => { event.preventDefault(); void this.reviewOrder(); }, { signal });
    setLeverage.addEventListener('click', () => void this.reviewLeverage(), { signal });
    vaultButtons.addEventListener('click', event => { const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')?.dataset.action; if (action) void this.vaultAction(action); }, { signal });
    this.orders.addEventListener('click', event => { const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-order-action]'); if (target) void this.orderAction(target); }, { signal });
    this.orders.addEventListener('input', () => this.controller.activity(), { signal });
    this.attempts.addEventListener('click', event => { const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-attempt]'); if (target) { const attempt = this.state.attempts.find(item => item.cloid === target.dataset.attempt); if (attempt) void this.perform(() => this.controller.reconcileAttempt(attempt), 'Order status checked'); } }, { signal });
    this.confirmDialog.addEventListener('click', event => { const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-confirm]')?.dataset.confirm; if (action === 'cancel') this.confirmDialog.close('cancel'); else if (action === 'accept' && this.confirmAllowed()) this.confirmDialog.close('accept'); }, { signal });
    this.confirmGuard.addEventListener('input', () => this.syncConfirm(), { signal });
    this.element.addEventListener('pointerdown', () => this.controller.activity(), { signal });
    this.element.addEventListener('keydown', () => this.controller.activity(), { signal });
    this.syncEntryFields();
  }

  init(params: IDockviewPanelProps) {
    this.params = params; params.api.setTitle('Trading · HL BTC');
    this.release = this.controller.subscribe(state => this.render(state), this.abort.signal);
  }

  private actionIdentity(): ActionIdentity {
    return { network: this.state.config.network, principal: this.state.config.principal };
  }

  private actionIdentityLabel(identity: ActionIdentity) {
    return `${identity.network.toUpperCase()} · account ${identity.principal || 'not connected'} · Hyperliquid BTC perpetual`;
  }

  private requireSameActionIdentity(identity: ActionIdentity) {
    if (this.state.config.network === identity.network && this.state.config.principal === identity.principal) return true;
    this.setMessage('Selected account changed while this review was open. No action was sent; review it again.');
    return false;
  }

  private section(title: string, body: HTMLElement) {
    const section = document.createElement('section'); section.className = 'hl-section';
    const heading = document.createElement('h2'); heading.textContent = title;
    section.append(heading, body); return section;
  }

  private syncEntryFields() {
    const kind = this.kind.value;
    this.price.disabled = kind === 'market'; this.price.required = kind !== 'market';
    this.triggerPrice.disabled = kind !== 'takeProfit' && kind !== 'stopLoss'; this.triggerPrice.required = !this.triggerPrice.disabled;
    this.slippage.disabled = kind !== 'market'; this.tif.disabled = kind === 'market';
    this.tif.value = kind === 'market' ? 'Ioc' : this.tif.value || 'Gtc';
  }

  private render(state: TradingControllerState) {
    if (this.dead) return;
    this.state = state;
    if (document.activeElement !== this.principal) this.principal.value = state.config.principal;
    this.network.value = state.config.network;
    this.status.dataset.state = state.snapshot.feedState;
    const freshness = state.snapshot.lastMessageAt ? ` · update ${Math.max(0, Math.floor((Date.now() - state.snapshot.lastMessageAt) / 1000))}s ago` : '';
    this.status.textContent = `${state.config.network.toUpperCase()} · ${state.snapshot.feedState.toUpperCase()}${freshness}${state.executionDisabled ? ' · FIXTURE MODE · SIGNING DISABLED' : ''}${state.snapshot.error ? ` · ${state.snapshot.error}` : ''}`;
    this.element.dataset.fixtureMode = String(state.executionDisabled);
    this.accountValues.replaceChildren(
      this.metric('Account value', state.snapshot.accountValue), this.metric('Margin used', state.snapshot.marginUsed),
      this.metric('Withdrawable', state.snapshot.withdrawable), this.metric('BTC notional', state.snapshot.totalNotional),
      this.metric('BTC mark', state.snapshot.markPrice), this.metric('BTC mid', state.snapshot.midPrice),
    );
    this.renderPositions(state);
    this.renderOrders(state.snapshot.orders, state);
    this.renderFills(state);
    this.renderAttempts(state.attempts);
    this.vaultAddress.textContent = state.vault.legacyNeedsBinding
      ? 'Unscoped legacy encrypted key · explicit account binding required'
      : state.vault.address ? `Agent ${state.vault.address}` : state.vault.exists ? 'Encrypted key exists · address unavailable' : 'No encrypted agent stored';
    this.ownerStatus.textContent = state.owner.owned ? 'SIGNING TAB' : state.owner.otherOwner ? 'SIGNING IN OTHER TAB' : state.owner.supported ? 'LOCKED' : 'WEB LOCKS REQUIRED';
    this.ownerStatus.dataset.state = state.owner.owned ? 'owned' : state.owner.otherOwner ? 'other' : 'locked';
    this.agentStatus.textContent = state.executionDisabled
      ? 'DIAGNOSTIC FIXTURE MODE · agent keys and real exchange actions are disabled'
      : state.vault.sessionOnly
      ? (state.snapshot.agentAuthorized ? 'SESSION-ONLY · agent key is in this tab only and will be discarded on lock, timeout or close' : 'SESSION-ONLY · agent key remains in this tab only; authorize it on Hyperliquid before signing')
      : state.vault.error ?? (state.vault.legacyNeedsBinding
      ? 'Legacy key has no saved network or principal. Review and confirm the exact account binding after passphrase and authorization checks.'
      : state.vault.unlocked
      ? (state.snapshot.agentAuthorized ? `Agent authorized by principal${state.snapshot.agentValidUntil ? ` until ${new Date(state.snapshot.agentValidUntil).toLocaleString()}` : ''}` : 'Agent unlocked · authorization missing or expired')
      : state.snapshot.agentAddress ? 'Agent locked · key remains encrypted at rest' : 'Create or import a dedicated agent key');
    if (document.activeElement !== this.inactivityMinutes) this.inactivityMinutes.value = String(state.config.inactivityMinutes ?? DEFAULT_INACTIVITY_MINUTES);
    if (document.activeElement !== this.leverage && state.snapshot.btcLeverage !== null && state.snapshot.btcLeverage !== undefined) this.leverage.value = String(state.snapshot.btcLeverage);
    this.leverage.max = state.snapshot.btcMaxLeverage ? String(state.snapshot.btcMaxLeverage) : '';
    const configured = Boolean(state.config.principal);
    const unlocked = state.vault.unlocked && state.owner.owned && state.snapshot.agentAuthorized;
    for (const control of this.element.querySelectorAll<HTMLButtonElement>('[data-action="leverage"],.hl-submit')) control.disabled = state.executionDisabled || !unlocked || state.busy > 0;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action="unlock"]')) button.disabled = state.executionDisabled || !configured || !state.vault.exists || state.owner.otherOwner || !state.owner.supported || state.busy > 0;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action="unlock"]')) button.textContent = state.vault.legacyNeedsBinding ? 'Review legacy binding' : 'Unlock';
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action="lock"]')) button.disabled = !state.vault.unlocked || !state.owner.owned || state.busy > 0;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action="generate"],[data-action="import"],[data-action="remove"]')) {
      button.disabled = (state.executionDisabled && button.dataset.action !== 'remove') || state.busy > 0
        || (state.vault.exists && !['remove'].includes(button.dataset.action ?? ''))
        || button.dataset.action === 'remove' && state.vault.legacyNeedsBinding;
    }
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action="session-generate"],[data-action="session-import"]')) button.disabled = state.executionDisabled || !state.config.connected || !state.vault.sessionOnlyAvailable || !state.owner.supported || state.owner.otherOwner || state.busy > 0;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action="forget"]')) button.disabled = state.busy > 0;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action="disconnect"]')) button.disabled = !state.config.connected || state.busy > 0;
    this.persistentVaultActions.hidden = state.vault.storageAvailable !== true;
    this.sessionVaultActions.hidden = !state.vault.sessionOnlyAvailable;
    if (state.busy > 0) this.element.dataset.busy = 'true'; else delete this.element.dataset.busy;
  }

  private metric(name: string, value: string | null) {
    const item = document.createElement('div'); item.className = 'hl-metric';
    const label = document.createElement('span'); label.textContent = name;
    const amount = document.createElement('strong'); amount.textContent = format(value, name.includes('BTC') ? 5 : 2);
    item.append(label, amount); return item;
  }

  private renderPositions(state: TradingControllerState) {
    if (!state.snapshot.positions.length) {
      const empty = document.createElement('p'); empty.className = 'hl-empty'; empty.textContent = state.snapshot.lastSnapshotAt ? 'No open BTC position' : 'Waiting for account snapshot';
      this.positions.replaceChildren(empty); return;
    }
    this.positions.replaceChildren(...state.snapshot.positions.map(position => {
      const row = document.createElement('div'); row.className = `hl-position hl-${position.side}`;
      const title = document.createElement('strong'); title.textContent = `${position.side.toUpperCase()} · ${format(position.size, 5)} BTC`;
      const pnl = document.createElement('span'); pnl.textContent = `uPnL ${format(position.unrealizedPnl)} USD`;
      const details = document.createElement('small'); details.textContent = `Entry ${format(position.entryPrice)} · Liq ${format(position.liquidationPrice)} · ${position.leverage ?? '—'}x`;
      const closeActions = document.createElement('div'); closeActions.className = 'hl-position-close-actions';
      for (const percent of [25, 50, 100] as const) {
        const close = button(`Close ${percent}%`, `Reduce-only protected IOC close for ${percent}% of the current BTC position`, 'hl-position-close-button');
        close.dataset.closePercent = String(percent);
        close.disabled = !!this.positionCloseReason(state, position, percent);
        close.title = this.positionCloseReason(state, position, percent) ?? close.title;
        close.addEventListener('click', () => void this.closePosition(position, percent), { signal: this.abort.signal });
        closeActions.append(close);
      }
      row.append(title, pnl, details, closeActions); return row;
    }));
  }

  private positionCloseReason(state: TradingControllerState, position: TradingPosition, percent: 25 | 50 | 100): string | null {
    if (state.executionDisabled) return 'Real signing and exchange actions are disabled while diagnostic fixture mode is selected';
    if (state.busy > 0) return 'Wait for the current trading action to finish';
    if (!state.vault.unlocked || !state.owner.owned || !state.snapshot.agentAuthorized) return 'Unlock an authorized agent in the signing-owner tab first';
    try { this.preparePositionClose(position, percent, state); return null; }
    catch (error) { return error instanceof Error ? error.message : 'Position close is unavailable'; }
  }

  private preparePositionClose(position: TradingPosition, percent: 25 | 50 | 100, state = this.state) {
    const snapshot = state.snapshot;
    if (snapshot.feedState !== 'live' || !isFreshPrice(snapshot)) throw new Error('A fresh live BTC midpoint is required for a protected close');
    if (!snapshot.lastSnapshotAt || Date.now() - snapshot.lastSnapshotAt > 30_000) throw new Error('Refresh the account before closing this position');
    if (snapshot.szDecimals === null) throw new Error('BTC size precision is not available yet');
    const current = snapshot.positions.find(item => item.coin === 'BTC' && item.side === position.side);
    if (!current || current.size !== position.size) throw new Error('The BTC position changed; refresh and review the close again');
    const size = closePositionSize(current.size, percent, snapshot.szDecimals);
    const side = current.side === 'long' ? 'sell' : 'buy';
    const slippageBps = Number(this.slippage.value);
    if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) throw new Error('Close slippage must be between 10 and 500 basis points');
    const limitPrice = marketIocLimit(snapshot.midPrice!, side, slippageBps, snapshot.szDecimals);
    const notionalError = validateOrderNotional(size, limitPrice); if (notionalError) throw new Error(notionalError);
    const intent = orderIntent({ side, size, price: snapshot.midPrice!, reduceOnly: true, tif: 'Ioc' });
    return { network: state.config.network, principal: state.config.principal, positionSize: current.size, positionSide: current.side, percent, size, side, midPrice: snapshot.midPrice!, limitPrice, slippageBps, szDecimals: snapshot.szDecimals, intent };
  }

  private async closePosition(position: TradingPosition, percent: 25 | 50 | 100) {
    const before = this.state;
    let plan: ReturnType<typeof this.preparePositionClose>;
    try { plan = this.preparePositionClose(position, percent, before); }
    catch (error) { this.setMessage(error instanceof Error ? error.message : 'Position close is unavailable'); return; }
    const summary = `${plan.network.toUpperCase()} · account ${plan.principal} · Hyperliquid BTC perpetual · close ${percent}% of ${plan.positionSide.toUpperCase()} ${plan.positionSize} BTC · submit reduce-only ${plan.side.toUpperCase()} ${plan.size} BTC protected IOC · midpoint ${plan.midPrice}, limit bound ${plan.limitPrice}, max slippage ${plan.slippageBps} bps. Existing TP/SL orders stay in place unless a fresh account snapshot confirms the position is flat and you separately approve their cancellation.`;
    if (!await this.confirm('Close BTC position', summary)) return;
    if (this.state.config.network !== plan.network || this.state.config.principal !== plan.principal) { this.setMessage('Selected account changed during confirmation; close was not submitted'); return; }
    let reviewed: ReturnType<typeof this.preparePositionClose>;
    try { reviewed = this.preparePositionClose(position, percent, this.state); }
    catch (error) { this.setMessage(error instanceof Error ? error.message : 'Position changed during confirmation; close was not submitted'); return; }
    if (reviewed.size !== plan.size || reviewed.limitPrice !== plan.limitPrice || reviewed.positionSize !== plan.positionSize || reviewed.positionSide !== plan.positionSide || reviewed.midPrice !== plan.midPrice || reviewed.szDecimals !== plan.szDecimals) {
      this.setMessage('Position or protected price changed during confirmation; review the close again'); return;
    }
    this.setMessage(`Submitting ${percent}% reduce-only IOC close once; waiting for an authoritative account snapshot…`);
    let attempt: OrderAttempt;
    try { attempt = await this.controller.submit(plan.intent, { kind: 'market', slippageBps: plan.slippageBps }) as OrderAttempt; }
    catch (error) { this.setMessage(error instanceof Error ? error.message : 'Close submission failed'); return; }
    if (attempt.phase === 'rejected') { this.setMessage(`Close rejected: ${attempt.message}`); return; }
    const baseline = this.state.snapshot.lastSnapshotAt;
    const refreshed = this.waitForSnapshotAfter(baseline, plan.network, plan.principal);
    try { await this.controller.refresh(); } catch { /* snapshot timeout below reports the unresolved state */ }
    const reconciled = await refreshed;
    if (!reconciled) { this.setMessage(`Close request is ${attempt.phase}; no fresh account snapshot arrived. Protective orders were left unchanged. Check the order status before retrying.`); return; }
    const remaining = reconciled.snapshot.positions.find(item => item.coin === 'BTC');
    if (remaining) {
      this.setMessage(`${percent}% close reconciled · ${remaining.side.toUpperCase()} ${remaining.size} BTC remains. Existing reduce-only TP/SL orders were left in place; review them individually.`);
      return;
    }
    const protective = reconciled.snapshot.orders.filter(order => order.coin === 'BTC' && order.reduceOnly && order.trigger && (order.kind === 'takeProfit' || order.kind === 'stopLoss'));
    if (!protective.length) { this.setMessage(`BTC position is flat in the refreshed account snapshot · close attempt ${attempt.phase.toUpperCase()}`); return; }
    await this.reviewProtectiveOrderCleanup(plan.network, plan.principal, protective);
  }

  private waitForSnapshotAfter(after: number, network: TradingNetwork, principal: string) {
    return new Promise<TradingControllerState | null>(resolve => {
      let settled = false;
      let release = () => {};
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = () => finish(null);
      const finish = (state: TradingControllerState | null) => {
        if (settled) return; settled = true; clearTimeout(timer); release(); this.abort.signal.removeEventListener('abort', onAbort); resolve(state);
      };
      if (this.abort.signal.aborted) { resolve(null); return; }
      timer = setTimeout(() => finish(null), 25_000);
      this.abort.signal.addEventListener('abort', onAbort, { once: true });
      release = this.controller.subscribe(state => {
        if (state.config.network === network && state.config.principal === principal && state.snapshot.lastSnapshotAt > after) finish(state);
      });
      if (settled) release();
    });
  }

  private async reviewProtectiveOrderCleanup(network: TradingNetwork, principal: string, orders: TradingOrder[]) {
    const ids = orders.map(order => order.id);
    const summary = `${network.toUpperCase()} · account ${principal} · Hyperliquid BTC perpetual · the authoritative BTC snapshot is flat. Cancel only these remaining reduce-only TP/SL orders: ${orders.map(order => `#${order.id} ${order.kind} ${order.side} ${order.size} BTC`).join('; ')}. No other orders will be canceled.`;
    if (!await this.confirm('Cancel remaining BTC protective orders', summary)) {
      this.setMessage(`BTC position is flat; ${ids.length} reduce-only TP/SL order(s) remain for individual review`); return;
    }
    if (this.state.config.network !== network || this.state.config.principal !== principal || this.state.snapshot.positions.some(item => item.coin === 'BTC')) {
      this.setMessage('Account or BTC position changed during cancellation confirmation; protective orders were not canceled'); return;
    }
    const current = this.state.snapshot.orders.filter(order => ids.includes(order.id) && order.coin === 'BTC' && order.reduceOnly && order.trigger && (order.kind === 'takeProfit' || order.kind === 'stopLoss'));
    if (current.length !== ids.length) { this.setMessage('Protective orders changed during confirmation; refresh and review them again'); return; }
    try {
      for (const order of current) await this.controller.cancel(order.id);
    } catch (error) { this.setMessage(error instanceof Error ? error.message : 'Protective-order cancellation outcome is uncertain'); return; }
    const baseline = this.state.snapshot.lastSnapshotAt;
    const refreshed = this.waitForSnapshotAfter(baseline, network, principal);
    try { await this.controller.refresh(); } catch { /* snapshot timeout below reports the unresolved state */ }
    const reconciled = await refreshed;
    this.setMessage(reconciled ? `BTC position is flat; cancellation of ${current.length} protective order(s) is reflected in the refreshed account snapshot` : `BTC position is flat; cancellation requests were sent for ${current.length} protective order(s), but no fresh snapshot arrived`);
  }

  private renderOrders(orders: TradingOrder[], state: TradingControllerState) {
    const key = orders.map(order => `${order.id}:${order.status}`).join('|');
    if (key !== this.ordersKey) {
      this.ordersKey = key;
      const active = new Set(orders.map(order => order.id));
      for (const [id, row] of this.orderRows) if (!active.has(id)) { row.root.remove(); this.orderRows.delete(id); }
      for (const order of orders) {
        let row = this.orderRows.get(order.id);
        if (!row) { row = this.createOrderRow(order); this.orderRows.set(order.id, row); }
        this.updateOrderRow(row, order, state);
      }
      const ordered = orders.map(order => this.orderRows.get(order.id)!.root);
      for (let i = 0; i < ordered.length; i++) if (this.orders.children.item(i) !== ordered[i]) this.orders.insertBefore(ordered[i]!, this.orders.children.item(i));
      while (this.orders.children.length > ordered.length) this.orders.lastElementChild?.remove();
      if (!orders.length) { const empty = document.createElement('p'); empty.className = 'hl-empty'; empty.textContent = 'No open BTC orders'; this.orders.replaceChildren(empty); }
    } else {
      for (const order of orders) { const row = this.orderRows.get(order.id); if (row) this.updateOrderRow(row, order, state); }
    }
  }

  private createOrderRow(order: TradingOrder): OrderRow {
    const root = document.createElement('article'); root.className = 'hl-order-row'; root.dataset.orderId = String(order.id);
    const title = document.createElement('div'); title.className = 'hl-order-title';
    const detail = document.createElement('div'); detail.className = 'hl-order-detail';
    const operation = document.createElement('div'); operation.className = 'hl-order-operation'; operation.setAttribute('role', 'status'); operation.hidden = true;
    const edit = document.createElement('div'); edit.className = 'hl-order-edit';
    const price = input(order.trigger ? `New trigger price for order ${order.id}` : `New price for order ${order.id}`); price.inputMode = 'decimal';
    const size = input(`New size for order ${order.id}`); size.inputMode = 'decimal';
    const modify = button('Modify'); modify.dataset.orderAction = 'modify';
    const cancel = button('Cancel'); cancel.dataset.orderAction = 'cancel';
    edit.append(price, size, modify, cancel); root.append(title, detail, operation, edit); return { root, title, detail, operation, price, size, modify, cancel };
  }

  private updateOrderRow(row: OrderRow, order: TradingOrder, state: TradingControllerState) {
    const filled = orderFilledSize(order), isPartial = Boolean(positiveDecimal(filled));
    row.title.textContent = `${order.kind === 'takeProfit' ? 'TAKE PROFIT' : order.kind === 'stopLoss' ? 'STOP LOSS' : order.side.toUpperCase()} ${format(order.size, 5)} BTC remaining${order.reduceOnly ? ' · reduce only' : ''} @ ${format(order.trigger && order.triggerPrice ? order.triggerPrice : order.price)}`;
    row.detail.textContent = `#${order.id} · ${isPartial ? `PARTIAL · ${format(filled, 5)} filled of ${format(order.originalSize, 5)} BTC · ` : ''}${order.status}${order.trigger ? ` · trigger ${format(order.triggerPrice)}` : ''}${order.cloid ? ` · ${order.cloid.slice(0, 10)}…` : ''}`;
    if (document.activeElement !== row.price) row.price.value = order.trigger && order.triggerPrice ? order.triggerPrice : order.price;
    if (document.activeElement !== row.size) row.size.value = order.originalSize;
    const operation = (state.snapshot.orderOperations ?? []).find(item => item.orderId === order.id
      || item.resolvedOrderId === order.id || item.possibleOrderIds?.includes(order.id)
      || Boolean(item.cloid && order.cloid && item.cloid.toLowerCase() === order.cloid.toLowerCase()));
    row.operation.hidden = !operation;
    row.operation.textContent = operation ? `${operation.phase.toUpperCase()} · ${operation.message}` : '';
    row.root.dataset.operation = operation?.phase ?? '';
    const locked = state.executionDisabled || !state.vault.unlocked || !state.owner.owned || !state.snapshot.agentAuthorized;
    const actionReason = state.executionDisabled ? 'Real exchange actions are disabled in diagnostic fixture mode'
      : locked ? 'Unlock an authorized agent in the signing-owner tab first'
        : state.busy > 0 ? 'Wait for the current trading action to finish' : null;
    const operationBlocks = operation && operation.phase !== 'rejected';
    const pendingReason = operationBlocks ? `${operation!.kind === 'cancel' ? 'Cancel' : 'Modify'} is ${operation!.phase}; ${operation!.phase === 'unknown' ? 'refresh and reconcile before retrying' : 'wait for canonical exchange reconciliation'}` : null;
    for (const control of [row.price, row.size, row.modify, row.cancel]) {
      control.disabled = Boolean(actionReason || pendingReason);
      control.title = pendingReason ?? actionReason ?? control.getAttribute('aria-label') ?? control.textContent ?? '';
    }
  }

  private renderFills(state: TradingControllerState) {
    this.fills.replaceChildren(...(state.snapshot.fills.length ? state.snapshot.fills.map(fill => {
      const row = document.createElement('div'); row.className = `hl-fill hl-${fill.side}`;
      const side = document.createElement('strong'); side.textContent = fill.side.toUpperCase();
      const detail = document.createElement('span'); detail.textContent = `${format(fill.size, 5)} BTC @ ${format(fill.price)} · fee ${format(fill.fee, 5)}`;
      const time = document.createElement('time'); time.dateTime = new Date(fill.time).toISOString(); time.textContent = new Date(fill.time).toLocaleTimeString();
      row.append(side, detail, time); return row;
    }) : [this.empty('No recent BTC fills')]));
  }

  private renderAttempts(attempts: OrderAttempt[]) {
    const recent = [...attempts].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
    this.attempts.replaceChildren(...(recent.length ? recent.map(attempt => {
      const row = document.createElement('div'); row.className = `hl-attempt hl-${attempt.phase}`;
      const quantities = positiveDecimal(attempt.filledSize ?? '')
        ? ` · ${format(attempt.filledSize ?? null, 5)} filled · ${format(attempt.remainingSize ?? null, 5)} remaining`
        : '';
      const detail = document.createElement('span'); detail.textContent = `${attempt.intent.side.toUpperCase()} ${format(attempt.intent.size, 5)} · ${attempt.phase.toUpperCase()}${quantities} · ${attempt.message}`;
      row.append(detail);
      if (['unknown', 'submitting', 'resting', 'partiallyFilled', 'triggering'].includes(attempt.phase)) { const check = button('Check'); check.dataset.attempt = attempt.cloid; row.append(check); }
      return row;
    }) : [this.empty('No local order attempts')]));
  }

  private empty(text: string) { const node = document.createElement('p'); node.className = 'hl-empty'; node.textContent = text; return node; }

  private async applyIdentity() {
    const principal = this.principal.value.trim();
    if (principal && !/^0x[0-9a-fA-F]{40}$/.test(principal)) { this.principal.setCustomValidity('Enter a 20-byte EVM principal address'); this.principal.reportValidity(); return; }
    this.principal.setCustomValidity('');
    await this.perform(() => this.controller.setConfig(this.network.value as 'testnet' | 'mainnet', principal), 'Connected to public account data');
  }

  private async reviewOrder() {
    const identity = this.actionIdentity();
    const snapshot = this.state.snapshot, kind = this.kind.value as 'limit' | 'market' | 'takeProfit' | 'stopLoss';
    const size = this.size.value.trim(), price = this.price.value.trim(), triggerPrice = this.triggerPrice.value.trim();
    if (snapshot.szDecimals === null) { this.setMessage('BTC precision metadata is not available yet'); return; }
    const sizeError = validateSize(size, snapshot.szDecimals); if (sizeError) { this.size.setCustomValidity(sizeError); this.size.reportValidity(); return; }
    this.size.setCustomValidity('');
    if (kind !== 'market') { const priceError = validatePrice(price, snapshot.szDecimals); if (priceError) { this.price.setCustomValidity(priceError); this.price.reportValidity(); return; } this.price.setCustomValidity(''); }
    if ((kind === 'takeProfit' || kind === 'stopLoss')) { const triggerError = validatePrice(triggerPrice, snapshot.szDecimals); if (triggerError) { this.triggerPrice.setCustomValidity(triggerError); this.triggerPrice.reportValidity(); return; } this.triggerPrice.setCustomValidity(''); }
    const slippageBps = Number(this.slippage.value);
    if (kind === 'market' && (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500)) { this.slippage.setCustomValidity('Use 10–500 basis points'); this.slippage.reportValidity(); return; }
    this.slippage.setCustomValidity('');
    const intent = orderIntent({ side: this.side.value as 'buy' | 'sell', size, price: kind === 'market' ? snapshot.midPrice ?? '0' : price, reduceOnly: this.reduceOnly.checked || kind === 'takeProfit' || kind === 'stopLoss', tif: kind === 'market' ? 'Ioc' : this.tif.value as 'Gtc' | 'Ioc' });
    const previewPrice = kind === 'market' && snapshot.midPrice ? `${snapshot.midPrice} mid · protected limit ±${slippageBps} bps` : (kind === 'takeProfit' || kind === 'stopLoss') ? `${price} limit · trigger ${triggerPrice}` : `${price} · ${intent.tif}`;
    const summary = `${this.actionIdentityLabel(identity)} · ${intent.side.toUpperCase()} ${size} BTC · ${previewPrice}${intent.reduceOnly ? ' · reduce only' : ''} · cloid ${intent.cloid}`;
    if (!await this.confirm('Place Hyperliquid BTC order', summary)) return;
    if (!this.requireSameActionIdentity(identity)) return;
    this.size.value = ''; this.message.textContent = 'Submitting once; uncertain outcomes are reconciled by client order ID and will not be resent.';
    await this.perform(() => this.controller.submit(intent, { kind, triggerPrice: kind === 'takeProfit' || kind === 'stopLoss' ? triggerPrice : undefined, slippageBps }), 'Order attempt recorded');
  }

  private async reviewLeverage() {
    const identity = this.actionIdentity();
    const leverage = Number(this.leverage.value), isCross = this.leverageMode.value === 'cross';
    const leverageError = validateLeverage(leverage, this.state.snapshot.btcMaxLeverage);
    if (leverageError) { this.leverage.setCustomValidity(leverageError); this.leverage.reportValidity(); return; }
    this.leverage.setCustomValidity('');
    if (!await this.confirm('Update BTC leverage', `${this.actionIdentityLabel(identity)} · ${leverage}x · ${isCross ? 'cross' : 'isolated'} margin`)) return;
    if (!this.requireSameActionIdentity(identity)) return;
    await this.perform(() => this.controller.setLeverage(leverage, isCross), 'Leverage update submitted');
  }

  private async orderAction(buttonNode: HTMLButtonElement) {
    const identity = this.actionIdentity();
    const root = buttonNode.closest<HTMLElement>('[data-order-id]'), id = Number(root?.dataset.orderId), order = this.state.snapshot.orders.find(item => item.id === id);
    if (!root || !order || !Number.isSafeInteger(id)) { this.setMessage('Order is no longer in the live open-order snapshot. Refresh first.'); return; }
    const action = buttonNode.dataset.orderAction;
    if (action === 'cancel') {
      if (!await this.confirm('Cancel BTC order', `${this.actionIdentityLabel(identity)} · ${order.side.toUpperCase()} ${order.size} BTC @ ${order.price} · order ${order.id}`)) return;
      if (!this.requireSameActionIdentity(identity)) return;
      await this.perform(() => this.controller.cancel(id), 'Cancel submitted; reconciling live order status'); return;
    }
    if (action === 'modify') {
      const price = root.querySelector<HTMLInputElement>('.hl-order-edit input')?.value.trim() ?? '';
      const size = root.querySelector<HTMLInputElement>('input[aria-label^="New size"]')?.value.trim() ?? '';
      if (this.state.snapshot.szDecimals === null) { this.setMessage('BTC precision metadata is not available'); return; }
      const priceError = validatePrice(price, this.state.snapshot.szDecimals); if (priceError) { this.setMessage(priceError); return; }
      const sizeError = validateSize(size, this.state.snapshot.szDecimals); if (sizeError) { this.setMessage(sizeError); return; }
      if (!await this.confirm(order.trigger ? 'Modify BTC trigger order' : 'Modify BTC order', `${this.actionIdentityLabel(identity)} · order ${id} · ${order.side.toUpperCase()} ${size} BTC · ${order.trigger ? 'trigger' : 'limit'} ${price}${order.reduceOnly ? ' · reduce only' : ''}`)) return;
      if (!this.requireSameActionIdentity(identity)) return;
      await this.perform(() => this.controller.modify(id, price, size), 'Modify submitted; reconciling live order status');
    }
  }

  private async vaultAction(action: string) {
    if (action === 'session-generate') {
      if (!await this.confirm('Generate a session-only agent', 'No key will be saved to this device. The agent exists only in this browser tab and is erased by Lock, the inactivity timeout, reload or close.', false)) return;
      await this.perform(() => this.controller.generateSessionAgent(), 'Session-only agent generated in this tab');
      return;
    }
    if (action === 'session-import') {
      const privateKey = this.privateKey.value;
      if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) { this.privateKey.setCustomValidity('Enter a 32-byte 0x-prefixed private key'); this.privateKey.reportValidity(); return; }
      this.privateKey.setCustomValidity('');
      if (!await this.confirm('Import a session-only agent', 'The key will not be encrypted or saved. It remains only in this browser tab and is erased by Lock, the inactivity timeout, reload or close.', false)) return;
      this.privateKey.value = '';
      await this.perform(() => this.controller.importSessionAgent(privateKey), 'Session-only agent imported into this tab');
      return;
    }
    if (action === 'generate' || action === 'import') {
      const passphrase = this.passphrase.value;
      try {
        if (passphrase.length < 12) { this.passphrase.setCustomValidity('Use at least 12 characters'); this.passphrase.reportValidity(); return; }
        this.passphrase.setCustomValidity('');
        if (action === 'import') {
          const privateKey = this.privateKey.value;
          if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) { this.privateKey.setCustomValidity('Enter a 32-byte 0x-prefixed private key'); this.privateKey.reportValidity(); return; }
          this.privateKey.setCustomValidity(''); this.privateKey.value = '';
          await this.perform(() => this.controller.importAgent(privateKey, passphrase), 'Agent key encrypted in this browser');
        } else await this.perform(() => this.controller.generateAgent(passphrase), 'Dedicated agent key generated and encrypted locally');
      } finally { this.passphrase.value = ''; }
      return;
    }
    if (action === 'unlock') {
      const passphrase = this.passphrase.value;
      try {
        const outcome = await this.controller.unlock(passphrase);
        if (outcome && typeof outcome === 'object' && (outcome as Record<string, unknown>).legacyBindingRequired === true) {
          const prompt = outcome as Record<string, unknown>;
          const token = String(prompt.token ?? '');
          const network = prompt.network === 'mainnet' || prompt.network === 'testnet' ? prompt.network : this.state.config.network;
          const principal = typeof prompt.principal === 'string' ? prompt.principal : this.state.config.principal;
          const address = typeof prompt.address === 'string' ? prompt.address : 'unknown agent';
          const accepted = await this.confirm('Bind unscoped legacy agent key',
            `Verified agent ${address} was encrypted without a network or principal. Bind it to ${network.toUpperCase()} principal ${principal}? This will encrypt a scoped p=3 record and remove the unscoped copy in one storage transaction. If the transaction fails, the legacy record remains unchanged.`, false);
          if (!accepted) {
            await this.controller.cancelLegacyBinding(token).catch(() => {});
            this.setMessage('Legacy key binding canceled · the unscoped encrypted record remains unchanged');
            return;
          }
          if (this.state.config.network !== network || this.state.config.principal.toLowerCase() !== principal.toLowerCase()) {
            await this.controller.cancelLegacyBinding(token).catch(() => {});
            this.setMessage('Selected account changed · no legacy key was bound');
            return;
          }
          await this.perform(() => this.controller.bindLegacyAgent(token), 'Legacy agent bound to the selected account and unlocked');
        } else this.setMessage('Agent unlocked for this tab');
      } catch (error) { this.setMessage(error instanceof Error ? error.message : 'Unable to unlock agent'); }
      finally { this.passphrase.value = ''; }
      return;
    }
    if (action === 'lock') { await this.perform(() => this.controller.lock(), 'Agent locked'); return; }
    if (action === 'remove') {
      if (!await this.confirm('Remove encrypted agent key', `${this.state.config.network.toUpperCase()} · remove this browser’s encrypted agent record. This does not revoke authorization on Hyperliquid.`, false)) return;
      await this.perform(() => this.controller.removeAgent(), 'Encrypted agent removed');
      return;
    }
    if (action === 'forget') {
      if (!await this.confirm('Forget this device', 'Remove the encrypted agent key, remembered account/network, local order-attempt journal and session-only signer from this device. This does not cancel exchange orders, close positions or revoke Hyperliquid authorization.', false)) return;
      await this.perform(() => this.controller.forgetDevice(), 'Device trading data forgotten · exchange orders and positions were not changed');
    }
  }

  private async changeInactivityTimeout() {
    const minutes = Number(this.inactivityMinutes.value);
    if (!Number.isInteger(minutes) || minutes < MIN_INACTIVITY_MINUTES || minutes > MAX_INACTIVITY_MINUTES) {
      this.inactivityMinutes.setCustomValidity(`Use a whole number from ${MIN_INACTIVITY_MINUTES} to ${MAX_INACTIVITY_MINUTES} minutes`);
      this.inactivityMinutes.reportValidity(); return;
    }
    this.inactivityMinutes.setCustomValidity('');
    try { await this.controller.setInactivityMinutes(minutes); this.setMessage(`Agent inactivity lock set to ${minutes} minutes`); }
    catch (error) { this.setMessage(error instanceof Error ? error.message : 'Unable to update agent inactivity timeout'); }
  }

  private async confirm(title: string, summary: string, requiresSigning = true) {
    if (requiresSigning && this.state.executionDisabled) { this.setMessage('Real signing and exchange actions are disabled while diagnostic fixture mode is selected'); return false; }
    if (requiresSigning && (!this.state.vault.unlocked || !this.state.owner.owned || !this.state.snapshot.agentAuthorized)) { this.setMessage('Unlock an agent that is authorized by the selected principal before signing'); return false; }
    this.confirmTitle.textContent = title; this.confirmText.textContent = summary;
    const mainnet = requiresSigning && this.state.config.network === 'mainnet'; this.confirmLabel.hidden = !mainnet; this.confirmGuard.value = '';
    this.confirmGuard.required = mainnet; this.syncConfirm(); this.confirmDialog.showModal();
    return new Promise<boolean>(resolve => {
      const settled = () => resolve(this.confirmDialog.returnValue === 'accept');
      this.confirmDialog.addEventListener('close', settled, { once: true });
    });
  }

  private confirmAllowed() { return this.state.config.network !== 'mainnet' || this.confirmGuard.value.trim() === 'MAINNET'; }
  private syncConfirm() { this.confirmAccept.disabled = !this.confirmAllowed(); }
  private async perform<T>(operation: () => Promise<T>, success: string) {
    this.setMessage('Contacting Hyperliquid…');
    try { await operation(); this.setMessage(success); }
    catch (error) { this.setMessage(error instanceof Error ? error.message : 'Hyperliquid action failed'); }
  }
  private setMessage(value: string) { this.message.textContent = value; }

  dispose() {
    if (this.dead) return; this.dead = true; this.abort.abort(); this.release?.();
    if (this.confirmDialog.open) this.confirmDialog.close('cancel');
    this.element.remove();
  }
}
