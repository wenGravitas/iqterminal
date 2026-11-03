import { expect, test, type Page } from '@playwright/test';
import { selectTheme } from './footer-actions';

test.use({ storageState: { cookies: [], origins: [] } });

async function openTerminal(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?fixture=1&fixtureTime=now');
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
  await page.getByRole('button', { name: 'Application menu', exact: true }).click();
  await page.getByRole('dialog', { name: 'Application menu', exact: true }).getByRole('button', { name: 'Journal', exact: true }).click();
  const panel = page.locator('.global-journal-panel');
  await expect(panel).toBeVisible();
  return { panel, errors };
}

async function databaseCounts(page: Page) {
  return page.evaluate(async () => {
    const repository = (window as any).__terminal.journal.repository;
    return { entries: (await repository.entries({ limit: 500 })).length, drafts: (await repository.drafts()).length };
  });
}

async function journalLayout(panel: import('@playwright/test').Locator) {
  return panel.evaluate(root => {
    const selectors = ['.journal-v2-header', '.journal-v2-datebar', '.journal-v2-filters', '.journal-v2-timeline', '.journal-v2-post-content'];
    const rows = selectors.map(selector => {
      const node = root.querySelector<HTMLElement>(selector);
      return node ? { selector, width: node.clientWidth, contentWidth: node.scrollWidth } : null;
    }).filter((item): item is { selector: string; width: number; contentWidth: number } => item !== null);
    const header = root.querySelector<HTMLElement>('.journal-v2-header');
    const datebar = root.querySelector<HTMLElement>('.journal-v2-datebar');
    const filters = root.querySelector<HTMLElement>('.journal-v2-filters');
    return {
      width: root.clientWidth, contentWidth: root.scrollWidth, rows,
      children: [...root.children].map(node => ({ className: (node as HTMLElement).className, width: (node as HTMLElement).clientWidth, contentWidth: (node as HTMLElement).scrollWidth })),
      dateControls: datebar ? [...datebar.children].map(node => {
        const element = node as HTMLElement, style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return { tag: element.tagName, label: element.getAttribute('aria-label') ?? element.textContent?.trim(), width: element.clientWidth, contentWidth: element.scrollWidth, left: rect.left, right: rect.right, minWidth: style.minWidth, gridArea: style.gridArea };
      }) : [],
      headerDisplay: header ? getComputedStyle(header).display : '',
      filterColumns: filters ? getComputedStyle(filters).gridTemplateColumns.split(' ').length : 0,
    };
  });
}

