import { addWidget, selectTheme } from './footer-actions';
import { expect, test, type Page } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

const PRINCIPAL = `0x${'11'.repeat(20)}`;
const PRIVATE_KEY = `0x${'0'.repeat(63)}1`;
const AGENT = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const PASSPHRASE = 'correct horse battery staple 2026';

async function installMockTradingWorker(page: Page) {
  await page.addInitScript(() => {
    const win = window as any;
    const NativeWorker = window.Worker;
    const agentKey = '__test_only_hl_agent_address';
    win.__tradingMock = { workers: 0, requests: [], submitted: [], modified: [], canceled: [], modifyError: '', orderPrice: '84000', positionSize: '0.02', extraOrders: [], instances: [], storageAvailable: true, sessionOnlyAvailable: false, legacyBinding: false };

    const snapshot = (network: 'mainnet' | 'testnet', principal: string, authorized = false, agentAddress: string | null = null) => {
      const orderPrice = String(win.__tradingMock.orderPrice);
      return {
        network, principal, feedState: principal ? 'live' : 'disconnected', lastMessageAt: principal ? Date.now() : 0, lastSnapshotAt: Date.now(),
        accountValue: '10000', marginUsed: '150', withdrawable: '9850', totalNotional: '1680',
        positions: Number(win.__tradingMock.positionSize) > 0 ? [{ coin: 'BTC', size: String(win.__tradingMock.positionSize), side: 'long', entryPrice: '83900', unrealizedPnl: '12.5', liquidationPrice: '80000', leverage: '5' }] : [],
        orders: [{ coin: 'BTC', id: 77, cloid: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', side: 'buy', price: orderPrice, size: '0.01', originalSize: '0.01', timestamp: Date.now(), status: 'open', reduceOnly: false, trigger: false, triggerPrice: null, triggerMarket: false, kind: 'limit' }, ...(win.__tradingMock.extraOrders ?? [])],
        fills: [], midPrice: orderPrice, midPriceUpdatedAt: Date.now(), markPrice: orderPrice, markPriceUpdatedAt: Date.now(), szDecimals: 5, btcAsset: 0,
        agentAddress, agentAuthorized: authorized, agentValidUntil: null, error: null,
      };
    };

    class MockTradingWorker extends EventTarget {
      private network: 'mainnet' | 'testnet' = 'testnet';
      private principal = '';
      private agentAddress: string | null = null;
      private authorized = false;
      private sessionOnly = false;
      private pendingLegacyToken: string | null = null;
      private orders: any[] = [];
      private dead = false;
      private lastSnapshotAt = 0;
      constructor() { super(); win.__tradingMock.workers += 1; win.__tradingMock.instances.push(this); }
      private emit(data: any) {
        if (this.dead) return;
        const scoped = data?.type === 'vault-state' ? { ...data, network: this.network, principal: this.principal } : data;
        this.dispatchEvent(new MessageEvent('message', { data: scoped }));
      }
      private reply(id: number, value?: unknown, error?: string) { this.emit({ type: 'result', id, ...(error ? { error } : { value }) }); }
      private publish() {
        const value = snapshot(this.network, this.principal, this.authorized, this.agentAddress);
        this.lastSnapshotAt = Math.max(Date.now(), this.lastSnapshotAt + 1);
        this.emit({ type: 'snapshot', snapshot: { ...value, lastSnapshotAt: this.lastSnapshotAt, orders: [...value.orders, ...this.orders] } });
      }
      setOrderPrice(price: string) { win.__tradingMock.orderPrice = price; this.publish(); }
      postMessage(message: any) {
        win.__tradingMock.requests.push(structuredClone(message));
        switch (message.type) {
          case 'configure':
            this.network = message.network; this.principal = message.principal; this.agentAddress = localStorage.getItem(agentKey); this.authorized = false; this.sessionOnly = false;
            this.publish(); this.reply(message.id, snapshot(this.network, this.principal, false, this.agentAddress)); return;
          case 'vault-info':
            this.agentAddress = localStorage.getItem(agentKey);
            const legacyInfo = { address: this.agentAddress, exists: !!this.agentAddress || win.__tradingMock.legacyBinding,
              unlocked: false, legacyNeedsBinding: win.__tradingMock.legacyBinding, storageAvailable: win.__tradingMock.storageAvailable,
              sessionOnlyAvailable: win.__tradingMock.sessionOnlyAvailable };
            this.emit({ type: 'vault-state', ...legacyInfo }); this.reply(message.id, legacyInfo); return;
          case 'vault-import':
          case 'vault-generate':
            this.agentAddress = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'; localStorage.setItem(agentKey, this.agentAddress);
            this.emit({ type: 'vault-state', address: this.agentAddress, exists: true, unlocked: false, storageAvailable: true, sessionOnlyAvailable: false }); this.reply(message.id, { address: this.agentAddress, exists: true }); return;
          case 'vault-session-import':
          case 'vault-session-generate':
            this.agentAddress = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'; this.sessionOnly = true; this.authorized = true;
            this.publish(); this.emit({ type: 'vault-state', address: this.agentAddress, exists: true, unlocked: true, storageAvailable: false, sessionOnlyAvailable: true, sessionOnly: true }); this.reply(message.id, { address: this.agentAddress, authorized: true, sessionOnly: true }); return;
          case 'vault-unlock':
            if (win.__tradingMock.legacyBinding) {
              this.pendingLegacyToken = 'legacy-confirmation-token';
              this.emit({ type: 'vault-state', address: null, exists: true, unlocked: false, legacyNeedsBinding: true, storageAvailable: true });
              this.reply(message.id, { legacyBindingRequired: true, token: this.pendingLegacyToken, network: this.network,
                principal: this.principal, address: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf' }); return;
            }
            this.authorized = true; this.publish(); this.emit({ type: 'vault-state', address: this.agentAddress, exists: true, unlocked: true, storageAvailable: true, sessionOnlyAvailable: false });
            this.reply(message.id, { address: this.agentAddress, authorized: true }); return;
          case 'vault-bind-legacy':
            if (!this.pendingLegacyToken || message.token !== this.pendingLegacyToken || message.network !== this.network || message.principal !== this.principal) {
              this.reply(message.id, undefined, 'Legacy binding token or account scope is invalid'); return;
            }
            this.pendingLegacyToken = null; win.__tradingMock.legacyBinding = false;
            this.agentAddress = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'; this.authorized = true;
            localStorage.setItem(agentKey, this.agentAddress); this.publish();
            this.emit({ type: 'vault-state', address: this.agentAddress, exists: true, unlocked: true, legacyNeedsBinding: false, storageAvailable: true });
            this.reply(message.id, { address: this.agentAddress, authorized: true, bound: true }); return;
          case 'vault-cancel-legacy-binding':
            if (!this.pendingLegacyToken || message.token !== this.pendingLegacyToken) { this.reply(message.id, undefined, 'Legacy binding token is invalid'); return; }
            this.pendingLegacyToken = null; this.emit({ type: 'vault-state', address: null, exists: true, unlocked: false, legacyNeedsBinding: true, storageAvailable: true });
            this.reply(message.id, true); return;
          case 'vault-lock':
            this.authorized = false; if (this.sessionOnly) this.agentAddress = null; this.sessionOnly = false; this.publish(); this.emit({ type: 'vault-state', address: this.agentAddress, exists: !!this.agentAddress, unlocked: false, storageAvailable: win.__tradingMock.storageAvailable, sessionOnlyAvailable: win.__tradingMock.sessionOnlyAvailable, sessionOnly: false, ...(win.__tradingMock.storageAvailable === false ? { error: 'Session-only agent was discarded when locked' } : {}) }); this.reply(message.id, true); return;
          case 'vault-remove':
          case 'vault-forget':
            localStorage.removeItem(agentKey); this.agentAddress = null; this.authorized = false; this.sessionOnly = false;
            this.emit({ type: 'vault-state', address: null, exists: false, unlocked: false, storageAvailable: win.__tradingMock.storageAvailable, sessionOnlyAvailable: win.__tradingMock.sessionOnlyAvailable }); this.reply(message.id, true); return;
          case 'submit-order': {
            win.__tradingMock.submitted.push(structuredClone(message));
            const now = Date.now(), orderId = 90 + win.__tradingMock.submitted.length, intent = message.intent;
            if (intent.reduceOnly && intent.tif === 'Ioc') win.__tradingMock.positionSize = String(Math.max(0, Number(win.__tradingMock.positionSize) - Number(intent.size)).toFixed(5));
            const attempt = { cloid: intent.cloid, network: this.network, principal: this.principal, intent, phase: 'resting', createdAt: now, updatedAt: now, exchangeId: orderId, message: 'Resting on mocked Hyperliquid' };
            this.orders.push({ coin: 'BTC', id: orderId, cloid: intent.cloid, side: intent.side, price: intent.price, size: intent.size, originalSize: intent.size, timestamp: now, status: 'open', reduceOnly: intent.reduceOnly, trigger: false, triggerPrice: null, triggerMarket: false, kind: 'limit' });
            this.emit({ type: 'attempt', attempt }); this.publish(); this.reply(message.id, attempt); return;
          }
          case 'modify-order':
            win.__tradingMock.modified.push(structuredClone(message));
            if (win.__tradingMock.modifyError) { this.reply(message.id, undefined, win.__tradingMock.modifyError); return; }
            win.__tradingMock.orderPrice = String(message.price); this.publish(); this.reply(message.id, { status: 'ok' }); return;
          case 'cancel-order':
            win.__tradingMock.canceled.push(structuredClone(message));
            win.__tradingMock.extraOrders = (win.__tradingMock.extraOrders ?? []).filter((order: any) => order.id !== message.orderId);
            this.orders = this.orders.filter(order => order.id !== message.orderId);
            this.publish(); this.reply(message.id, { status: 'ok' }); return;
          case 'order-status': this.reply(message.id, message.attempt ?? { phase: 'unknown' }); return;
          case 'refresh': this.publish(); this.reply(message.id, true); return;
          case 'set-inactivity-timeout': this.reply(message.id, message.minutes); return;
          case 'activity': return;
          case 'dispose': this.dead = true; return;
          default: this.reply(message.id, undefined, `Unsupported mock request: ${message.type}`);
        }
      }
      terminate() { this.dead = true; }
    }

    class MockMarketDataWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage(message: any) {
        if (message.type !== 'subscribe' && message.type !== 'retry') return;
        const series = message.series;
        if (!series || !['binance', 'hyperliquid'].includes(series.venue)) return;
        const intervalMs: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };
        const step = intervalMs[series.interval];
        if (!step) return;
        const end = Math.floor(Date.now() / step) * step;
        const candles = Array.from({ length: 500 }, (_, index) => {
          const t = end - step * (499 - index);
          const close = 84_000 + index * 0.2 + Math.sin(index / 13) * 80;
          const open = close - Math.cos(index / 7) * 6;
          return { t, o: open, h: Math.max(open, close) + 15, l: Math.min(open, close) - 15, c: close, v: 5 + index % 7, revision: 1, closed: t + step <= Date.now() };
        });
        const market = series.market ?? 'perpetual';
        const native = series.venue === 'hyperliquid' ? 'BTC' : 'BTCUSDT';
        const key = `${series.venue}:${market}:${native}:${series.interval}`;
        this.emit({ type: 'snapshot', key, ids: [message.id], candles });
        this.emit({ type: 'status', key, ids: [message.id], status: { state: 'live', message: 'Deterministic Playwright market feed', lastUpdate: Date.now() } });
      }
      terminate() {}
      private emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
    }

    (window as any).Worker = function(script: string | URL, options?: WorkerOptions) {
      return options?.name === 'hyperliquid-trading' ? new MockTradingWorker() : new MockMarketDataWorker();
    } as any;
    win.__tradingMock.setOrderPrice = (price: string) => { for (const worker of win.__tradingMock.instances) worker.setOrderPrice(price); };
  });
}

async function openTradingAndUnlock(page: Page, network: 'mainnet' | 'testnet') {
  await installMockTradingWorker(page);
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.appState === 'ready');
  await page.waitForFunction(() => (window as any).__terminal?.stats().panels.length > 0);
  expect(await page.evaluate(() => (window as any).__tradingMock.workers)).toBe(0);
  await addWidget(page, 'Hyperliquid Trading');
  await expect(page.getByText('Hyperliquid · BTC Perpetual', { exact: true })).toBeVisible();
  const settings = page.locator('dialog.hl-settings');
  await expect(settings).toBeVisible();
  expect(await page.evaluate(() => (window as any).__tradingMock.workers)).toBe(0);
  await page.getByLabel('Network').selectOption(network);
  await page.getByLabel('Hyperliquid principal address').fill(PRINCIPAL);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.hl-status')).toContainText(`${network.toUpperCase()} · LIVE`);
  expect(await page.evaluate(() => (window as any).__tradingMock.workers)).toBe(1);
  await page.getByLabel('Agent vault passphrase').fill(PASSPHRASE);
  await page.getByLabel('Agent private key to import').fill(PRIVATE_KEY);
  await page.getByRole('button', { name: 'Import agent', exact: true }).click();
  await expect(page.locator('.hl-agent-address')).toContainText(AGENT);
  await page.getByLabel('Agent vault passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.locator('.hl-agent-status')).toContainText('Agent authorized by principal');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(settings).toBeHidden();
}

async function openTradingSettings(page: Page) {
  const dialog = page.locator('dialog.hl-settings');
  if (!(await dialog.isVisible())) await page.locator('.hyperliquid-trading[data-view="trade"]').getByRole('button', { name: 'Trading settings', exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openTradingWidget(page: Page, label: string, view: 'positions' | 'open-orders' | 'order-history' | 'trade-history') {
  await page.locator('.hyperliquid-trading[data-view="trade"]').getByRole('button', { name: label, exact: true }).click();
  const widget = page.locator(`.hyperliquid-trading[data-view="${view}"]`);
  await expect(widget).toBeVisible();
  return widget;
}

test('first open guides unconfigured accounts to settings and keeps vault inputs gated there', async ({ page }) => {
  await installMockTradingWorker(page);
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.appState === 'ready');
  await addWidget(page, 'Hyperliquid Trading');
  const trade = page.locator('.hyperliquid-trading[data-view="trade"]');
  const settings = page.locator('dialog.hl-settings');
  await expect(trade.getByLabel('BTC order size')).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Trading settings', exact: true })).toBeVisible();
  await expect(settings.getByLabel('Network')).toBeVisible();
  await expect(settings.getByLabel('Agent private key to import')).toBeVisible();
  await expect(trade.locator('.hl-scroll-body').getByLabel('Network')).toHaveCount(0);
  await expect(trade.locator('.hl-scroll-body').getByLabel('Agent private key to import')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__tradingMock.workers)).toBe(0);

  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  const trigger = trade.getByRole('button', { name: 'Trading settings', exact: true });
  await trigger.click();
  const passphrase = settings.getByLabel('Agent vault passphrase');
  const privateKey = settings.getByLabel('Agent private key to import');
  await passphrase.fill(PASSPHRASE);
  await privateKey.fill(PRIVATE_KEY);
  await privateKey.press('Escape');
  await expect(settings).toBeHidden();
  await expect(passphrase).toHaveValue('');
  await expect(privateKey).toHaveValue('');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Trading settings');
});

test('activity widgets share the one trading controller, reuse stable panels and restore from layout', async ({ page }) => {
  test.setTimeout(60_000);
  await openTradingAndUnlock(page, 'testnet');
  const baselineListeners = await page.evaluate(() => (window as any).__terminal.trading.listeners.size);
  const positions = await openTradingWidget(page, 'Positions', 'positions');
  const orders = await openTradingWidget(page, 'Open orders', 'open-orders');
  const attempts = await openTradingWidget(page, 'Order history', 'order-history');
  const fills = await openTradingWidget(page, 'Trade history', 'trade-history');
  await expect(positions.locator('.hl-account-values')).toBeVisible();
  await expect(orders).toContainText('OPEN ORDERS');
  await expect(attempts).toContainText('LOCAL ORDER ATTEMPTS');
  await expect(fills).toContainText('RECENT FILLS');
  for (const widget of [positions, orders, attempts, fills]) await expect(widget.locator('.hl-status')).toContainText('TESTNET · LIVE');
  expect(await page.evaluate(() => (window as any).__tradingMock.workers)).toBe(1);
  expect(await page.evaluate(() => (window as any).__terminal.trading.listeners.size)).toBe(baselineListeners + 4);

  await openTradingWidget(page, 'Open orders', 'open-orders');
  expect(await page.locator('.hyperliquid-trading[data-view="open-orders"]').count()).toBe(1);
  expect(await page.evaluate(() => (window as any).__terminal.trading.listeners.size)).toBe(baselineListeners + 4);
  await page.waitForTimeout(350);
  const saved = await page.evaluate(() => JSON.parse(((window as any).__terminal?.workspaces ? JSON.stringify({version:8,layout:(window as any).__terminal.workspaces.active.layout}) : localStorage.getItem('basis.layout.v1')) ?? '{}'));
  expect(saved.version).toBe(8);
  for (const id of ['hyperliquid-positions', 'hyperliquid-open-orders', 'hyperliquid-order-history', 'hyperliquid-trade-history']) expect(saved.layout.panels[id]).toBeTruthy();

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.appState === 'ready');
  for (const view of ['trade', 'positions', 'open-orders', 'order-history', 'trade-history']) {
    const restored = page.locator(`.hyperliquid-trading[data-view="${view}"]`);
    await expect(restored).toBeVisible();
    await expect(restored.locator('.hl-status')).toContainText('TESTNET · LIVE');
  }
  await expect.poll(() => page.evaluate(() => (window as any).__tradingMock.workers)).toBe(1);
  await page.evaluate(passphrase => (window as any).__terminal.trading.unlock(passphrase), PASSPHRASE);
  const retained = await page.evaluate(() => {
    const t = (window as any).__terminal, id = t.workspaces.active.id;
    const before = { principal: t.trading.state.config.principal, address: t.trading.state.vault.address, unlocked: t.trading.state.vault.unlocked, owned: t.trading.state.owner.owned };
    t.workspaces.create('Account continuity', false);
    const during = { principal: t.trading.state.config.principal, address: t.trading.state.vault.address, unlocked: t.trading.state.vault.unlocked, owned: t.trading.state.owner.owned };
    const workers = (window as any).__tradingMock.workers; t.workspaces.switchTo(id);
    return { before, during, workers };
  });
  expect(retained.during).toEqual(retained.before); expect(retained.before.unlocked).toBe(true); expect(retained.workers).toBe(1);
  for (const view of ['trade', 'positions', 'open-orders', 'order-history', 'trade-history']) await expect(page.locator(`.hyperliquid-trading[data-view="${view}"] .hl-status`)).toContainText('TESTNET · LIVE');
  const beforeClose = await page.evaluate(() => (window as any).__terminal.trading.listeners.size);
  await page.evaluate(() => (window as any).__terminal.dock.getPanel('hyperliquid-trade-history').api.close());
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.trading.listeners.size)).toBe(beforeClose - 1);
});

