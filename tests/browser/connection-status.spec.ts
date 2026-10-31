import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('shows explicit fixture feed state, preserves popup interaction, and fits desktop/narrow light/dark layouts', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('html')).toHaveAttribute('data-app-state', 'ready');
  const trigger = page.locator('#connection-status-trigger');
  const connectionPopover = page.locator('#connection-status-popover');
  const clockTrigger = page.locator('#market-pulse-trigger');
  const clockPopover = page.locator('#market-pulse-popover');
  await expect(trigger).toHaveAttribute('data-state', 'fixture');
  await expect(trigger).toHaveAttribute('aria-label', 'Connection status: Diagnostic fixtures');

  const before = await page.evaluate(() => ({
    subscriptions: (window as any).__terminal.feed.protocolDiagnostics().subscriptions,
    commands: (window as any).__terminal.feed.protocolDiagnostics().commands,
  }));
  await trigger.click();
  await expect(connectionPopover).toBeVisible();
  await expect(connectionPopover.getByText('Monitored feeds', { exact: true })).toBeVisible();
  await expect(connectionPopover).toContainText('Active candle, CVD, ticker and comparison feeds.');
  await expect(connectionPopover).toContainText('Historical server logs are not available here.');
  await expect(connectionPopover.locator('[data-connection-summary]')).toContainText('Diagnostic fixtures');
  await expect(connectionPopover.locator('.connection-feed-row')).toHaveCount(1);
  await expect(connectionPopover.locator('.connection-feed-mode')).toHaveText('fixture');
  await expect(connectionPopover.locator('[data-connection-timezone]')).not.toBeEmpty();

  await page.keyboard.press('Alt+1');
  await expect(connectionPopover).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(connectionPopover).toBeHidden();
  await expect(trigger).toBeFocused();

  await clockTrigger.click();
  await expect(clockPopover).toBeVisible();
  await trigger.click();
  await expect(clockPopover).toBeHidden();
  await expect(connectionPopover).toBeVisible();
  await page.evaluate(() => document.body.click());
  await expect(connectionPopover).toBeHidden();

  await trigger.click();
  await expect(connectionPopover).toBeVisible();
  await trigger.evaluate((button: HTMLButtonElement) => button.click());
  await expect(connectionPopover).toBeHidden();
  const after = await page.evaluate(() => ({
    subscriptions: (window as any).__terminal.feed.protocolDiagnostics().subscriptions,
    commands: (window as any).__terminal.feed.protocolDiagnostics().commands,
  }));
  expect(after).toEqual(before);

  const sizes = [
    { name: 'desktop-dark', width: 1366, height: 768, theme: 'dark' },
    { name: 'desktop-light', width: 1366, height: 768, theme: 'light' },
    { name: 'narrow-dark', width: 720, height: 860, theme: 'dark' },
    { name: 'narrow-light', width: 720, height: 860, theme: 'light' },
  ];
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.locator('#theme').selectOption(size.theme);
    await trigger.click();
    await expect(connectionPopover).toBeVisible();
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('#connection-status-popover')!;
      const box = panel.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
        viewportWidth: innerWidth, viewportHeight: innerHeight, footerGroup: document.querySelector('#footer-status-group')!.getBoundingClientRect().toJSON() };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(size.width);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(size.height);
    await page.screenshot({ path: `/tmp/iqterminal-connection-status-${size.name}.png` });
    await trigger.click();
  }
});

test('keeps monitored-feed and activity rows stable on timestamp-only status updates', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect(page.locator('html')).toHaveAttribute('data-app-state', 'ready');
  const closes=page.getByRole('button',{name:/^Close /});if(await closes.count()>1)await closes.nth(1).click();
  const trigger=page.locator('#connection-status-trigger'),popover=page.locator('#connection-status-popover');
  await trigger.click();
  await expect(popover.locator('.connection-feed-row')).toHaveCount(1);
  const online=await page.evaluate(()=>navigator.onLine);
  await page.evaluate(initial=>{
    window.dispatchEvent(new Event(initial?'offline':'online'));
    window.dispatchEvent(new Event(initial?'online':'offline'));
  },online);
  await expect.poll(()=>popover.locator('.connection-activity-row').count()).toBeGreaterThan(0);

  await page.evaluate(()=>{
    const terminal=(window as any).__terminal,feed=terminal.feed,panel=[...terminal.panels.values()][0];
    const token=[...feed.current.values()][0],listener=feed.listeners.get(token);
    const current=feed.feedStatusSnapshot().find((status:any)=>status.key===listener?.status.key);
    if(!token||!listener||!current)throw new Error('No active candle feed status to update');
    const row=document.querySelector('.connection-feed-row')!,activity=document.querySelector('.connection-activity-row')!;
    const chart=panel.engine.chart,range=chart.timeScale.visibleRange();
    (window as any).__connectionStableRefs={row,activity,chart,range,lastUpdate:current.lastUpdate,token,key:listener.key,statusKey:listener.status.key,state:current.state,message:current.message};
    const at=Math.max(current.lastUpdate,Date.now())+1000;
    const send=(lastUpdate:number)=>feed.worker.onmessage({data:{type:'status',key:listener.key,ids:[token],status:{state:current.state,message:current.message,lastUpdate}}});
    send(at);send(at+1000);
  });
  await expect.poll(()=>popover.locator('.connection-feed-age').getAttribute('datetime')).not.toBeNull();
  const outcome=await page.evaluate(()=>{
    const refs=(window as any).__connectionStableRefs,terminal=(window as any).__terminal,panel=[...terminal.panels.values()][0],feed=terminal.feed;
    const current=feed.feedStatusSnapshot().find((status:any)=>status.key===refs.statusKey),range=panel.engine.chart.timeScale.visibleRange();
    return {sameFeedRow:refs.row===document.querySelector('.connection-feed-row'),
      sameActivityRow:refs.activity===document.querySelector('.connection-activity-row'),sameChart:refs.chart===panel.engine.chart,
      sameViewport:JSON.stringify(refs.range)===JSON.stringify(range),lastUpdateAdvanced:current.lastUpdate>refs.lastUpdate,
      latestTimestamp:document.querySelector('.connection-feed-age')?.getAttribute('datetime')};
  });
  expect(outcome.sameFeedRow).toBe(true);
  expect(outcome.sameActivityRow).toBe(true);
  expect(outcome.sameChart).toBe(true);
  expect(outcome.sameViewport).toBe(true);
  expect(outcome.lastUpdateAdvanced).toBe(true);
  expect(outcome.latestTimestamp).not.toBeNull();
});