test('daily feed, safe Markdown, image attachments, durable drafts, filters, and theme fit', async ({ page }) => {
  test.setTimeout(60_000);
  const { panel, errors } = await openTerminal(page);
  await selectTheme(page, 'dark');

  await panel.locator('.journal-v2-add').click();
  const dialog = panel.locator('.journal-v2-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title (optional)').fill('Evening market read');
  await dialog.getByLabel('Kind').fill('analysis');
  await dialog.getByLabel('Tags').fill('focus,btc');
  await dialog.getByLabel('Entry body in Markdown').fill('**The retest held.**\n<script>plain journal text</script>\n[unsafe](javascript:alert(1))');
  await dialog.getByRole('button', { name: 'Publish entry', exact: true }).click();
  await expect(dialog).toBeHidden();

  const post = panel.locator('.journal-v2-post');
  await expect(post).toHaveCount(1);
  await expect(post.locator('strong')).toHaveText('The retest held.');
  await expect(post.locator('script')).toHaveCount(0);
  await expect(post).toContainText('<script>plain journal text</script>');
  await expect(post).toContainText('[unsafe](javascript:alert(1))');
  await expect(post.locator('.journal-v2-post-tags')).toContainText('#focus');
  await expect(panel.locator('.journal-v2-day-label')).toContainText('Today');

  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI+kAAAAASUVORK5CYII=', 'base64');
  await panel.locator('.journal-v2-add').click();
  const imageDialog = panel.locator('.journal-v2-dialog');
  await imageDialog.getByLabel('Title (optional)').fill('Attachment draft');
  await imageDialog.getByLabel('Entry body in Markdown').fill('Local chart image:');
  await imageDialog.getByLabel('Upload journal images').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: pixel });
  await expect(imageDialog.locator('.journal-v2-attachment')).toHaveCount(1);
  await imageDialog.getByLabel('Alt text').fill('Tiny test image');
  await imageDialog.getByLabel('Caption').fill('Local attachment caption');
  await expect(imageDialog.locator('.journal-v2-composer-status')).toContainText('Draft saved on this device.');
  await page.screenshot({ path: 'artifacts/global-journal-composer-dark-desktop.png' });
  await imageDialog.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  await expect(imageDialog.locator('.journal-v2-preview')).toContainText('Local attachment caption');
  await page.screenshot({ path: 'artifacts/global-journal-preview-dark-desktop.png' });
  await imageDialog.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  await imageDialog.getByRole('button', { name: 'Keep as draft and close', exact: true }).click();
  await expect(imageDialog).toBeHidden();
  await expect(panel.locator('.journal-v2-drafts')).toContainText('Saved drafts · 1');
  await panel.locator('.journal-v2-draft-row').getByRole('button', { name: 'Resume', exact: true }).click();
  const resumed = panel.locator('.journal-v2-dialog');
  await expect(resumed.getByLabel('Title (optional)')).toHaveValue('Attachment draft');
  await expect(resumed.locator('.journal-v2-attachment')).toHaveCount(1);
  await resumed.getByRole('button', { name: 'Publish entry', exact: true }).click();
  await expect(resumed).toBeHidden();
  const posts = panel.locator('.journal-v2-post');
  await expect(posts).toHaveCount(2);
  const imagePost = posts.filter({ hasText: 'Attachment draft' });
  await expect(imagePost.locator('.journal-v2-markdown img')).toHaveAttribute('alt', 'Tiny test image');
  await expect(imagePost.locator('.journal-v2-markdown img')).toHaveAttribute('src', /^blob:/);
  await expect(imagePost.locator('.journal-md-caption')).toHaveText('Local attachment caption');

  await panel.getByLabel('Date scope').selectOption('all');
  await panel.getByLabel('Search').fill('Evening market');
  await expect(panel.locator('.journal-v2-post')).toHaveCount(1);
  const filters = panel.locator('.journal-v2-filters');
  await filters.getByLabel('Kind').fill('analysis');
  await filters.getByLabel('Tag').fill('focus');
  await expect(panel.locator('.journal-v2-post')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Clear filters', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await panel.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(panel.locator('.journal-v2-empty')).toContainText('Nothing in this day yet');
  await panel.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(panel.locator('.journal-v2-post')).toHaveCount(2);

  await page.screenshot({ path: 'artifacts/global-journal-dark-desktop.png' });
  await selectTheme(page, 'light');
  await page.getByRole('button', { name: 'Close Journal', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Application menu', exact: true }).click();
  await page.getByRole('dialog', { name: 'Application menu', exact: true }).getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(panel).toBeVisible();
  const dockLayout = await page.evaluate(() => {
    const chart = document.querySelector<HTMLElement>('.candle-panel')!.getBoundingClientRect();
    const journal = document.querySelector<HTMLElement>('.global-journal-panel')!.getBoundingClientRect();
    return { chartTop: chart.top, chartBottom: chart.bottom, chartWidth: chart.width, journalTop: journal.top, journalWidth: journal.width };
  });
  expect(dockLayout.journalWidth).toBeGreaterThanOrEqual(350);
  expect(dockLayout.journalTop).toBeGreaterThan(dockLayout.chartTop);
  const constrained = await journalLayout(panel);
  expect(constrained.width).toBeGreaterThan(0);
  expect(constrained.contentWidth, JSON.stringify(constrained)).toBeLessThanOrEqual(constrained.width + 1);
  expect(constrained.headerDisplay).toBe('grid');
  expect(constrained.filterColumns).toBeLessThanOrEqual(2);
  expect(constrained.rows).toHaveLength(5);
  expect(constrained.rows.filter(item => item.contentWidth > item.width + 1)).toEqual([]);
  await page.screenshot({ path: 'artifacts/global-journal-ivory-mobile.png' });

  await panel.locator('.journal-v2-add').click();
  const narrowComposer = panel.locator('.journal-v2-dialog');
  await narrowComposer.getByLabel('Title (optional)').fill('Narrow image draft');
  await narrowComposer.getByLabel('Entry body in Markdown').fill('A local image stays within this panel.');
  await narrowComposer.getByLabel('Upload journal images').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: pixel });
  await expect(narrowComposer.locator('.journal-v2-composer-status')).toContainText('Draft saved on this device.');
  const composerLayout = await panel.evaluate(root => {
    const dialog = root.querySelector<HTMLElement>('.journal-v2-dialog');
    const fields = root.querySelector<HTMLElement>('.journal-v2-composer-fields');
    const attachments = root.querySelector<HTMLElement>('.journal-v2-attachments');
    return [dialog, fields, attachments].filter((node): node is HTMLElement => Boolean(node)).map(node => ({
      className: node.className, width: node.clientWidth, contentWidth: node.scrollWidth,
    }));
  });
  expect(composerLayout).toHaveLength(3);
  expect(composerLayout.filter(item => item.contentWidth > item.width + 1)).toEqual([]);
  await page.screenshot({ path: 'artifacts/global-journal-composer-ivory-390.png' });
  await narrowComposer.getByRole('button', { name: 'Keep as draft and close', exact: true }).click();
  expect(errors).toEqual([]);
});