test('explicit diagnostic fixture mode blocks the native trading worker and controller from signing or execution', async ({ page }) => {
  await page.goto('/?fixture=1');
  await page.waitForFunction(() => document.documentElement.dataset.appState === 'ready');
  expect(await page.evaluate(() => (window as any).__terminal.fixture)).toBe(true);
  await addWidget(page, 'Hyperliquid Trading');
  await expect(page.locator('.hl-status')).toContainText('FIXTURE MODE · SIGNING DISABLED');
  await expect(page.locator('.hl-agent-status')).toContainText('agent keys and real exchange actions are disabled');

  const outcome = await page.evaluate(async () => {
    const controller = (window as any).__terminal.trading;
    const controllerCalls: Array<[string, Promise<unknown>]> = [
      ['generate', controller.generateAgent('a secure test passphrase')],
      ['import', controller.importAgent(`0x${'0'.repeat(63)}1`, 'a secure test passphrase')],
      ['unlock', controller.unlock('a secure test passphrase')],
      ['session-import', controller.importSessionAgent(`0x${'0'.repeat(63)}1`)],
      ['submit', controller.submit({ side: 'buy', size: '0.001', price: '84000', reduceOnly: false, tif: 'Gtc', cloid: `0x${'ab'.repeat(16)}` })],
      ['modify', controller.modify(1, '84000', '0.001')], ['cancel', controller.cancel(1)], ['leverage', controller.setLeverage(5, true)],
    ];
    const controllerResults = await Promise.all(controllerCalls.map(async ([name, request]) => {
      try { await request; return { name, error: null }; }
      catch (error) { return { name, error: (error as Error).message }; }
    }));

    // This reaches the actual module worker without replacing Worker in the test page.
    const worker = controller.ensureWorker() as Worker;
    let id = 10_000;
    const workerRequest = (type: string, fields: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { worker.removeEventListener('message', listener); reject(new Error(`${type} timed out`)); }, 5_000);
      const listener = (event: MessageEvent) => {
        if (event.data?.type !== 'result' || event.data.id !== requestId) return;
        clearTimeout(timer); worker.removeEventListener('message', listener); resolve(event.data);
      };
      worker.addEventListener('message', listener);
      worker.postMessage({ type, id: requestId, ...fields });
    });
    const configured = await workerRequest('configure', { network: 'testnet', principal: '', inactivityMinutes: 15, fixtureMode: true });
    await workerRequest('vault-info');
    const workerRequests: Array<[string, Record<string, unknown>]> = [
      ['vault-generate', { passphrase: 'a secure test passphrase' }],
      ['vault-import', { privateKey: `0x${'0'.repeat(63)}1`, passphrase: 'a secure test passphrase' }],
      ['vault-session-generate', {}], ['vault-session-import', { privateKey: `0x${'0'.repeat(63)}1` }],
      ['vault-unlock', { passphrase: 'a secure test passphrase' }], ['submit-order', {}],
      ['modify-order', {}], ['cancel-order', {}], ['set-leverage', {}],
    ];
    const workerResults = [];
    for (const [type, fields] of workerRequests) workerResults.push({ type, ...(await workerRequest(type, fields)) });
    const modeFlip = await workerRequest('configure', { network: 'mainnet', principal: '', inactivityMinutes: 15, fixtureMode: false });
    return { controllerResults, configured, workerResults, modeFlip };
  });

  expect(outcome.controllerResults).toHaveLength(8);
  for (const result of outcome.controllerResults) expect(result.error).toContain('disabled while diagnostic fixture mode is selected');
  expect(outcome.configured.error).toBeUndefined();
  expect(outcome.workerResults).toHaveLength(9);
  for (const result of outcome.workerResults) expect(result.error).toContain('disabled while diagnostic fixture mode is selected');
  expect(outcome.modeFlip.error).toContain('fixture mode is immutable');
  await expect(page.getByRole('button', { name: 'Generate agent', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Import agent', exact: true })).toBeDisabled();
});

test('order type tabs and side radios support roving keyboard selection', async ({ page }) => {
  await openTradingAndUnlock(page, 'testnet');
  const trade = page.locator('.hyperliquid-trading[data-view="trade"]');
  const tabs = trade.getByRole('tablist', { name: 'Order type' });
  const market = tabs.getByRole('tab', { name: 'Market', exact: true });
  const limit = tabs.getByRole('tab', { name: 'Limit', exact: true });
  const pro = tabs.getByRole('tab', { name: 'Pro', exact: true });
  await expect(limit).toHaveAttribute('aria-selected', 'true');
  await expect(limit).toHaveAttribute('tabindex', '0');
  await expect(trade.getByLabel('Pro order type')).toBeHidden();

  await limit.focus(); await limit.press('ArrowRight');
  await expect(pro).toHaveAttribute('aria-selected', 'true');
  await expect(pro).toHaveAttribute('tabindex', '0');
  await expect(trade.getByLabel('Pro order type')).toBeVisible();
  await pro.press('ArrowRight');
  await expect(market).toHaveAttribute('aria-selected', 'true');
  await market.press('Home');
  await expect(market).toHaveAttribute('aria-selected', 'true');
  await market.press('End');
  await expect(pro).toHaveAttribute('aria-selected', 'true');
  await pro.press('ArrowLeft');
  await expect(limit).toHaveAttribute('aria-selected', 'true');
  await expect(trade.getByLabel('Pro order type')).toBeHidden();

  const sideGroup = trade.getByRole('radiogroup', { name: 'Order side' });
  const buy = sideGroup.getByRole('radio', { name: 'Buy / Long', exact: true });
  const sell = sideGroup.getByRole('radio', { name: 'Sell / Short', exact: true });
  await expect(buy).toHaveAttribute('aria-checked', 'true');
  await buy.focus(); await buy.press('ArrowRight');
  await expect(sell).toHaveAttribute('aria-checked', 'true');
  await sell.press('ArrowDown');
  await expect(buy).toHaveAttribute('aria-checked', 'true');
  await buy.press('End');
  await expect(sell).toHaveAttribute('aria-checked', 'true');
  await sell.press('Home');
  await expect(buy).toHaveAttribute('aria-checked', 'true');
});

test('manual order confirmation is guarded on mainnet and account/key metadata survive reload without secrets', async ({ page }) => {
  await openTradingAndUnlock(page, 'mainnet');
  await page.getByLabel('BTC order size').fill('0.001');
  await page.getByLabel('BTC order limit price').fill('84000');
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  const dialog = page.locator('dialog.hl-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`MAINNET · account ${PRINCIPAL} · Hyperliquid BTC perpetual · BUY 0.001 BTC · 84000 · Gtc`);
  const confirm = dialog.getByRole('button', { name: 'Confirm action', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type MAINNET to confirm a mainnet action').fill('MAINNET');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const history = await openTradingWidget(page, 'Order history', 'order-history');
  await expect(history.locator('.hl-attempt')).toContainText('RESTING');
  const submitted = await page.evaluate(() => (window as any).__tradingMock.submitted);
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ type: 'submit-order', intent: { side: 'buy', size: '0.001', price: '84000', tif: 'Gtc' } });
  const appStorage = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('basis.')).map(([key, value]) => `${key}\n${value}`).join('\n'));
  expect(appStorage).not.toContain(PRIVATE_KEY);
  expect(appStorage).not.toContain(PASSPHRASE);
  await page.waitForTimeout(350);
  const layout = await page.evaluate(() => ((window as any).__terminal?.workspaces ? JSON.stringify({version:8,layout:(window as any).__terminal.workspaces.active.layout}) : localStorage.getItem('basis.layout.v1')));
  expect(layout).toContain('hyperliquid-trading');
  expect(layout).not.toContain(PRIVATE_KEY);
  expect(layout).not.toContain(PASSPHRASE);
  await page.reload();
  await expect(page.locator('.hyperliquid-trading[data-view="trade"]')).toBeVisible();
  await expect(page.getByText('Hyperliquid · BTC Perpetual', { exact: true })).toBeVisible();
  await openTradingSettings(page);
  await expect(page.getByLabel('Hyperliquid principal address')).toHaveValue(PRINCIPAL);
  await expect(page.locator('.hl-agent-status')).toContainText('Agent locked · key remains encrypted at rest');
  await expect(page.locator('.hyperliquid-trading[data-view="trade"] .hl-status')).toContainText('MAINNET · LIVE');
  const restoredStorage = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('basis.')).map(([, value]) => value).join('\n'));
  expect(restoredStorage).not.toContain(PRIVATE_KEY);
  expect(restoredStorage).not.toContain(PASSPHRASE);
});

