import Decimal from 'decimal.js';
import type { Chart, ContextMenuEvent, CrosshairMoveEvent, IPrimitive, PrimitiveHost, PrimitiveHit, PrimitiveRenderContext } from 'openalgo-charts';
import { hyperliquidPriceQuantum, newClientOrderId, orderIntent, validatePrice, validateSize, type OrderIntent, type TradingOrder, type TradingSnapshot } from './model';
import type { TradingController, TradingControllerState } from './controller';
import { tradingLevels, type TradingLevel } from './levels';

const COLORS: Record<TradingLevel['kind'], string> = {
  mark: '#d8b45d', entry: '#70b5cd', liquidation: '#e0676c', takeProfit: '#59b986',
  stopLoss: '#df6d72', trigger: '#db9b55', order: '#92c5cc',
};

function roundedPrice(value: number, szDecimals: number): string {
  const input = new Decimal(value);
  const quantum = hyperliquidPriceQuantum(input, szDecimals);
  const snapped = input.div(quantum).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(quantum);
  return snapped.toFixed(Math.max(0, snapped.decimalPlaces()));
}

function formatPrice(price: string) {
  const number = Number(price);
  return Number.isFinite(number) ? number.toLocaleString('en-US', { maximumFractionDigits: 6 }) : price;
}

/** Exchange-specific position/order guides, painted through the chart's public primitive API. */
export class HyperliquidTradingPrimitive implements IPrimitive {
  private host?: PrimitiveHost;
  private levels: TradingLevel[] = [];
  private preview: { orderId: number; price: number } | null = null;
  private enabled = true;
  private stale = true;
  zOrder() { return 'top' as const; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.levels = []; this.preview = null; }
  setEnabled(enabled: boolean) { if (this.enabled !== enabled) { this.enabled = enabled; this.host?.requestUpdate(); } }
  setSnapshot(snapshot: TradingSnapshot) {
    this.stale = snapshot.feedState !== 'live' || Date.now() - snapshot.lastMessageAt > 5_000;
    this.levels = tradingLevels(snapshot);
    if (this.preview && !snapshot.orders.some(order => order.id === this.preview!.orderId)) this.preview = null;
    this.host?.requestUpdate();
  }
  setPreview(orderId: number, price: number) { this.preview = Number.isFinite(price) && price > 0 ? { orderId, price } : null; this.host?.requestUpdate(); }
  clearPreview() { this.preview = null; this.host?.requestUpdate(); }
  order(orderId: number) { return this.levels.find(level => level.orderId === orderId); }
  orderPrice(orderId: number) { return this.preview?.orderId === orderId ? this.preview.price : this.order(orderId)?.price; }

  hitBounds(rc: PrimitiveRenderContext) {
    if (!this.enabled || this.stale || !this.levels.some(level => level.editable)) return null;
    return { left: 0, right: rc.plotWidth, top: 0, bottom: rc.plotHeight };
  }

