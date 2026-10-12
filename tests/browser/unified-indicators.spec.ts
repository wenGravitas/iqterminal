import { chooseChartMarket } from './indicator-actions';
import { test, expect } from '@playwright/test';
import { installDepthFixture } from './depth-fixture';
import { addIndicator, setFootprint, setPriceLevel, setUnits } from './indicator-actions';

async function fixture(page: import('@playwright/test').Page) {
  const worker = await installDepthFixture(page);
  await worker.evaluate(() => {
    const Base = self.WebSocket;
    const probe = (self as any).__executionFixture = { sockets: 0, active: 0, accepted: 0 };
    let sequence = 1;
    class Socket {
      readyState = 0; onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror = null; onmessage: ((e: any) => void) | null = null;
      timer?: ReturnType<typeof setInterval>;
      constructor() { probe.sockets++; probe.active++; setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); this.timer = setInterval(() => {
        const a = sequence++, now = Date.now(); probe.accepted++;
        this.onmessage?.({ data: JSON.stringify({ e: 'aggTrade', s: 'BTCUSDT', E: now, T: now, a, f: a*2, l: a*2+1, p: String(82990+(a%4)*10), q: '.01', m: a%2 === 0 }) });
      },100); },10); }
      close() { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this.timer); probe.active--; this.onclose?.(); }
      send() {}
    }
    self.WebSocket = new Proxy(Base, { construct(target,args) { return String(args[0]).includes('@aggTrade') ? new Socket() : Reflect.construct(target,args); } }) as any;
  });
  return worker;
}

test('unified catalogue, independent scripts and native ownership through hide, remove and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror',e => errors.push(e.message));
  const worker = await fixture(page); await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('dark'); const panel = page.locator('.candle-panel').first();
  expect(await panel.locator('.chart-toolbar select').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).toEqual(['Timeframe']);
  await addIndicator(panel, 'EMA overlay'); await expect(panel.locator('.active-indicator')).toHaveCount(1);
  await panel.getByRole('button',{ name:'EMA overlay settings',exact:true }).click();
  await panel.locator('.indicator-settings:not(.heatmap-settings):not(.footprint-settings-dialog):not(.chart-settings) input[data-input-key=length]').fill('20');
  await panel.getByRole('dialog',{name:'Study settings',exact:true}).getByRole('button',{name:'Apply',exact:true}).click();
  await addIndicator(panel, 'EMA overlay'); await expect(panel.locator('.active-indicator[data-definition-id="script:builtin.ema-overlay"]')).toHaveCount(2);
  await panel.getByRole('button',{name:'EMA overlay settings',exact:true}).nth(1).click();
  await panel.locator('[data-input-key=length]').fill('50'); await panel.getByRole('dialog',{name:'Study settings',exact:true}).getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].studies.views().map((v:any) => v.settings.length).sort())).toEqual([20,50]);
  await setFootprint(panel,true); await addIndicator(panel,'Order-book Heatmap');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].footprint.bars)).toBeGreaterThan(0);
  await expect(panel.locator('.heatmap-notice')).toContainText('live');
  await setUnits(panel,'usdt'); await expect(panel.locator('.heatmap-notice')).toContainText('USDT');
  await setPriceLevel(panel,'50');
  await panel.getByRole('button',{name:'Order-book Heatmap settings',exact:true}).click();
  await expect(panel.getByLabel('Quantity units',{exact:true})).toHaveValue('usdt');
  await panel.getByLabel('Opacity',{exact:true}).fill('.6'); await panel.locator('.heatmap-settings').getByRole('button',{name:'Apply',exact:true}).click();
  const start = await page.evaluate(() => (window as any).__terminal.stats().panels[0].footprint.status.collectionStartedAt);
  await panel.getByRole('button',{name:'Hide Footprint',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.stats().panels[0].series.type)).toBe('candle');
  await expect(panel.locator('.heatmap-notice')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await worker.evaluate(() => (self as any).__executionFixture.active)).toBe(1);
  await panel.getByRole('button',{name:'Show Footprint',exact:true}).click();
  expect(await page.evaluate(() => (window as any).__terminal.stats().panels[0].footprint.status.collectionStartedAt)).toBe(start);
  await panel.getByRole('button',{name:'Hide Order-book Heatmap',exact:true}).click();
  await expect(panel.locator('.heatmap-notice')).toBeHidden(); expect(await worker.evaluate(() => (self as any).__heatmapFixture.active)).toBe(1);
  await panel.getByRole('button',{name:'Show Order-book Heatmap',exact:true}).click();
  await panel.getByRole('button',{name:'Indicators',exact:true}).click(); await panel.getByRole('button',{name:'Configure Footprint',exact:true}).click();
  await expect(panel.locator('.footprint-settings-dialog')).toBeVisible(); await panel.locator('.footprint-settings-dialog').getByRole('button',{name:'Close',exact:true}).click();
  expect(await panel.locator('.active-indicator[data-definition-id="native.footprint"]').count()).toBe(1);
  const range = await page.evaluate(() => (window as any).__terminal.stats().panels[0].range);
  const listBox = await panel.locator('.active-indicators summary').boundingBox();
  await page.mouse.move(listBox!.x+80,listBox!.y+5); await page.mouse.wheel(0,100);
  expect(await page.evaluate(() => (window as any).__terminal.stats().panels[0].range)).toEqual(range);
  await page.screenshot({path:'artifacts/unified-indicators-1366x768.png'});
  await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('light');
  await page.setViewportSize({width:720,height:860});
  const settings = panel.getByRole('button',{name:'Footprint settings',exact:true}); await settings.focus(); await page.keyboard.press('Enter');
  await expect(panel.locator('.footprint-settings-dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await panel.locator('.active-indicators summary').click(); await expect(panel.getByRole('button',{name:'Hide Footprint',exact:true})).toBeHidden();
  await panel.locator('.active-indicators summary').click();
  await page.screenshot({path:'artifacts/unified-indicators-720x860.png'});
  await panel.getByRole('button',{name:'Remove Footprint',exact:true}).click();
  await panel.getByRole('button',{name:'Order-book Heatmap settings',exact:true}).click();
  await panel.getByLabel('Quantity units',{exact:true}).selectOption('btc');
  await panel.locator('.heatmap-settings').getByRole('button',{name:'Apply',exact:true}).click();
  await expect(panel.locator('.heatmap-notice')).toContainText('BTC'); expect(await worker.evaluate(() => (self as any).__executionFixture.active)).toBe(0);
  expect(await worker.evaluate(() => (self as any).__heatmapFixture.active)).toBe(1);
  await setFootprint(panel,true); await expect.poll(() => worker.evaluate(() => (self as any).__executionFixture.active)).toBe(1);
  await panel.getByRole('button',{name:'Remove Order-book Heatmap',exact:true}).click(); expect(await worker.evaluate(() => (self as any).__executionFixture.active)).toBe(1);
  await addIndicator(panel,'Order-book Heatmap');
  await panel.getByLabel('Timeframe',{exact:true}).selectOption('5m'); await chooseChartMarket(panel,'Binance · BTCUSDT Spot');
  await expect(panel.locator('.active-indicator[data-definition-id="native.footprint"]')).toContainText('Unavailable');
  await expect(panel.locator('.heatmap-notice')).toContainText('unavailable');
  await page.waitForTimeout(350); await page.reload(); await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  await expect(panel.locator('.active-indicator')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => [...(window as any).__terminal.panels.values()][0].studies.views().map((v:any) => v.settings.length).sort())).toEqual([20,50]);
  expect(await page.evaluate(() => (window as any).__terminal.stats().panels[0].series.rowPrice)).toBe(50);
  expect(errors).toEqual([]);
});