test('order review binds confirmation to the principal shown and refuses a changed account', async ({ page }) => {
  await openTradingAndUnlock(page, 'mainnet');
  await page.getByLabel('BTC order size').fill('0.001');
  await page.getByLabel('BTC order limit price').fill('84000');
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  const dialog = page.locator('dialog.hl-confirm');
  await expect(dialog).toContainText(`account ${PRINCIPAL} · Hyperliquid BTC perpetual`);

  await page.evaluate(async () => {
    await (window as any).__terminal.trading.setConfig('mainnet', `0x${'22'.repeat(20)}`);
  });
  await dialog.getByLabel('Type MAINNET to confirm a mainnet action').fill('MAINNET');
  await dialog.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(page.locator('.hl-message')).toContainText('Selected account changed while this review was open');
  expect(await page.evaluate(() => (window as any).__tradingMock.submitted)).toHaveLength(0);
});

test('legacy vault binding names the selected account and requires an explicit one-time confirmation', async ({ page }) => {
  await installMockTradingWorker(page);
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.appState === 'ready');
  await addWidget(page, 'Hyperliquid Trading');
  await page.evaluate(() => { (window as any).__tradingMock.legacyBinding = true; });
  await page.getByLabel('Network').selectOption('testnet');
  await page.getByLabel('Hyperliquid principal address').fill(PRINCIPAL);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.hl-status')).toContainText('TESTNET · LIVE');
  await expect(page.locator('.hl-agent-address')).toContainText('Unscoped legacy encrypted key');
  await expect(page.locator('.hl-agent-status')).toContainText('Review and confirm the exact account binding');

  const passphrase = page.getByLabel('Agent vault passphrase');
  const review = page.getByRole('button', { name: 'Review legacy binding', exact: true });
  await passphrase.fill(PASSPHRASE);
  await review.click();
  const dialog = page.locator('dialog.hl-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Bind unscoped legacy agent key');
  await expect(dialog.locator('.hl-confirm-copy')).toContainText(`TESTNET principal ${PRINCIPAL}`);
  await expect(dialog.locator('.hl-confirm-copy')).toContainText(AGENT);
  await expect(dialog.locator('.hl-mainnet-guard')).toBeHidden();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.hl-message')).toContainText('Legacy key binding canceled');
  const canceledState = await page.evaluate(() => (window as any).__terminal.trading.state);
  expect(canceledState.vault).toMatchObject({ exists: true, legacyNeedsBinding: true, unlocked: false });
  expect(canceledState.owner.owned).toBe(false);
  expect(await page.evaluate(() => (window as any).__tradingMock.requests.map((item: any) => item.type)))
    .not.toContain('vault-bind-legacy');

  await passphrase.fill(PASSPHRASE);
  await review.click();
  await dialog.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(page.locator('.hl-agent-status')).toContainText('Agent authorized by principal');
  const boundState = await page.evaluate(() => (window as any).__terminal.trading.state);
  expect(boundState.vault).toMatchObject({ exists: true, legacyNeedsBinding: false, unlocked: true, address: AGENT });
  expect(boundState.owner.owned).toBe(true);
  const requestTypes = await page.evaluate(() => (window as any).__tradingMock.requests.map((item: any) => item.type));
  expect(requestTypes.filter((type: string) => type === 'vault-cancel-legacy-binding')).toHaveLength(1);
  expect(requestTypes.filter((type: string) => type === 'vault-bind-legacy')).toHaveLength(1);
  expect(requestTypes).not.toContain('vault-import');
});