test('Copy chart image performs no journal write; Add to Journal stays a draft across workspace switch and reload', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    (window as any).__journalWriteTransactions = 0;
    const transaction = IDBDatabase.prototype.transaction;
    (IDBDatabase.prototype as any).transaction = function (stores: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      if (this.name === 'iqterminal-journal-v1' && mode === 'readwrite') (window as any).__journalWriteTransactions++;
      return (transaction as any).call(this, stores, mode, options);
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async () => {} } });
  });
  const { panel } = await openTerminal(page);
  const chart = page.locator('.candle-panel').first();
  const camera = chart.getByRole('button', { name: 'Camera actions', exact: true });
  await selectTheme(page, 'dark');
  await camera.click();
  await expect(page.getByRole('menu', { name: 'Chart image actions', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/global-journal-camera-dark-desktop.png' });
  const beforeCopy = await page.evaluate(() => (window as any).__journalWriteTransactions);
  await page.getByRole('menuitem', { name: 'Copy chart image', exact: true }).click();
  await expect(page.locator('.journal-toast')).toContainText('copied to the clipboard');
  expect(await page.evaluate(() => (window as any).__journalWriteTransactions)).toBe(beforeCopy);
  expect(await databaseCounts(page)).toEqual({ entries: 0, drafts: 0 });

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { write: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } },
  }));
  const fallbackDownload = page.waitForEvent('download');
  await camera.click();
  await page.getByRole('menuitem', { name: 'Copy chart image', exact: true }).click();
  expect((await fallbackDownload).suggestedFilename()).toBe('iqterminal-chart.png');
  await expect(page.locator('.journal-toast')).toContainText('Clipboard copy failed');
  expect(await page.evaluate(() => (window as any).__journalWriteTransactions)).toBe(beforeCopy);
  expect(await databaseCounts(page)).toEqual({ entries: 0, drafts: 0 });

  const directDownload = page.waitForEvent('download');
  await camera.click();
  await page.getByRole('menuitem', { name: 'Download PNG', exact: true }).click();
  expect((await directDownload).suggestedFilename()).toBe('iqterminal-chart.png');
  await expect(page.locator('.journal-toast')).toContainText('PNG download started.');
  expect(await page.evaluate(() => (window as any).__journalWriteTransactions)).toBe(beforeCopy);
  expect(await databaseCounts(page)).toEqual({ entries: 0, drafts: 0 });

  await camera.click();
  await page.getByRole('menuitem', { name: 'Add to journal…', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Chart image capture status', exact: true });
  await warning.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
  if (await warning.isVisible()) await warning.getByRole('button', { name: 'Continue with warnings', exact: true }).click();
  await expect.poll(async () => (await databaseCounts(page)).drafts).toBe(1);
  await expect.poll(async () => (await databaseCounts(page)).entries).toBe(0);
  const journal = page.locator('.global-journal-panel');
  const composer = journal.locator('.journal-v2-dialog');
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel('Entry body in Markdown')).toHaveValue(/attachment:/);
  await composer.getByRole('button', { name: 'Keep as draft and close', exact: true }).click();
  await expect(journal.locator('.journal-v2-drafts')).toContainText('Saved drafts · 1');

  await page.getByRole('button', { name: /^Workspace:/ }).click();
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  const workspaceForm = page.getByRole('dialog', { name: 'Workspace details', exact: true });
  await workspaceForm.getByLabel('Workspace name', { exact: true }).fill('Journal detour');
  await workspaceForm.getByRole('button', { name: 'Create Workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Workspace: Journal detour', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Workspace:/ }).click();
  await page.getByRole('dialog', { name: 'Workspaces', exact: true }).getByRole('button', { name: 'Main Workspace', exact: true }).click();
  await expect(page.locator('.global-journal-panel')).toBeVisible();
  await expect(page.locator('.journal-v2-drafts')).toContainText('Saved drafts · 1');
  await page.getByRole('button', { name: /^Workspace:/ }).click();
  await page.getByRole('button', { name: 'Actions for Journal detour', exact: true }).click();
  page.once('dialog', dialog => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Workspace: Main Workspace', exact: true })).toBeVisible();
  await expect(page.locator('.global-journal-panel')).toBeVisible();
  await expect(page.locator('.journal-v2-drafts')).toContainText('Saved drafts · 1');

  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__terminal?.workspaces?.active.name)).toBe('Main Workspace');
  await expect(page.locator('.global-journal-panel')).toBeVisible();
  await expect(page.locator('.journal-v2-drafts')).toContainText('Saved drafts · 1');
  const journalAfterReload = page.locator('.global-journal-panel');
  const savedDraftId = await page.evaluate(async () => (window as any).__terminal.journal.repository.drafts().then((drafts: any[]) => drafts[0]?.id));
  expect(savedDraftId).toBeTruthy();
  await journalAfterReload.locator('.journal-v2-draft-row').getByRole('button', { name: 'Resume', exact: true }).click();
  const recovered = journalAfterReload.locator('.journal-v2-dialog');
  await expect(recovered).toBeVisible();
  await recovered.getByLabel('Title (optional)').fill('Published chart note');
  await recovered.getByRole('button', { name: 'Publish entry', exact: true }).click();
  await expect.poll(async () => databaseCounts(page)).toEqual({ entries: 1, drafts: 0 });
  const published = await page.evaluate(async () => (window as any).__terminal.journal.repository.entries({ limit: 10 }));
  expect(published).toHaveLength(1);
  expect(published[0].attachments[0].kind).toBe('chart-capture');
  const duplicate = await page.evaluate(async ({ draftId, entry }: { draftId: string; entry: any }) => {
    const repository = (window as any).__terminal.journal.repository;
    const assetIds = [...new Set<string>(entry.attachments.flatMap((attachment: any) => [attachment.assetId, attachment.thumbnailAssetId].filter((id: unknown): id is string => typeof id === 'string')))];
    const assets = await Promise.all(assetIds.map((id: string) => repository.asset(id)));
    return repository.publishDraft(draftId, entry, assets);
  }, { draftId: savedDraftId, entry: published[0] });
  expect(duplicate.status).toBe('duplicate');
  expect(await databaseCounts(page)).toEqual({ entries: 1, drafts: 0 });

  await journalAfterReload.getByLabel('Date scope').selectOption('all');
  const instrument = journalAfterReload.getByLabel('Chart instrument');
  await expect.poll(() => instrument.locator('option').count()).toBeGreaterThan(1);
  const instrumentValue = await instrument.locator('option').nth(1).getAttribute('value');
  await instrument.selectOption(instrumentValue!);
  await expect(journalAfterReload.locator('.journal-v2-post')).toHaveCount(1);

  await selectTheme(page, 'light');
  await page.getByRole('button', { name: 'Close Journal', exact: true }).click();
  await expect(page.locator('.global-journal-panel')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Application menu', exact: true }).click();
  await page.getByRole('dialog', { name: 'Application menu', exact: true }).getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(page.locator('.global-journal-panel')).toBeVisible();
  const narrowCamera = page.locator('.candle-panel').first().getByRole('button', { name: 'Camera actions', exact: true });
  await narrowCamera.click();
  const narrowMenu = page.getByRole('menu', { name: 'Chart image actions', exact: true });
  await expect(narrowMenu).toBeVisible();
  const menuBox = await narrowMenu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: 'artifacts/global-journal-camera-ivory-390.png' });
});

