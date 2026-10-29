import { test, expect } from '@playwright/test';
import { installTradeFixture } from './trade-fixture';

test('sound tests unlock real audio output and ticker buttons track enabled, muted and suspended states', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Measure the mixed output after shared compression, without replacing Web Audio.
    const connect = AudioNode.prototype.connect;
    const probe = (window as any).__audioProbe = { peak: 0, outputConnections: 0 };
    AudioNode.prototype.connect = function(this: AudioNode, destination: any, ...args: any[]) {
      if (destination instanceof AudioDestinationNode && this instanceof GainNode) {
        const analyser = this.context.createAnalyser();
        (connect as any).call(this, analyser); (connect as any).call(analyser, destination);
        probe.outputConnections++;
        const samples = new Float32Array(analyser.fftSize);
        const timer = setInterval(() => { analyser.getFloatTimeDomainData(samples); for (const sample of samples) probe.peak = Math.max(probe.peak, Math.abs(sample)); }, 10);
        setTimeout(() => clearInterval(timer), 1500);
        return destination;
      }
      return (connect as any).call(this, destination, ...args);
    } as typeof AudioNode.prototype.connect;
  });
  const worker = await installTradeFixture(page);
  await page.getByRole('button', { name: 'Trade Ticker', exact: true }).click();
  const ticker = page.locator('.trade-ticker').first(), audio = ticker.locator('.ticker-audio');
  await expect(audio).toHaveAttribute('aria-pressed', 'false');
  await expect(audio).toHaveAttribute('title', 'Audio disabled · Enable audio');
  expect(await audio.evaluate(element => getComputedStyle(element).color)).toBe(await audio.evaluate(element => { const probe = document.createElement('span'); probe.style.color = 'var(--down)'; element.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }));
  await ticker.screenshot({ path: '/tmp/ticker-audio-disabled.png' });
  await ticker.getByRole('button', { name: 'Trade Ticker settings', exact: true }).click();
  const settings = ticker.locator('.ticker-settings'), tier = settings.locator('.ticker-tier-table tbody tr').last();
  await tier.getByRole('button', { name: 'Test Tier' }).click();
  await expect(settings).toContainText('Sound preview playing');
  await expect(audio).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).__audioProbe.peak)).toBeGreaterThan(.02);
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await ticker.screenshot({ path: '/tmp/ticker-audio-enabled.png' });
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.notifications.diagnostics().voices)).toBe(0);
  await page.evaluate(() => (window as any).__audioProbe.peak = 0);
  await expect.poll(() => worker.evaluate(() => (self as any).__tradeFixture.active)).toBe(1);
  await worker.evaluate(() => (self as any).__tradeFixture.emit(10));
  await expect.poll(() => page.evaluate(() => (window as any).__audioProbe.peak)).toBeGreaterThan(.02);
  await audio.click();
  await expect(audio).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.notifications.diagnostics().voices)).toBe(0);
  expect(await page.evaluate(() => (window as any).__terminal.notifications.diagnostics().muted)).toBe(false);
  await page.evaluate(() => (window as any).__terminal.notifications.deliver({ eventId: 'muted-audio-toast', ruleId: 'audio-test', owner: 'audio-test', timeMs: Date.now(), fresh: true, title: 'Toast while audio is off', text: 'Audio mute preserves toasts', sound: 'bell', volume: .5, toast: true }));
  await expect(page.locator('.notification-toast').filter({ hasText: 'Toast while audio is off' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.notifications.diagnostics().voices)).toBe(0);
  await audio.click();
  await expect(audio).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Trade Ticker', exact: true }).click();
  const second = page.locator('.trade-ticker').last().locator('.ticker-audio');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const notifications = page.getByRole('dialog', { name: 'Notifications settings' });
  await notifications.getByLabel('Master mute').check();
  await expect(audio).toHaveAttribute('aria-pressed', 'false');
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await notifications.getByRole('button', { name: 'Preview bell' }).click();
  await expect(audio).toHaveAttribute('aria-pressed', 'true');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await notifications.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => (window as any).__terminal.notifications.audio.suspend());
  await expect(audio).toHaveAttribute('aria-pressed', 'false');
  await audio.click();
  await expect(audio).toHaveAttribute('aria-pressed', 'true');
  await ticker.getByRole('button', { name: 'Trade Ticker settings', exact: true }).click();
  await settings.locator('.ticker-tier-table tbody tr').first().getByRole('button', { name: 'Test Tier' }).click();
  await expect(settings).toContainText('Silent tier');
  await tier.getByLabel('Sound volume (%)', { exact: true }).fill('0');
  await tier.getByRole('button', { name: 'Test Tier' }).click();
  await expect(settings).toContainText('Tier volume is 0%');
  expect(errors).toEqual([]);
});

test('blocked audio remains disabled and explains why a test cannot play', async ({ page }) => {
  await page.addInitScript(() => { window.AudioContext = class { constructor() { throw new Error('Audio blocked'); } } as any; });
  await installTradeFixture(page);
  await page.getByRole('button', { name: 'Trade Ticker', exact: true }).click();
  const ticker = page.locator('.trade-ticker');
  await ticker.locator('.ticker-audio').click();
  await expect(ticker.locator('.ticker-audio')).toHaveAttribute('aria-pressed', 'false');
  await ticker.getByRole('button', { name: 'Trade Ticker settings', exact: true }).click();
  await ticker.locator('.ticker-tier-table tbody tr').last().getByRole('button', { name: 'Test Tier' }).click();
  await expect(ticker.locator('.ticker-settings')).toContainText('Audio unavailable');
});