test('session-only mode does not persist the agent and Lock discards it', async ({ page }) => {
  await installMockTradingWorker(page);
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.appState === 'ready');
  await addWidget(page, 'Hyperliquid Trading');
  await page.evaluate(() => { (window as any).__tradingMock.storageAvailable = false; (window as any).__tradingMock.sessionOnlyAvailable = true; });
  await page.getByLabel('Network').selectOption('testnet');
  await page.getByLabel('Hyperliquid principal address').fill(PRINCIPAL);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.hl-status')).toContainText('TESTNET · LIVE');
  const generate = page.getByRole('button', { name: 'Generate session-only agent', exact: true });
  await expect(generate).toBeVisible();
  await generate.click();
  const dialog = page.locator('dialog.hl-confirm');
  await expect(dialog).toContainText('No key will be saved to this device');
  await dialog.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(page.locator('.hl-agent-status')).toContainText('SESSION-ONLY');
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('basis.')).map(([, value]) => value).join('\n'))).not.toContain(AGENT);
  expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('__test_only_hl_agent_address');

  await page.getByRole('button', { name: 'Lock session-only agent', exact: true }).click();
  await expect(page.locator('.hl-agent-status')).toContainText('discarded when locked');
  expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('__test_only_hl_agent_address');
});

test('inactivity timeout persists; Disconnect retains identity and Forget Device removes it', async ({ page }) => {
  await openTradingAndUnlock(page, 'testnet');
  await openTradingSettings(page);
  const timeout = page.getByLabel('Agent inactivity timeout in minutes');
  await timeout.fill('37');
  await timeout.press('Tab');
  await expect(page.locator('.hl-message')).toContainText('Agent inactivity lock set to 37 minutes');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('basis.hyperliquid.trading.v1') ?? '{}').inactivityMinutes)).toBe(37);

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('.hl-message')).toContainText('Disconnected');
  await expect(page.locator('.hl-status')).toContainText('TESTNET · DISCONNECTED');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('basis.hyperliquid.trading.v1') ?? '{}'))).toMatchObject({ principal: PRINCIPAL.toLowerCase(), connected: false, inactivityMinutes: 37 });
  expect(await page.evaluate(() => Object.keys(localStorage))).toContain('__test_only_hl_agent_address');

  await page.getByRole('button', { name: 'Forget this device', exact: true }).click();
  const dialog = page.locator('dialog.hl-confirm');
  await expect(dialog).toContainText('Remove the encrypted agent key, remembered account/network, local order-attempt journal');
  await dialog.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(page.locator('.hl-message')).toContainText('Device trading data forgotten');
  expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('__test_only_hl_agent_address');
  expect(await page.evaluate(() => localStorage.getItem('basis.hyperliquid.trading.v1'))).toBeNull();
  expect(await page.evaluate(() => (window as any).__tradingMock.submitted)).toHaveLength(0);
});

