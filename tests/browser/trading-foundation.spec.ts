import { test, expect } from '@playwright/test';

test('signing review names the exact execution identity and supports keyboard cancellation', async ({ page, context }) => {
  const principal = `0x${'1'.repeat(40)}`, executionAddress = `0x${'2'.repeat(40)}`;
  const accounts = [
    { id: 'review-master', name: 'Shared account name', environment: 'testnet', mode: 'read-only', identity: { venue: 'hyperliquid', principal, executionAddress: null }, policy: { maxRiskCash: '100', maxGrossNotional: '100000', maxLeverage: '1' } },
    { id: 'review-subaccount', name: 'Shared account name', environment: 'testnet', mode: 'read-only', identity: { venue: 'hyperliquid', principal, executionAddress }, policy: { maxRiskCash: '100', maxGrossNotional: '100000', maxLeverage: '1' } },
  ];
  let mutations = 0;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  await context.route('http://127.0.0.1:8789/**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
    if (!route.request().url().endsWith('/v1/accounts')) { mutations++; await route.abort(); return; }
    await route.fulfill({ headers: cors, json: { environment: 'testnet', intents: [], accounts: accounts.map(account => ({ account, snapshot: {
      accountId: account.id, scope: `hyperliquid:testnet:${account.identity.executionAddress ?? principal}`, environment: 'testnet', venue: 'hyperliquid',
      asOf: Date.now(), equity: '2000', availableMargin: '2000', grossNotional: '0', positions: [], orders: [], fills: [], ordersComplete: true,
      tier: 'Fixture testnet service', marginMode: 'cross', imposedDelayMs: 0, permission: 'testnet-authorized',
    } })) } });
  });
  await context.route('https://api.hyperliquid-testnet.xyz/info', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
    const body = route.request().postDataJSON();
    const data = body.type === 'clearinghouseState' ? { marginSummary: { accountValue: '2000', totalNtlPos: '0' }, withdrawable: '2000', assetPositions: [] }
      : body.type === 'metaAndAssetCtxs' ? [{ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 5 }, { name: 'ETH', szDecimals: 4, maxLeverage: 5 }] }, [{ markPx: '100000' }, { markPx: '4000' }]]
      : body.type === 'l2Book' ? { levels: [[{ px: '100000', sz: '1' }], [{ px: '100001', sz: '1' }]] } : [];
    await route.fulfill({ headers: cors, json: data });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/'); await page.locator('#trading-accounts').click();
  const panel = page.locator('.trading-foundation');
  await panel.getByText('Testnet signing service', { exact: true }).click();
  await panel.getByLabel('Testnet service token', { exact: true }).fill('fixture-service-token-is-not-a-real-secret');
  await panel.getByRole('button', { name: 'Connect testnet service' }).click();
  await expect(panel.locator('.tf-status')).toContainText('Authorized local testnet service connected');
  await panel.getByLabel('Execution account or group', { exact: true }).selectOption('review-subaccount');
  await panel.getByRole('button', { name: 'Refresh & preview' }).click();
  await expect(panel.locator('.tf-status'), await panel.locator('.tf-allocations').innerText()).toContainText('Updated 1 read-only accounts');
  await panel.getByLabel('Plan entry price', { exact: true }).fill('100000');
  await panel.getByLabel('Plan stop price', { exact: true }).fill('99000');
  await panel.getByLabel('Plan stop price', { exact: true }).press('Tab');
  await panel.getByRole('button', { name: 'Review testnet limit entry' }).click();
  const dialog = page.getByRole('dialog', { name: 'TESTNET · Shared account name · hyperliquid' });
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText(`Principal ${principal}`); await expect(dialog).toContainText(`Subaccount ${executionAddress}`);
  await expect(dialog).toHaveAttribute('aria-describedby', /identity.*description/);
  await expect(dialog.getByLabel('Type TESTNET to confirm', { exact: true })).toBeFocused();
  await page.screenshot({ path: 'artifacts/trading-foundation/confirmation-desktop.png' });
  await page.setViewportSize({ width: 720, height: 860 });
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'artifacts/trading-foundation/confirmation-narrow.png' });
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); expect(mutations).toBe(0);
});

