import { expect, test, type Browser, type Page } from '@playwright/test';
import { twoChartWorkspaceState } from './workspace-state';

test.use({ storageState: { cookies: [], origins: [] } });

async function loadFixture(page: Page) {
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
}

async function openJournal(page: Page) {
  await page.getByRole('button', { name: 'Application menu', exact: true }).click();
  await page.getByRole('dialog', { name: 'Application menu', exact: true }).getByRole('button', { name: 'Journal', exact: true }).click();
  const panel = page.locator('.global-journal-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function contextPage(browser: Browser, timezoneId: string) {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173', timezoneId, viewport: { width: 1366, height: 768 },
    storageState: twoChartWorkspaceState('http://127.0.0.1:4173'),
  });
  return { context, page: await context.newPage() };
}

test('Today follows timezone changes and local midnight without interrupting drafts or pinned dates', async ({ browser }) => {
  test.setTimeout(60_000);
  const { context, page } = await contextPage(browser, 'America/Los_Angeles');
  try {
    await page.addInitScript(() => localStorage.setItem('basis.market-pulse.timezone.v1', 'local'));
    await loadFixture(page);
    await page.clock.install({ time: new Date('2026-11-03T07:59:50Z') });
    const panel = await openJournal(page);
    const selectedDate = panel.getByLabel('Selected journal date');
    const dayLabel = panel.locator('.journal-v2-day-label');
    await expect(selectedDate).toHaveValue('2026-11-02');
    await expect(panel.locator('.journal-v2-timezone')).toHaveText('America/Los_Angeles');
    await expect(dayLabel).toContainText('Today');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      localStorage.setItem('basis.market-pulse.timezone.v1', 'UTC');
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(selectedDate).toHaveValue('2026-11-03');
    await expect(panel.locator('.journal-v2-timezone')).toHaveText('UTC');
    await page.evaluate(() => {
      localStorage.setItem('basis.market-pulse.timezone.v1', 'local');
      window.dispatchEvent(new CustomEvent('basis-market-timezone-change'));
    });
    await expect(selectedDate).toHaveValue('2026-11-02');

    await panel.locator('.journal-v2-add').click();
    const composer = panel.locator('.journal-v2-dialog');
    await composer.getByLabel('Entry body in Markdown').fill('Draft survives the date transition.');
    await page.clock.fastForward(700);
    await expect(composer.locator('.journal-v2-composer-status')).toContainText('Draft saved on this device.');
    await page.clock.fastForward(15_000);
    await expect(selectedDate).toHaveValue('2026-11-03');
    await expect(dayLabel).toContainText('Today');
    await expect(composer).toBeVisible();
    await expect(composer.getByLabel('Entry body in Markdown')).toHaveValue('Draft survives the date transition.');
    await expect(composer.locator('.journal-v2-composer-status')).toContainText('Draft saved on this device.');

    await composer.getByRole('button', { name: 'Keep as draft and close', exact: true }).click();
    await expect(composer).toBeHidden();
    await panel.getByRole('button', { name: 'Previous day', exact: true }).click();
    await expect(selectedDate).toHaveValue('2026-11-02');
    await expect(dayLabel).not.toContainText('Today');

    await page.clock.fastForward(24 * 60 * 60 * 1000 + 1000);
    await expect(selectedDate).toHaveValue('2026-11-02');
    await expect(dayLabel).not.toContainText('Today');
    expect(await page.evaluate(async () => {
      const repository = (window as any).__terminal.journal.repository;
      return { entries: (await repository.entries({ limit: 10 })).length, drafts: (await repository.drafts()).length };
    })).toEqual({ entries: 0, drafts: 1 });
  } finally { await context.close(); }
});

test('equal-time posts use explicit ID ordering and filters do not change the selected sort', async ({ browser }) => {
  test.setTimeout(60_000);
  const { context, page } = await contextPage(browser, 'UTC');
  try {
    await loadFixture(page);
    await page.clock.install({ time: new Date('2026-11-02T12:00:00Z') });
    const panel = await openJournal(page);
    const composer = panel.locator('.journal-v2-dialog');
    for (const [title, body] of [['Stable alpha', 'first post'], ['Stable beta', 'second post']] as const) {
      await panel.locator('.journal-v2-add').click();
      await composer.getByLabel('Title (optional)').fill(title);
      await composer.getByLabel('Entry body in Markdown').fill(body);
      await composer.getByRole('button', { name: 'Publish entry', exact: true }).click();
      await expect(composer).toBeHidden();
      await expect.poll(() => panel.locator('.journal-v2-post').count()).toBe(title === 'Stable alpha' ? 1 : 2);
    }

    const repositoryOrder = await page.evaluate(async () => (window as any).__terminal.journal.repository.entries({ order: 'newest', limit: 10 }).then((rows: any[]) => rows.map(row => row.id)));
    const newestPosts = await panel.locator('.journal-v2-post').evaluateAll(posts => posts.map(post => (post as HTMLElement).dataset.entryId));
    expect(newestPosts).toEqual(repositoryOrder);
    const times = await page.evaluate(async () => (window as any).__terminal.journal.repository.entries({ limit: 10 }).then((rows: any[]) => rows.map(row => row.entryAt)));
    expect(new Set(times).size).toBe(1);

    await panel.locator('.journal-v2-sort').click();
    await expect(panel.locator('.journal-v2-sort')).toHaveText('Oldest first');
    const oldestPosts = await panel.locator('.journal-v2-post').evaluateAll(posts => posts.map(post => (post as HTMLElement).dataset.entryId));
    expect(oldestPosts).toEqual([...newestPosts].reverse());
    await panel.getByLabel('Date scope').selectOption('all');
    await panel.getByLabel('Search').fill('Stable alpha');
    await expect(panel.locator('.journal-v2-post')).toHaveCount(1);
    await expect(panel.locator('.journal-v2-sort')).toHaveText('Oldest first');
    await panel.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(panel.locator('.journal-v2-post')).toHaveCount(2);
    await expect(panel.locator('.journal-v2-sort')).toHaveText('Oldest first');
    expect(await panel.locator('.journal-v2-post').evaluateAll(posts => posts.map(post => (post as HTMLElement).dataset.entryId))).toEqual(oldestPosts);
  } finally { await context.close(); }
});