test('position close presets confirm exact reduce-only IOC size and preserve protection after a partial close', async ({ page }) => {
  await openTradingAndUnlock(page, 'mainnet');
  await page.evaluate(() => {
    (window as any).__tradingMock.extraOrders = [
      { coin: 'BTC', id: 72, cloid: null, side: 'sell', price: '105000', size: '0.02', originalSize: '0.02', timestamp: Date.now(), status: 'open', reduceOnly: true, trigger: true, triggerPrice: '104000', triggerMarket: false, kind: 'takeProfit' },
      { coin: 'BTC', id: 73, cloid: null, side: 'sell', price: '95000', size: '0.02', originalSize: '0.02', timestamp: Date.now(), status: 'open', reduceOnly: true, trigger: true, triggerPrice: '96000', triggerMarket: false, kind: 'stopLoss' },
    ];
    (window as any).__tradingMock.setOrderPrice((window as any).__tradingMock.orderPrice);
  });
  const positionsPanel = await openTradingWidget(page, 'Positions', 'positions');
  const positions = positionsPanel.locator('.hl-position');
  await expect(positions).toContainText('LONG · 0.02 BTC');
  const close25 = positions.getByRole('button', { name: 'Close 25%', exact: true });
  await expect(close25).toBeEnabled();
  await close25.click();
  const dialog = positionsPanel.locator('dialog.hl-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('MAINNET · account');
  await expect(dialog).toContainText('close 25% of LONG 0.02 BTC');
  await expect(dialog).toContainText('reduce-only SELL 0.005 BTC protected IOC');
  const confirm = dialog.getByRole('button', { name: 'Confirm action', exact: true });
  await expect(confirm).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__tradingMock.submitted.length)).toBe(0);
  await dialog.getByLabel('Type MAINNET to confirm a mainnet action').fill('MAINNET');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect.poll(() => page.evaluate(() => (window as any).__tradingMock.submitted.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__tradingMock.submitted[0])).toMatchObject({
    type: 'submit-order', kind: 'market', slippageBps: 50,
    intent: { side: 'sell', size: '0.005', reduceOnly: true, tif: 'Ioc' },
  });
  await expect(positions).toContainText('LONG · 0.015 BTC');
  expect(await page.evaluate(() => (window as any).__tradingMock.canceled)).toHaveLength(0);
  const openOrders = await openTradingWidget(page, 'Open orders', 'open-orders');
  await expect(openOrders.locator('.hl-order-row').filter({ hasText: 'TAKE PROFIT' })).toBeVisible();
  await expect(openOrders.locator('.hl-order-row').filter({ hasText: 'STOP LOSS' })).toBeVisible();
});