test('a concurrent edit keeps the newer entry and recovers stale editor work as a separate draft', async ({ page }) => {
  test.setTimeout(90_000);
  const { panel } = await openTerminal(page);
  await panel.locator('.journal-v2-add').click();
  let composer = panel.locator('.journal-v2-dialog');
  await composer.getByLabel('Title (optional)').fill('Shared edit target');
  await composer.getByLabel('Entry body in Markdown').fill('Original text.');
  await composer.getByRole('button', { name: 'Publish entry', exact: true }).click();
  await expect(composer).toBeHidden();
  await expect(panel.locator('.journal-v2-post')).toHaveCount(1);
  const original = await page.evaluate(async () => (window as any).__terminal.journal.repository.entries({ limit: 10 }).then((rows: any[]) => rows[0]));

  const peer = await page.context().newPage();
  try {
    await peer.goto('/?fixture=1&fixtureTime=now');
    await expect.poll(() => peer.evaluate(() => (window as any).__terminal?.stats().panels[0]?.bars)).toBe(5000);
    await peer.getByRole('button', { name: 'Application menu', exact: true }).click();
    await peer.getByRole('dialog', { name: 'Application menu', exact: true }).getByRole('button', { name: 'Journal', exact: true }).click();
    const peerPanel = peer.locator('.global-journal-panel');
    await expect(peerPanel.locator('.journal-v2-post')).toContainText('Shared edit target');

    await panel.locator('.journal-v2-post').getByRole('button', { name: 'Edit Shared edit target', exact: true }).click();
    await peerPanel.locator('.journal-v2-post').getByRole('button', { name: 'Edit Shared edit target', exact: true }).click();
    composer = panel.locator('.journal-v2-dialog');
    const peerComposer = peerPanel.locator('.journal-v2-dialog');
    await composer.getByLabel('Entry body in Markdown').fill('Tab A keeps this work.');
    await peerComposer.getByLabel('Entry body in Markdown').fill('Tab B published first.');
    await expect(composer.locator('.journal-v2-composer-status')).toContainText('Draft saved on this device.');
    await expect(peerComposer.locator('.journal-v2-composer-status')).toContainText('Draft saved on this device.');

    await peerComposer.getByRole('button', { name: 'Publish entry', exact: true }).click();
    await expect(peerComposer).toBeHidden();
    await expect.poll(async () => page.evaluate(async (entryId: string) => (window as any).__terminal.journal.repository.entry(entryId).then((entry: any) => entry?.bodyMarkdown), original.id)).toBe('Tab B published first.');

    await composer.getByRole('button', { name: 'Publish entry', exact: true }).click();
    await expect(composer.locator('.journal-v2-composer-status')).toContainText('separate recovery draft');
    const afterConflict = await page.evaluate(async (entryId: string) => {
      const repository = (window as any).__terminal.journal.repository;
      const entry = await repository.entry(entryId);
      const drafts = await repository.drafts();
      return { entry, drafts };
    }, original.id);
    expect(afterConflict.entry.bodyMarkdown).toBe('Tab B published first.');
    expect(afterConflict.entry.createdAt).toBe(original.createdAt);
    expect(afterConflict.entry.revisions).toHaveLength(2);
    expect(afterConflict.drafts).toHaveLength(1);
    expect(afterConflict.drafts[0].bodyMarkdown).toBe('Tab A keeps this work.');
    expect(afterConflict.drafts[0].editingEntryId).toBeUndefined();

    await composer.getByRole('button', { name: 'Keep as draft and close', exact: true }).click();
    await expect(composer).toBeHidden();
    await expect(panel.locator('.journal-v2-drafts')).toContainText('Saved drafts · 1');
    await panel.locator('.journal-v2-draft-row').getByRole('button', { name: 'Resume', exact: true }).click();
    composer = panel.locator('.journal-v2-dialog');
    await expect(composer.getByLabel('Entry body in Markdown')).toHaveValue('Tab A keeps this work.');
    await composer.getByRole('button', { name: 'Publish entry', exact: true }).click();
    await expect.poll(async () => page.evaluate(async () => (window as any).__terminal.journal.repository.entries({ limit: 10 }).then((rows: any[]) => rows.length))).toBe(2);
    const finalEntries = await page.evaluate(async () => (window as any).__terminal.journal.repository.entries({ order: 'oldest', limit: 10 }));
    expect(new Set(finalEntries.map((entry: any) => entry.bodyMarkdown))).toEqual(new Set(['Tab B published first.', 'Tab A keeps this work.']));
    expect(finalEntries.map((entry: any) => entry.id)).toEqual([...finalEntries].sort((a: any, b: any) => a.entryAt - b.entryAt || a.id.localeCompare(b.id)).map((entry: any) => entry.id));
  } finally { await peer.close(); }
});