test('notification scores have useful sustained output and headroom when alerts overlap', async ({ page }) => {
  await installTradeFixture(page);
  const measurements = await page.evaluate(async () => {
    // Render the real Notifications graph deterministically; only replace the
    // hardware context with Web Audio's offline renderer, not its DSP nodes.
    const NativeContext = window.AudioContext;
    const saved = localStorage.getItem('basis.notifications.v1');
    const Notifications = (window as any).__terminal.notifications.constructor;
    const results: Array<{ sound: string; volume: number; overlap: boolean; peak: number; rms: number }> = [];
    try {
      for (const sound of ['bell', 'chime', 'alarm']) for (const volume of [0, .5, 1]) for (const overlap of [false, true]) {
        let context!: OfflineAudioContext;
        window.AudioContext = class {
          constructor() {
            context = new OfflineAudioContext(1, 96000, 48000);
            Object.defineProperty(context, 'state', { get: () => 'running' });
            // enable()/dispose() belong to the realtime lifecycle, while all
            // oscillator, envelope, mixing and compressor processing stays real.
            (context as any).resume = async () => {};
            (context as any).close = async () => {};
            return context;
          }
        } as any;
        localStorage.setItem('basis.notifications.v1', JSON.stringify({ version: 1, muted: false, volume }));
        const notifications = new Notifications();
        try {
          await notifications.enable();
          // enable restores zero master volume; explicitly test true zero too.
          notifications.settings.volume = volume;
          notifications.play(sound, volume);
          if (overlap) notifications.play(sound, volume);
          const samples = (await context.startRendering()).getChannelData(0);
          const count = Math.floor((sound === 'bell' ? .7 : sound === 'chime' ? .52 : .56) * 48000);
          let peak = 0, squares = 0;
          for (let i = 0; i < samples.length; i++) {
            peak = Math.max(peak, Math.abs(samples[i]!));
            if (i < count) squares += samples[i]! ** 2;
          }
          results.push({ sound, volume, overlap, peak, rms: Math.sqrt(squares / count) });
        } finally { notifications.dispose(); }
      }
    } finally {
      window.AudioContext = NativeContext;
      if (saved === null) localStorage.removeItem('basis.notifications.v1');
      else localStorage.setItem('basis.notifications.v1', saved);
    }
    return results;
  });
  for (const result of measurements) {
    expect(result.peak, JSON.stringify(result)).toBeLessThan(.99);
    if (result.volume === 0) expect(result.peak).toBe(0);
    if (result.volume === .5 && !result.overlap) {
      expect(result.rms, JSON.stringify(result)).toBeGreaterThan(result.sound === 'bell' ? .025 : .05);
    }
    if (result.volume === 1 && !result.overlap) {
      const half = measurements.find(v => v.sound === result.sound && v.volume === .5 && !v.overlap)!;
      expect(result.rms).toBeGreaterThan(half.rms);
    }
  }
});

test('amount filters suppress hidden-trade alerts in USDT and BTC without replay on filter changes', async ({ page }) => {
  const worker = await installTradeFixture(page);
  await page.getByRole('button', { name: 'Trade Ticker', exact: true }).click();
  const ticker = page.locator('.trade-ticker').first();
  await ticker.locator('.ticker-audio').click();
  await expect(ticker.locator('.ticker-audio')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => worker.evaluate(() => (self as any).__tradeFixture.active)).toBe(1);
  const minimum = ticker.getByLabel('Minimum trade size', { exact: true });
  const retained = () => page.evaluate(() => [...(window as any).__terminal.tickers.values()][0].diagnostics().retained);
  const delivered = () => page.evaluate(() => (window as any).__terminal.notifications.diagnostics().delivered);
  const rows = ticker.locator('.ticker-table .ticker-row');
  await minimum.fill('2M'); await minimum.press('Tab');
  await worker.evaluate(() => (self as any).__tradeFixture.emit(10));
  await expect.poll(retained).toBe(1);
  await expect(rows).toHaveCount(0);
  expect(await delivered()).toBe(0);
  expect(await page.evaluate(() => (window as any).__terminal.notifications.diagnostics().voices)).toBe(0);
  await expect(page.locator('.notification-toast')).toHaveCount(0);

  await ticker.getByLabel('Trade size filter unit', { exact: true }).selectOption('BTC');
  await minimum.fill('20'); await minimum.press('Tab');
  await worker.evaluate(() => (self as any).__tradeFixture.emit(19.99));
  await expect.poll(retained).toBe(2);
  await expect(rows).toHaveCount(0);
  expect(await delivered()).toBe(0);
  await worker.evaluate(() => (self as any).__tradeFixture.emit(20));
  await expect.poll(delivered).toBe(1);
  await expect(rows).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.notifications.diagnostics().voices)).toBeGreaterThan(0);
  await expect(page.locator('.notification-toast')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).__terminal.notifications.diagnostics().voices)).toBe(0);

  await minimum.fill('0'); await minimum.press('Tab');
  await expect(rows).toHaveCount(3);
  expect(await delivered()).toBe(1);
  expect(await page.evaluate(() => (window as any).__terminal.notifications.diagnostics().voices)).toBe(0);
});