test('full position close offers a second confirmation for only the remaining protective orders after flat reconciliation', async ({ page }) => {
  await openTradingAndUnlock(page, 'mainnet');
  await page.evaluate(() => {
    (window as any).__tradingMock.extraOrders = [
      { coin: 'BTC', id: 72, cloid: null, side: 'sell', price: '105000', size: '0.02', originalSize: '0.02', timestamp: Date.now(), status: 'open', reduceOnly: true, trigger: true, triggerPrice: '104000', triggerMarket: false, kind: 'takeProfit' },
      { coin: 'BTC', id: 73, cloid: null, side: 'sell', price: '95000', size: '0.02', originalSize: '0.02', timestamp: Date.now(), status: 'open', reduceOnly: true, trigger: true, triggerPrice: '96000', triggerMarket: false, kind: 'stopLoss' },
    ];
    (window as any).__tradingMock.setOrderPrice((window as any).__tradingMock.orderPrice);
  });
  const positionsPanel = await openTradingWidget(page, 'Positions', 'positions');
  const positions = positionsPanel.locator('.hl-position');
  const closeAll = positions.getByRole('button', { name: 'Close 100%', exact: true });
  await expect(closeAll).toBeEnabled();
  await closeAll.click();
  const dialog = positionsPanel.locator('dialog.hl-confirm');
  await expect(dialog).toContainText('close 100% of LONG 0.02 BTC');
  await expect(dialog).toContainText('reduce-only SELL 0.02 BTC protected IOC');
  await dialog.getByLabel('Type MAINNET to confirm a mainnet action').fill('MAINNET');
  await dialog.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__tradingMock.submitted.length)).toBe(1);
  await expect(dialog).toContainText('the authoritative BTC snapshot is flat');
  await expect(dialog).toContainText('#72 takeProfit');
  await expect(dialog).toContainText('#73 stopLoss');
  expect(await page.evaluate(() => (window as any).__tradingMock.canceled.length)).toBe(0);
  const cancelDialog = positionsPanel.locator('dialog.hl-confirm');
  await cancelDialog.getByLabel('Type MAINNET to confirm a mainnet action').fill('MAINNET');
  await cancelDialog.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__tradingMock.canceled.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__tradingMock.canceled.map((request: any) => request.orderId))).toEqual([72, 73]);
  await expect(positionsPanel.locator('.hl-message')).toContainText('cancellation of 2 protective order(s) is reflected');
});

test('chart context drafts and draggable trade lines stay outside the drawing inventory until confirmed', async ({ page }) => {
  await openTradingAndUnlock(page, 'mainnet');
  await page.evaluate(() => (window as any).__terminal.addChart({ venue: 'hyperliquid', market: 'perpetual', interval: '1m' }));
  const chartPanel = page.locator('.candle-panel').filter({ hasText: 'Hyperliquid · BTC Perp' }).last();
  await expect(chartPanel).toBeVisible();
  await expect.poll(() => chartPanel.evaluate(panel => {
    const id = (panel as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id)?.diagnostics()?.bars ?? 0;
  })).toBeGreaterThan(0);
  const orderPrice = await chartPanel.evaluate(panel => String(Math.round((window as any).__terminal.panels.get((panel as HTMLElement).dataset.panelId!).diagnostics().last.c)));
  await page.evaluate(price => (window as any).__tradingMock.setOrderPrice(price), orderPrice);
  const panelId = await chartPanel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Hyperliquid candle panel has no id');
  const drawingsBefore = await page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().length, panelId);
  const lines = chartPanel.getByRole('button', { name: 'Trade lines', exact: true });
  await lines.click();
  await expect(chartPanel.getByRole('button', { name: 'Trade lines · on', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const drawingsAfter = await page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().length, panelId);
  expect(drawingsAfter).toBe(drawingsBefore);

  // A drawing owns its right-click even while the trade-line overlay is enabled.
  const drawingPoint = await chartPanel.evaluate(panel => {
    const engine = (window as any).__terminal.panels.get((panel as HTMLElement).dataset.panelId!).engine;
    const chart = engine.chart, plot = chart.plotRect(0);
    const price = chart.panes()[0].readoutScale().yToPrice(plot.height * .25);
    engine.drawings.add({ tool: 'horizontal-line', paneIndex: 0,
      points: [{ time: chart.dataLayer.indexToTime(chart.dataLayer.length - 1), price }] });
    return { x: plot.left + plot.width * .1, y: chart.priceToCoordinate(price, 0) };
  });
  await chartPanel.locator('.chart-stage').click({ button: 'right', position: drawingPoint });
  const drawingMenu = page.getByRole('menu', { name: 'Drawing actions', exact: true });
  await expect(drawingMenu).toBeVisible();
  await expect(chartPanel.locator('.hl-chart-draft')).toBeHidden();
  await drawingMenu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  expect(await page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().length, panelId)).toBe(drawingsBefore);

  const coordinates = await chartPanel.evaluate((panel, price) => {
    const id = (panel as HTMLElement).dataset.panelId!;
    const chart = (window as any).__terminal.panels.get(id).engine.chart;
    const stage = panel.querySelector<HTMLElement>('.chart-stage')!;
    const rect = stage.getBoundingClientRect();
    const plot = chart.plotRect(0);
    const y = chart.priceToCoordinate(Number(price), 0);
    if (!plot || y === null || y < plot.top || y > plot.top + plot.height) throw new Error(`BTC order line is not visible: ${y} in ${JSON.stringify(plot)}`);
    (window as any).__tradingMock.dragEvents = [];
    (window as any).__tradingMock.hoverEvents = [];
    (window as any).__tradingMock.contextEvents = [];
    chart.on('drag:start', (event: unknown) => (window as any).__tradingMock.dragEvents.push(event));
    chart.on('hover', (event: unknown) => (window as any).__tradingMock.hoverEvents.push(event));
    chart.on('contextmenu', (event: unknown) => (window as any).__tradingMock.contextEvents.push(event));
    return {
      x: rect.left + plot.left + plot.width * .1,
      y: rect.top + y,
      width: stage.clientWidth,
    };
  }, orderPrice);
  await page.evaluate(price => (window as any).__tradingMock.setOrderPrice(price), orderPrice);
  await page.mouse.move(coordinates.x, coordinates.y);
  await expect.poll(() => page.evaluate(() => (window as any).__tradingMock.hoverEvents.at(-1)?.id)).toBe('hyperliquid-order:77');
  await page.mouse.down();
  await page.mouse.move(coordinates.x, coordinates.y - 18, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__tradingMock.dragEvents.length)).toBeGreaterThan(0);
  const modifyDraft = chartPanel.locator('.hl-chart-draft');
  await expect(modifyDraft).toBeVisible();
  await expect(modifyDraft).toContainText('Modify order #77');
  await expect(modifyDraft.locator('.hl-chart-draft-status')).toContainText('Price draft only');
  const draftedPrice = Number(await modifyDraft.getByLabel('Draft order price').inputValue());
  expect(draftedPrice).not.toBe(Number(orderPrice));
  expect(Number.isInteger(draftedPrice)).toBe(true);
  expect(await page.evaluate(() => (window as any).__tradingMock.dragEvents[0]?.id)).toBe('hyperliquid-order:77');
  await expect(chartPanel.locator('.hl-chart-confirm')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__tradingMock.modified.length)).toBe(0);
  await page.evaluate(() => { (window as any).__tradingMock.modifyError = 'Mocked exchange rejection'; });
  await modifyDraft.getByRole('button', { name: 'Review & submit', exact: true }).click();
  const modifyConfirm = chartPanel.locator('.hl-chart-confirm');
  await expect(modifyConfirm).toBeVisible();
  await expect(modifyConfirm).toContainText(`MAINNET · account ${PRINCIPAL} · Hyperliquid BTC perpetual · modify BUY order #77 · 0.01 BTC @ ${draftedPrice}`);
  const modifyConfirmButton = modifyConfirm.getByRole('button', { name: 'Confirm', exact: true });
  await expect(modifyConfirmButton).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__tradingMock.modified.length)).toBe(0);
  await modifyConfirm.getByLabel('Type MAINNET to confirm').fill('MAINNET');
  await expect(modifyConfirmButton).toBeEnabled();
  await modifyConfirmButton.click();
  await expect(modifyDraft).toBeHidden();
  await expect(modifyDraft.locator('.hl-chart-draft-status')).toContainText('preview rolled back · Mocked exchange rejection');
  expect(await page.evaluate(() => (window as any).__tradingMock.modified)).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__tradingMock.modified[0])).toMatchObject({ type: 'modify-order', orderId: 77, price: String(draftedPrice), size: '0.01' });
  await expect.poll(() => chartPanel.evaluate(panel => {
    const id = (panel as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id).tradingChartOverlay.primitive.orderPrice(77);
  })).toBe(Number(orderPrice));
  expect(await page.evaluate(() => (window as any).__tradingMock.orderPrice)).toBe(orderPrice);

  // The second drag is accepted; the worker publishes the authoritative updated order before resolving.
  await page.evaluate(() => { (window as any).__tradingMock.modifyError = ''; });
  await page.mouse.move(coordinates.x, coordinates.y);
  await page.mouse.down();
  await page.mouse.move(coordinates.x, coordinates.y - 24, { steps: 4 });
  await page.mouse.up();
  const acceptedDraft = chartPanel.locator('.hl-chart-draft');
  await expect(acceptedDraft).toBeVisible();
  const acceptedPrice = Number(await acceptedDraft.getByLabel('Draft order price').inputValue());
  expect(acceptedPrice).not.toBe(Number(orderPrice));
  await acceptedDraft.getByRole('button', { name: 'Review & submit', exact: true }).click();
  const acceptedConfirm = chartPanel.locator('.hl-chart-confirm');
  await expect(acceptedConfirm).toBeVisible();
  await acceptedConfirm.getByLabel('Type MAINNET to confirm').fill('MAINNET');
  await acceptedConfirm.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(acceptedDraft).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__tradingMock.modified.length)).toBe(2);
  await expect.poll(() => chartPanel.evaluate(panel => {
    const id = (panel as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id).tradingChartOverlay.primitive.orderPrice(77);
  })).toBe(acceptedPrice);
  expect(await page.evaluate(() => (window as any).__tradingMock.orderPrice)).toBe(String(acceptedPrice));

  await chartPanel.locator('.chart-stage').click({ button: 'right', position: { x: Math.floor(coordinates.width * .1), y: Math.floor(coordinates.y - (await chartPanel.locator('.chart-stage').evaluate(el => el.getBoundingClientRect().top))) } });
  await expect.poll(() => page.evaluate(() => (window as any).__tradingMock.contextEvents.length)).toBeGreaterThan(0);
  const newDraft = chartPanel.locator('.hl-chart-draft');
  await expect(newDraft).toBeVisible();
  await expect(newDraft.locator('.hl-chart-draft-status')).toContainText('price snapped to BTC tick');
  expect(Number.isInteger(Number(await newDraft.getByLabel('Draft order price').inputValue()))).toBe(true);
  await newDraft.getByLabel('Draft order size in BTC').fill('0.001');
  await newDraft.getByRole('button', { name: 'Review & submit', exact: true }).click();
  await expect(chartPanel.locator('.hl-chart-confirm')).toBeVisible();
  const backButton = chartPanel.locator('.hl-chart-confirm').getByRole('button', { name: 'Back', exact: true });
  await backButton.click();
  await expect(chartPanel.locator('.hl-chart-confirm')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__tradingMock.submitted.length)).toBe(0);
  await newDraft.getByRole('button', { name: 'Discard', exact: true }).click();
  expect(await page.evaluate(id => (window as any).__terminal.panels.get(id).engine.drawings.drawings().length, panelId)).toBe(drawingsBefore);
});