test('named account groups calculate independent risk and rehearse protected partial fills', async ({ page }) => {
  await page.goto('/?fixture=1');
  await page.locator('#trading-accounts').click();
  const panel = page.locator('.trading-foundation');
  await panel.getByRole('button', { name: 'Load practice accounts', exact: true }).click();
  await expect(panel.locator('.tf-allocation').first()).toContainText('0.01 BTC');
  await expect(panel.locator('.tf-allocations')).toContainText('0.05 BTC');
  await expect(panel.locator('.tf-allocations')).toContainText('0.02 BTC');
  await panel.getByRole('button', { name: 'Rehearse group plan' }).click();
  await panel.getByRole('button', { name: 'Apply event' }).click();
  await expect(panel.locator('.tf-outcomes')).toContainText('4 protected');
  await expect(panel.locator('.tf-outcomes')).toContainText('0.005 open / 0.005 stop acknowledged');
  await panel.getByLabel('Rehearsal event').selectOption('emergency');
  await panel.getByRole('button', { name: 'Apply event' }).click();
  await expect(panel.locator('.tf-outcomes')).toContainText('4 confirmed flat');
  await expect(panel.locator('.tf-outcomes')).toContainText('emergency stop persisted');
  await page.reload();
  await expect(page.locator('.trading-foundation .tf-outcomes')).toContainText('emergency stop persisted');
  await expect(page.locator('.trading-foundation .tf-outcomes')).toContainText('4 confirmed flat');
  await page.locator('.trading-foundation').getByLabel('Risk amount', { exact: true }).fill('0.25');
  await page.locator('.trading-foundation').getByLabel('Risk amount', { exact: true }).press('Tab');
  await expect(page.locator('.trading-foundation .tf-outcomes')).toContainText('No simulated plan submitted');
  await page.reload();
  await expect(page.locator('.trading-foundation .tf-outcomes')).toContainText('No simulated plan submitted');
  await page.locator('.trading-foundation').getByRole('button', { name: 'Refresh & preview' }).click();
  await page.locator('.trading-foundation').getByLabel('Plan entry price', { exact: true }).fill('99900');
  await page.locator('.trading-foundation').getByLabel('Plan stop price', { exact: true }).fill('99000');
  await page.locator('.trading-foundation').getByLabel('Plan stop price', { exact: true }).press('Tab');
  await page.locator('.trading-foundation').getByRole('button', { name: 'Rehearse group plan' }).click();
  await page.locator('.trading-foundation').getByRole('button', { name: 'Use execution quote' }).click();
  await expect(page.locator('.trading-foundation .tf-outcomes')).toContainText('No simulated plan submitted');
  expect(await page.evaluate(() => localStorage.getItem('iq.trading.rehearsal.v1'))).toBeNull();
});

test('read-only identities stay explicit and diagnostic mode cannot connect the signing service', async ({ page }) => {
  await page.goto('/?fixture=1'); await page.locator('#trading-accounts').click();
  const panel = page.locator('.trading-foundation');
  await panel.getByText('Add named account', { exact: true }).click();
  await panel.getByLabel('Account name', { exact: true }).fill('Testnet day account');
  await panel.getByLabel('Principal or L1 owner', { exact: true }).fill(`0x${'1'.repeat(40)}`);
  await panel.getByRole('button', { name: 'Save read-only account' }).click();
  await expect(panel.locator('.tf-account-row')).toContainText('TESTNET · READ ONLY');
  await panel.getByRole('button', { name: 'Refresh & preview' }).click();
  await expect(panel.locator('.tf-allocations')).toContainText('disabled in diagnostic fixture mode');
  await expect(panel.getByRole('button', { name: 'Rehearse group plan' })).toBeDisabled();
  await panel.getByText('Testnet signing service', { exact: true }).click();
  await panel.getByRole('button', { name: 'Connect testnet service' }).click();
  await expect(panel.locator('.tf-status')).toContainText('disabled in diagnostic fixture mode');
  await expect(panel.getByRole('button', { name: 'Review testnet limit entry' })).toBeDisabled();
});

test('compact trading planner fits narrow and desktop panels with accessible labels', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 720, height: 860 });
  await page.goto('/?fixture=1'); await page.locator('#trading-accounts').click();
  const panel = page.locator('.trading-foundation');
  await panel.getByRole('button', { name: 'Load practice accounts', exact: true }).click();
  await expect(panel.getByLabel('Risk amount', { exact: true })).toHaveValue('0.5');
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'artifacts/trading-foundation/narrow.png' });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.screenshot({ path: 'artifacts/trading-foundation/desktop.png' });
});