  hitTest(_x: number, y: number, rc: PrimitiveRenderContext): PrimitiveHit | null {
    if (!this.enabled || this.stale) return null;
    let hit: { level: TradingLevel; distance: number } | null = null;
    const scale = rc.readoutPriceScale ?? rc.priceScale;
    for (const level of this.levels) {
      if (!level.orderId || !level.editable) continue;
      const price = this.preview?.orderId === level.orderId ? this.preview.price : level.price;
      const lineY = scale.priceToY(price), distance = Math.abs(lineY - y);
      if (distance <= 7 && (!hit || distance < hit.distance)) hit = { level, distance };
    }
    return hit ? {
      externalId: `hyperliquid-order:${hit.level.orderId}`,
      hoverKey: String(hit.level.orderId), zOrder: 'top', distance: hit.distance,
      cursor: 'ns-resize', draggable: true, cancelOnEscape: true,
      priceScale: rc.readoutPriceScale ?? rc.priceScale,
    } : null;
  }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    if (!this.enabled || !this.levels.length) return;
    const scale = rc.readoutPriceScale ?? rc.priceScale, dpr = rc.dpr;
    const previewState = this.preview;
    const visible = this.levels.map(level => {
      const preview = previewState && level.orderId !== undefined && previewState.orderId === level.orderId ? previewState.price : level.price;
      return { level, price: preview, y: scale.priceToY(preview) };
    }).filter(item => Number.isFinite(item.y) && item.y >= -8 && item.y <= rc.plotHeight + 8);
    const priorities: Record<TradingLevel['kind'], number> = { liquidation: 0, stopLoss: 1, takeProfit: 2, mark: 3, entry: 4, trigger: 5, order: 6 };
    visible.sort((a, b) => priorities[a.level.kind] - priorities[b.level.kind]);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, rc.plotWidth * dpr, rc.plotHeight * dpr); ctx.clip();
    ctx.font = `${9 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const occupied: number[] = [];
    for (const { level, price, y } of visible) {
      const color = COLORS[level.kind];
      ctx.strokeStyle = color; ctx.globalAlpha = this.stale ? .3 : level.kind === 'order' ? .72 : .9;
      ctx.lineWidth = (this.preview?.orderId === level.orderId ? 1.5 : 1) * dpr;
      ctx.setLineDash(level.kind === 'entry' ? [3 * dpr, 3 * dpr] : level.kind === 'mark' || level.kind === 'order' || level.kind === 'trigger' ? [5 * dpr, 3 * dpr] : []);
      ctx.beginPath(); ctx.moveTo(0, y * dpr); ctx.lineTo(rc.plotWidth * dpr, y * dpr); ctx.stroke();
      if (occupied.some(previous => Math.abs(previous - y) < 13)) continue;
      occupied.push(y);
      const title = `${level.label} · ${formatPrice(this.preview?.orderId === level.orderId ? price.toString() : level.priceText)}`;
      const width = ctx.measureText(title).width + 8 * dpr, height = 15 * dpr;
      const x = Math.max(0, rc.plotWidth * dpr - width - 6 * dpr), top = Math.max(0, Math.min(rc.plotHeight * dpr - height, y * dpr - height / 2));
      ctx.globalAlpha = this.stale ? .45 : .92; ctx.fillStyle = '#111'; ctx.fillRect(x, top, width, height);
      ctx.fillStyle = color; ctx.globalAlpha = 1; ctx.fillText(title, x + 4 * dpr, top + height / 2);
    }
    ctx.restore();
  }
}

interface Draft {
  kind: 'new' | 'modify';
  price: string;
  size: string;
  side: 'buy' | 'sell';
  priceSnapped?: boolean;
  orderId?: number;
  originalPrice?: string;
}

/** Owns DOM controls and user actions; it calls public chart and trading APIs only. */
export class HyperliquidTradingChartOverlay {
  readonly primitive = new HyperliquidTradingPrimitive();
  private readonly abort = new AbortController();
  private readonly root = document.createElement('div');
  private readonly networkNotice = document.createElement('div');
  private readonly actions = document.createElement('div');
  private readonly draftCard = document.createElement('form');
  private readonly draftTitle = document.createElement('strong');
  private readonly draftPrice = document.createElement('input');
  private readonly draftSize = document.createElement('input');
  private readonly draftSide = document.createElement('select');
  private readonly draftStatus = document.createElement('span');
  private readonly draftSubmit = document.createElement('button');
  private readonly draftDiscard = document.createElement('button');
  private readonly confirmDialog = document.createElement('dialog');
  private readonly confirmSummary = document.createElement('p');
  private readonly mainnetGuard = document.createElement('input');
  private readonly mainnetGuardLabel = document.createElement('label');
  private readonly confirmButton = document.createElement('button');
  private readonly crosshairRelease: () => void;
  private readonly eventRelease: (() => void)[] = [];
  private releaseState?: () => void;
  private state: TradingControllerState;
  private draft: Draft | null = null;
  private requested = false;
  private primitiveAttached = false;
  private dead = false;

  constructor(private readonly chart: Chart, private readonly stage: HTMLElement, private readonly controller: TradingController) {
    this.state = controller.state;
    this.root.className = 'hl-chart-overlay';
    this.networkNotice.className = 'hl-chart-network-notice';
    this.networkNotice.setAttribute('role', 'status');
    this.networkNotice.textContent = 'Chart trade lines are unavailable on testnet because the displayed Hyperliquid candle feed uses mainnet prices.';
    this.networkNotice.hidden = true;
    this.actions.className = 'hl-chart-right-actions'; this.actions.hidden = true;
    for (const side of ['buy', 'sell'] as const) {
      const action = document.createElement('button'); action.type = 'button'; action.dataset.side = side;
      action.textContent = side === 'buy' ? 'Buy limit' : 'Sell limit';
      action.addEventListener('click', () => { if (this.crosshairPrice) this.openNewDraft(this.crosshairPrice, side); }, { signal: this.abort.signal });
      this.actions.append(action);
    }
    const sizeField = document.createElement('input'); sizeField.type = 'text'; sizeField.inputMode = 'decimal'; sizeField.placeholder = 'BTC size'; sizeField.setAttribute('aria-label', 'Quick order size'); sizeField.className = 'hl-chart-quick-size';
    this.actions.prepend(sizeField);
    this.quickSize = sizeField;
    this.draftCard.className = 'hl-chart-draft'; this.draftCard.hidden = true;
    this.draftTitle.textContent = 'Price draft';
    this.draftPrice.type = 'text'; this.draftPrice.inputMode = 'decimal'; this.draftPrice.setAttribute('aria-label', 'Draft order price');
    this.draftSize.type = 'text'; this.draftSize.inputMode = 'decimal'; this.draftSize.setAttribute('aria-label', 'Draft order size in BTC');
    this.draftSide.add(new Option('Buy', 'buy')); this.draftSide.add(new Option('Sell', 'sell'));
    this.draftStatus.className = 'hl-chart-draft-status'; this.draftStatus.setAttribute('role', 'status');
    this.draftSubmit.type = 'submit'; this.draftSubmit.textContent = 'Review & submit';
    this.draftDiscard.type = 'button'; this.draftDiscard.textContent = 'Discard';
    const draftFields = document.createElement('div'); draftFields.className = 'hl-chart-draft-fields';
    draftFields.append(this.draftSide, this.draftSize, this.draftPrice);
    const draftActions = document.createElement('div'); draftActions.className = 'hl-chart-draft-actions'; draftActions.append(this.draftDiscard, this.draftSubmit);
    this.draftCard.append(this.draftTitle, draftFields, this.draftStatus, draftActions);
    this.confirmDialog.className = 'hl-chart-confirm'; this.confirmDialog.setAttribute('aria-label', 'Confirm chart order action');
    const confirmTitle = document.createElement('strong'); confirmTitle.textContent = 'Confirm Hyperliquid action';
    this.mainnetGuard.type = 'text'; this.mainnetGuard.autocomplete = 'off'; this.mainnetGuard.maxLength = 8; this.mainnetGuard.placeholder = 'MAINNET';
    this.mainnetGuardLabel.append(document.createTextNode('Type MAINNET to confirm'), this.mainnetGuard); this.mainnetGuardLabel.className = 'hl-mainnet-guard';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Back'; cancel.dataset.confirm = 'cancel';
    this.confirmButton.type = 'button'; this.confirmButton.textContent = 'Confirm'; this.confirmButton.dataset.confirm = 'accept';
    const footer = document.createElement('footer'); footer.append(cancel, this.confirmButton);
    this.confirmDialog.append(confirmTitle, this.confirmSummary, this.mainnetGuardLabel, footer);
    this.root.append(this.networkNotice, this.actions, this.draftCard, this.confirmDialog); this.stage.append(this.root);
    this.actions.addEventListener('pointerdown', event => event.stopPropagation(), { signal: this.abort.signal });
    this.actions.addEventListener('contextmenu', event => event.stopPropagation(), { signal: this.abort.signal });
    this.confirmDialog.addEventListener('pointerdown', event => event.stopPropagation(), { signal: this.abort.signal });
    this.confirmDialog.addEventListener('pointerup', event => event.stopPropagation(), { signal: this.abort.signal });
    cancel.addEventListener('click', () => this.confirmDialog.close('cancel'), { signal: this.abort.signal });
    this.confirmButton.addEventListener('click', () => { if (this.confirmAllowed()) this.confirmDialog.close('accept'); }, { signal: this.abort.signal });
    this.quickSize.addEventListener('input', () => this.controller.activity(), { signal: this.abort.signal });
    this.draftCard.addEventListener('submit', event => { event.preventDefault(); void this.submitDraft(); }, { signal: this.abort.signal });
    this.draftCard.addEventListener('pointerdown', event => event.stopPropagation(), { signal: this.abort.signal });
    this.draftDiscard.addEventListener('click', () => this.discardDraft('Draft discarded'), { signal: this.abort.signal });
    this.draftPrice.addEventListener('input', () => { if (this.draft) this.draft.price = this.draftPrice.value; }, { signal: this.abort.signal });
    this.draftSize.addEventListener('input', () => { if (this.draft) this.draft.size = this.draftSize.value; }, { signal: this.abort.signal });
    this.draftSide.addEventListener('change', () => { if (this.draft) this.draft.side = this.draftSide.value as 'buy' | 'sell'; }, { signal: this.abort.signal });
    this.mainnetGuard.addEventListener('input', () => this.syncConfirm(), { signal: this.abort.signal });
    this.crosshairRelease = chart.subscribeCrosshairMove(event => this.crosshair(event));
    this.eventRelease.push(chart.on('drag:start', event => this.dragStart(event.id, event.price)));
    this.eventRelease.push(chart.on('drag', event => this.dragMove(event.id, event.price)));
    this.eventRelease.push(chart.on('drag:end', event => this.dragEnd(event.id, event.price)));
    this.eventRelease.push(chart.on('drag:cancel', () => this.cancelDrag()));
    this.eventRelease.push(chart.on('contextmenu', event => this.contextMenu(event)));
  }

  private quickSize!: HTMLInputElement;
  private crosshairPrice: string | null = null;

  enable() {
    if (this.dead || this.requested) return;
    this.requested = true;
    this.releaseState = this.controller.subscribe(state => {
      this.state = state;
      if (this.overlayAvailable()) this.primitive.setSnapshot(state.snapshot);
      this.syncNetworkGate();
    }, this.abort.signal);
    this.syncNetworkGate();
  }

  disable() {
    this.requested = false;
    this.releaseState?.(); this.releaseState = undefined; this.chart.removePrimitive(this.primitive);
    this.primitiveAttached = false; this.primitive.setEnabled(false); this.actions.hidden = true;
    this.networkNotice.hidden = true; this.discardDraft('');
  }

  private overlayAvailable() { return this.requested && this.state.config.network === 'mainnet'; }

  private syncNetworkGate() {
    const available = this.overlayAvailable();
    if (available) {
      this.networkNotice.hidden = true;
      this.primitive.setEnabled(true);
      if (!this.primitiveAttached) { this.chart.addPrimitive(this.primitive, { anchor: 'primary-pane' }); this.primitiveAttached = true; }
      this.primitive.setSnapshot(this.state.snapshot);
    } else {
      if (this.primitiveAttached) { this.chart.removePrimitive(this.primitive); this.primitiveAttached = false; }
      this.primitive.setEnabled(false); this.actions.hidden = true; this.crosshairPrice = null;
      this.networkNotice.hidden = !(this.requested && this.state.config.network === 'testnet');
      if (this.confirmDialog.open) this.confirmDialog.close('cancel');
      if (this.draft) this.discardDraft('Draft discarded because chart prices are mainnet-only');
    }
    this.syncActions();
  }

  private crosshair(event: CrosshairMoveEvent) {
    if (!this.overlayAvailable() || event.paneIndex !== this.chart.primaryPaneIndex() || event.price === null || !event.point || event.pressed || event.pointerType === 'touch') {
      this.actions.hidden = true; this.crosshairPrice = null; return;
    }
    this.crosshairPrice = String(event.price);
    this.actions.hidden = false;
    this.actions.style.top = `${Math.max(4, Math.min(this.stage.clientHeight - 48, event.point.y - 20))}px`;
    this.actions.dataset.network = this.state.config.network;
    this.actions.title = `${this.state.config.network.toUpperCase()} · draft a limit order at ${formatPrice(this.crosshairPrice)}`;
    this.syncActions();
  }

  private syncActions() {
    const canSign = this.overlayAvailable() && !this.state.executionDisabled && this.state.owner.owned && this.state.vault.unlocked && this.state.snapshot.agentAuthorized && !this.state.busy;
    for (const control of this.actions.querySelectorAll<HTMLButtonElement>('button')) control.disabled = !canSign || !this.crosshairPrice;
    const orderOperation = this.draft?.kind === 'modify'
      ? this.state.snapshot.orderOperations?.find(item => (item.orderId === this.draft!.orderId || item.resolvedOrderId === this.draft!.orderId
        || item.possibleOrderIds?.includes(this.draft!.orderId!)) && item.phase !== 'rejected')
      : undefined;
    this.draftSubmit.disabled = !canSign || !this.draft || !!orderOperation;
    if (orderOperation && this.draft) this.draftStatus.textContent = `Order #${this.draft.orderId} has a ${orderOperation.phase} ${orderOperation.kind} operation; wait for canonical exchange reconciliation`;
  }

  private contextMenu(event: ContextMenuEvent) {
    if (event.target.kind === 'drawing') return;
    if (!this.overlayAvailable() || event.paneIndex !== this.chart.primaryPaneIndex() || event.price === null) return;
    event.preventDefault(); this.openNewDraft(String(event.price));
  }

  private openNewDraft(price: string, side?: 'buy' | 'sell') {
    if (!this.overlayAvailable()) return;
    let snappedPrice = price, priceSnapped = false;
    const szDecimals = this.state.snapshot.szDecimals;
    if (szDecimals !== null) {
      try {
        snappedPrice = roundedPrice(Number(price), szDecimals);
        priceSnapped = Number(snappedPrice) !== Number(price);
      } catch { /* validation below will keep an invalid crosshair price from being submitted */ }
    }
    this.draft = { kind: 'new', price: snappedPrice, size: this.quickSize.value.trim(), side: side ?? 'buy', priceSnapped };
    this.syncDraft();
  }

  private openModifyDraft(order: TradingOrder, price: number) {
    const operation = this.state.snapshot.orderOperations?.find(item => (item.orderId === order.id || item.resolvedOrderId === order.id
      || item.possibleOrderIds?.includes(order.id)
      || Boolean(item.cloid && order.cloid && item.cloid.toLowerCase() === order.cloid.toLowerCase())) && item.phase !== 'rejected');
    if (operation) {
      this.draftStatus.textContent = `Order #${order.id} has a ${operation.phase} ${operation.kind} operation; wait for canonical exchange reconciliation`;
      return;
    }
    const size = order.originalSize;
    this.draft = { kind: 'modify', orderId: order.id, originalPrice: order.price, price: roundedPrice(price, this.state.snapshot.szDecimals ?? 0), size, side: order.side };
    this.primitive.setPreview(order.id, Number(this.draft.price)); this.syncDraft();
  }

  private syncDraft() {
    if (!this.draft) { this.draftCard.hidden = true; return; }
    this.draftCard.hidden = false; this.draftTitle.textContent = this.draft.kind === 'modify' ? `Modify order #${this.draft.orderId}` : 'New limit order draft';
    this.draftPrice.value = this.draft.price; this.draftSize.value = this.draft.size; this.draftSide.value = this.draft.side;
    this.draftSide.disabled = this.draft.kind === 'modify'; this.draftSize.disabled = this.draft.kind === 'modify';
    this.draftStatus.textContent = this.draft.kind === 'modify' ? `Preview ${formatPrice(this.draft.originalPrice ?? '')} → ${formatPrice(this.draft.price)} · snapped to BTC tick`
      : `${this.state.config.network.toUpperCase()} · ${this.draft.priceSnapped ? 'price snapped to BTC tick · ' : ''}price and size are drafts until submitted`;
    this.draftCard.style.top = '6px'; this.draftCard.style.right = '6px';
    this.syncActions();
  }

  private dragStart(id: string, price: number) {
    if (!this.overlayAvailable()) return;
    const match = /^hyperliquid-order:(\d+)$/.exec(id), orderId = Number(match?.[1]);
    const order = match && Number.isSafeInteger(orderId) ? this.state.snapshot.orders.find(item => item.id === orderId) : null;
    if (!order || this.state.snapshot.szDecimals === null) return;
    this.openModifyDraft(order, price);
  }

  private dragMove(id: string, price: number) {
    if (!this.draft || this.draft.kind !== 'modify' || id !== `hyperliquid-order:${this.draft.orderId}` || this.state.snapshot.szDecimals === null) return;
    try { this.draft.price = roundedPrice(price, this.state.snapshot.szDecimals); this.draftPrice.value = this.draft.price; this.draftStatus.textContent = `Preview ${formatPrice(this.draft.originalPrice ?? '')} → ${formatPrice(this.draft.price)} · snapped to BTC tick`; this.primitive.setPreview(this.draft.orderId!, Number(this.draft.price)); }
    catch { /* invalid out-of-range pointer price; keep the last valid preview */ }
  }

  private dragEnd(id: string, price: number) {
    this.dragMove(id, price);
    if (this.draft?.kind === 'modify' && id === `hyperliquid-order:${this.draft.orderId}`) {
      this.draftStatus.textContent = 'Price draft only · review and confirm before the exchange is changed';
      this.syncActions();
    }
  }

  private cancelDrag() { if (this.draft?.kind === 'modify') this.discardDraft('Drag canceled · authoritative order price restored'); }

  private async submitDraft() {
    const draft = this.draft; if (!draft) return;
    const identity = { network: this.state.config.network, principal: this.state.config.principal };
    const szDecimals = this.state.snapshot.szDecimals;
    if (szDecimals === null) { this.draftStatus.textContent = 'BTC precision metadata is not available'; return; }
    const price = draft.price.trim(), size = draft.size.trim();
    const priceError = validatePrice(price, szDecimals); if (priceError) { this.draftStatus.textContent = priceError; return; }
    const sizeError = validateSize(size, szDecimals); if (sizeError) { this.draftStatus.textContent = sizeError; return; }
    const summary = draft.kind === 'modify'
      ? `${identity.network.toUpperCase()} · account ${identity.principal || 'not connected'} · Hyperliquid BTC perpetual · modify ${draft.side.toUpperCase()} order #${draft.orderId} · ${size} BTC @ ${price}`
      : `${identity.network.toUpperCase()} · account ${identity.principal || 'not connected'} · Hyperliquid BTC perpetual · ${draft.side.toUpperCase()} limit ${size} BTC @ ${price} · GTC`;
    if (!await this.confirm(summary)) return;
    if (this.state.config.network !== identity.network || this.state.config.principal !== identity.principal) {
      this.discardDraft('Selected account changed while this review was open · no action was sent · draft discarded'); return;
    }
    this.draftSubmit.disabled = true; this.draftStatus.textContent = 'Submitting once; reconciling with Hyperliquid…';
    try {
      if (draft.kind === 'modify') {
        const result = await this.controller.modify(draft.orderId!, price, size) as { status?: string };
        if (result?.status === 'err') throw new Error('Hyperliquid rejected the order modification');
      } else {
        const intent: OrderIntent = orderIntent({ side: draft.side, size, price, reduceOnly: false, tif: 'Gtc' }, newClientOrderId());
        const result = await this.controller.submit(intent, { kind: 'limit' }) as { phase?: string; message?: string };
        if (result?.phase === 'rejected') throw new Error(result.message ?? 'Hyperliquid rejected the limit order');
      }
      this.discardDraft('Action submitted · waiting for authoritative account reconciliation');
      void this.controller.refresh().catch(() => {});
    } catch (error) {
      this.discardDraft(error instanceof Error ? `Exchange did not accept the draft · preview rolled back · ${error.message}` : 'Draft rejected · preview rolled back');
      void this.controller.refresh().catch(() => {});
    }
  }

  private async confirm(summary: string) {
    if (this.state.executionDisabled) { this.draftStatus.textContent = 'Real signing and exchange actions are disabled while diagnostic fixture mode is selected'; return false; }
    if (!this.state.vault.unlocked || !this.state.owner.owned || !this.state.snapshot.agentAuthorized) { this.draftStatus.textContent = 'Unlock an authorized agent in the signing-owner tab first'; return false; }
    this.confirmSummary.textContent = summary;
    const mainnet = this.state.config.network === 'mainnet'; this.mainnetGuardLabel.hidden = !mainnet; this.mainnetGuard.value = ''; this.syncConfirm();
    this.confirmDialog.showModal();
    return new Promise<boolean>(resolve => this.confirmDialog.addEventListener('close', () => resolve(this.confirmDialog.returnValue === 'accept'), { once: true }));
  }

  private confirmAllowed() { return this.overlayAvailable() && (this.state.config.network !== 'mainnet' || this.mainnetGuard.value.trim() === 'MAINNET'); }
  private syncConfirm() { this.confirmButton.disabled = !this.confirmAllowed(); }

  private discardDraft(message: string) {
    this.draft = null; this.primitive.clearPreview(); this.draftCard.hidden = true;
    if (message) this.draftStatus.textContent = message;
    this.syncActions();
  }

  dispose() {
    if (this.dead) return; this.dead = true; this.disable(); this.abort.abort(); this.crosshairRelease();
    for (const release of this.eventRelease) release();
    if (this.confirmDialog.open) this.confirmDialog.close('cancel');
    this.root.remove();
  }
}