test('testnet panel stays usable while mainnet candle charts reject chart-derived drafts', async ({ page }) => {
  await openTradingAndUnlock(page, 'testnet');
  await expect(page.locator('.hl-status')).toContainText('TESTNET · LIVE');
  await expect(page.getByLabel('BTC order size')).toBeEnabled();

  await page.evaluate(() => (window as any).__terminal.addChart({ venue: 'hyperliquid', market: 'perpetual', interval: '1m' }));
  const chartPanel = page.locator('.candle-panel').filter({ hasText: 'Hyperliquid · BTC Perp' }).last();
  await expect.poll(() => chartPanel.evaluate(panel => {
    const id = (panel as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id)?.diagnostics()?.bars ?? 0;
  })).toBeGreaterThan(0);
  const tradeLines = chartPanel.getByRole('button', { name: 'Trade lines · mainnet only', exact: true });
  await expect(tradeLines).toBeDisabled();
  await expect(tradeLines).toHaveAttribute('title', /mainnet prices/);

  const point = await chartPanel.evaluate(panel => {
    const id = (panel as HTMLElement).dataset.panelId!;
    const chart = (window as any).__terminal.panels.get(id).engine.chart;
    const stage = panel.querySelector<HTMLElement>('.chart-stage')!;
    const rect = stage.getBoundingClientRect(), plot = chart.plotRect(0);
    return { x: rect.left + plot.left + plot.width * .2, y: rect.top + plot.top + plot.height * .5 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(chartPanel.locator('.hl-chart-draft')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__tradingMock.submitted.length)).toBe(0);
});

test('trade entry stays compact and linked activity widgets fit a 300px Dockview pane', async ({ page }) => {
  await openTradingAndUnlock(page, 'mainnet');
  await selectTheme(page, 'dark');
  await page.screenshot({ path: '/tmp/hl-trading-panel-desktop.png' });
  const tradePanel = page.locator('.hyperliquid-trading[data-view="trade"]');
  await page.evaluate(() => (window as any).__terminal.dock.getPanel('hyperliquid-trading').api.setSize({ width: 300 }));
  await expect.poll(() => tradePanel.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(290);
  await expect.poll(() => tradePanel.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(310);
  await expect(tradePanel.getByLabel('BTC order size')).toBeVisible();
  await expect(tradePanel.getByRole('button', { name: 'Open orders', exact: true })).toBeVisible();
  await expect(tradePanel.locator('.hl-scroll-body').getByLabel('Network')).toHaveCount(0);
  await expect(tradePanel.locator('.hl-scroll-body').getByLabel('Agent vault passphrase')).toHaveCount(0);
  await expect(tradePanel.locator('.hl-scroll-body .hl-order-row,.hl-scroll-body .hl-position,.hl-scroll-body .hl-agent')).toHaveCount(0);
  await page.evaluate(() => {
    const mock = (window as any).__tradingMock;
    mock.extraOrders = Array.from({ length: 8 }, (_, index) => ({
      coin: 'BTC', id: 80 + index, cloid: null, side: 'sell', price: String(85_000 + index * 100), size: '0.001', originalSize: '0.001',
      timestamp: Date.now() + index, status: 'open', reduceOnly: false, trigger: false, triggerPrice: null, triggerMarket: false, kind: 'limit',
    }));
    mock.setOrderPrice(mock.orderPrice);
  });
  const ordersPanel = await openTradingWidget(page, 'Open orders', 'open-orders');
  await page.evaluate(() => (window as any).__terminal.dock.getPanel('hyperliquid-open-orders').api.setSize({ width: 300 }));
  await expect.poll(() => ordersPanel.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(290);
  await expect.poll(() => ordersPanel.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(310);
  await expect(ordersPanel.locator('.hl-order-row')).toHaveCount(9);
  const geometry = await page.evaluate(() => {
    const root = document.documentElement, pane = document.querySelector<HTMLElement>('.hyperliquid-trading[data-view="open-orders"]')!, body = pane.querySelector<HTMLElement>('.hl-scroll-body')!;
    const editor = pane.querySelector<HTMLElement>('.hl-order-row .hl-order-edit')!;
    const paneRect = pane.getBoundingClientRect();
    const controlBounds = [...pane.querySelectorAll<HTMLElement>('.hl-order-row .hl-order-edit input,.hl-order-row .hl-order-edit button')].map(control => {
      const rect = control.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    return {
      paneWidth: pane.getBoundingClientRect().width,
      viewportWidth: root.clientWidth,
      documentWidth: root.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      orderEditClientWidth: editor.clientWidth,
      orderEditScrollWidth: editor.scrollWidth,
      controlsInsidePane: controlBounds.every(control => control.width > 0 && control.left >= paneRect.left && control.right <= paneRect.right + 1),
    };
  });
  expect(geometry.paneWidth).toBeGreaterThanOrEqual(290);
  expect(geometry.paneWidth).toBeLessThanOrEqual(310);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.bodyClientWidth + 1);
  expect(geometry.orderEditScrollWidth).toBeLessThanOrEqual(geometry.orderEditClientWidth + 1);
  expect(geometry.bodyScrollHeight).toBeLessThanOrEqual(geometry.bodyClientHeight + 1);
  expect(geometry.controlsInsidePane).toBe(true);

  await ordersPanel.locator('.hl-scroll-body').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: '/tmp/hl-trading-panel-300-top.png' });

  const settings = await openTradingSettings(page);
  await expect(settings.getByLabel('Network')).toBeVisible();
  await expect(settings.getByLabel('Hyperliquid principal address')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/hl-trading-settings.png' });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();

  await tradePanel.getByLabel('BTC order size').fill('0.001');
  await tradePanel.getByLabel('BTC order limit price').fill('84000');
  const review = tradePanel.getByRole('button', { name: 'Review order', exact: true });
  await review.scrollIntoViewIfNeeded();
  await review.click();
  const confirm = tradePanel.locator('dialog.hl-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Confirm action', exact: true })).toBeDisabled();
  await confirm.getByRole('button', { name: 'Back', exact: true }).click();

  const orderRow = ordersPanel.locator('.hl-order-row[data-order-id="87"]');
  await orderRow.scrollIntoViewIfNeeded();
  await expect(orderRow.getByRole('button', { name: 'Modify', exact: true })).toBeEnabled();
  await expect(orderRow.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await expect(orderRow.getByRole('button', { name: 'Modify', exact: true })).toBeVisible();
  await expect(orderRow.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/hl-trading-panel-300-orders.png' });
});

test('chart trade overlay bounds hidden updates and releases subscriptions and primitives through repeated toggles and close', async ({ page }) => {
  await openTradingAndUnlock(page, 'mainnet');
  await page.evaluate(() => (window as any).__terminal.addChart({ venue: 'hyperliquid', market: 'perpetual', interval: '1m' }));
  const chartPanel = page.locator('.candle-panel').filter({ hasText: 'Hyperliquid · BTC Perp' }).last();
  await expect.poll(() => chartPanel.evaluate(panel => {
    const id = (panel as HTMLElement).dataset.panelId!;
    return (window as any).__terminal.panels.get(id)?.diagnostics()?.bars ?? 0;
  })).toBeGreaterThan(0);
  const panelId = await chartPanel.getAttribute('data-panel-id');
  if (!panelId) throw new Error('Hyperliquid candle panel has no id');
  const tradingButton = chartPanel.getByRole('button', { name: 'Trade lines', exact: true });
  const baselineListeners = await page.evaluate(() => (window as any).__terminal.trading.listeners.size);
  const resources = () => page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id), controller = (window as any).__terminal.trading;
    const primitive = panel.tradingChartOverlay.primitive;
    const primitiveCount = panel.engine.chart.panes().reduce((count: number, pane: any) => count + pane.primitives().filter((candidate: unknown) => candidate === primitive).length, 0);
    return { listeners: controller.listeners.size, primitiveCount };
  }, panelId);

  await tradingButton.click();
  await expect(chartPanel.getByRole('button', { name: 'Trade lines · on', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await resources()).primitiveCount).toBe(1);
  await expect.poll(async () => (await resources()).listeners).toBe(baselineListeners + 1);
  for (let cycle = 0; cycle < 4; cycle++) {
    await chartPanel.getByRole('button', { name: 'Trade lines · on', exact: true }).click();
    await expect.poll(async () => (await resources()).primitiveCount).toBe(0);
    await expect.poll(async () => (await resources()).listeners).toBe(baselineListeners);
    await chartPanel.getByRole('button', { name: 'Trade lines', exact: true }).click();
    await expect.poll(async () => (await resources()).primitiveCount).toBe(1);
    await expect.poll(async () => (await resources()).listeners).toBe(baselineListeners + 1);
  }

  await page.evaluate(({ referenceId, panelId: siblingId }) => {
    const dock = (window as any).__terminal.dock;
    const sibling = dock.addPanel({ id: siblingId, component: 'candle', title: 'Overlay visibility audit',
      params: { venue: 'binance', market: 'perpetual', interval: '1m', type: 'candle', studies: [] },
      position: { referencePanel: referenceId, direction: 'within' }, minimumWidth: 220, minimumHeight: 140 });
    sibling.api.setActive();
  }, { referenceId: panelId, panelId: 'hl-overlay-visibility-sibling' });
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.isVisible, panelId)).toBe(false);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.visible, panelId)).toBe(false);
  await page.waitForTimeout(100);
  const hidden = await page.evaluate(async id => {
    const terminal = (window as any).__terminal, panel = terminal.panels.get(id), engine = panel.engine;
    terminal.resetMetrics();
    const drawsBefore = engine.stats.draws;
    const mock = (window as any).__tradingMock;
    for (let index = 0; index < 24; index++) mock.setOrderPrice(String(84_000 + index));
    await new Promise(resolve => setTimeout(resolve, 250));
    return { visible: engine.visible, drawDelta: engine.stats.draws - drawsBefore, pendingCallbacks: engine.callbacks.size, scheduledFrames: terminal.stats().frameIntervals.length };
  }, panelId);
  expect(hidden.visible).toBe(false);
  expect(hidden.drawDelta).toBe(0);
  expect(hidden.pendingCallbacks).toBeLessThanOrEqual(1);
  expect(hidden.scheduledFrames).toBeLessThan(5);

  await page.evaluate(id => (window as any).__terminal.dock.getPanel(id).api.setActive(), panelId);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.get(id).engine.visible, panelId)).toBe(true);
  await page.evaluate(id => {
    const panel = (window as any).__terminal.panels.get(id);
    (window as any).__hlOverlayAudit = { overlay: panel.tradingChartOverlay, primitive: panel.tradingChartOverlay.primitive, root: panel.tradingChartOverlay.root };
    (window as any).__hlOverlayListenersBeforeClose = (window as any).__terminal.trading.listeners.size;
    (window as any).__terminal.dock.getPanel(id).api.close();
  }, panelId);
  await expect.poll(() => page.evaluate(id => (window as any).__terminal.panels.has(id), panelId)).toBe(false);
  const afterClose = await page.evaluate(() => {
    const audit = (window as any).__hlOverlayAudit;
    return {
      listeners: (window as any).__terminal.trading.listeners.size,
      listenersBefore: (window as any).__hlOverlayListenersBeforeClose,
      primitiveDetached: audit.primitive.host === undefined,
      overlayRootRemoved: !audit.root.isConnected,
      domListenersAborted: audit.overlay.abort.signal.aborted,
    };
  });
  expect(afterClose.listenersBefore - afterClose.listeners).toBe(2);
  expect(afterClose.primitiveDetached).toBe(true);
  expect(afterClose.overlayRootRemoved).toBe(true);
  expect(afterClose.domListenersAborted).toBe(true);
});