test('legacy footprint/heatmap layout migrates idempotently and unknown definitions stay recoverable', async ({page}) => {
  await page.goto('/?fixture=1'); await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  await page.evaluate(() => {
    const layout=(window as any).__terminal.dock.toJSON(), params=Object.values(layout.panels)[0] as any;
    params.params={venue:'binance',market:'perpetual',interval:'1m',type:'footprint',rowPrice:50,footprintUnits:'usdt',heatmap:{enabled:true,opacity:.65},footprint:{opacity:.35}};
    localStorage.setItem('basis.layout.v1',JSON.stringify({version:2,layout}));
  });
  await page.reload(); await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  const panel=page.locator('.candle-panel').first(); await expect(panel.locator('.active-indicator')).toHaveCount(2);
  await expect(panel.locator('.active-indicator[data-definition-id="native.footprint"]')).toContainText('$50 · USDT');
  await page.waitForTimeout(400); await page.reload(); await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  await expect(panel.locator('.active-indicator')).toHaveCount(2);
  await page.evaluate(() => {
    const layout=(window as any).__terminal.dock.toJSON(), p=Object.values(layout.panels)[0] as any;
    p.params.indicators.push({instanceId:'unknown-profile',definitionId:'future.profile',settingsVersion:9,visible:true,settings:{anchor:'session'},placement:'attachment',source:{kind:'chart'}});
    localStorage.setItem('basis.layout.v1',JSON.stringify({version:3,layout}));
  });
  await page.reload(); await page.waitForFunction(() => (window as any).__terminal?.panels.size === 2);
  await expect(panel.locator('[data-definition-id="future.profile"]')).toContainText('settings retained');
  await panel.getByRole('button',{name:'Remove future.profile',exact:true}).click(); await expect(panel.locator('.active-indicator')).toHaveCount(2);
});
