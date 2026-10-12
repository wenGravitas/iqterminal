import type { Locator } from '@playwright/test';
export async function addIndicator(panel: Locator, name: string) {
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  await panel.getByRole('button', { name: `Add ${name}`, exact: true }).click();
  await panel.locator('.indicator-picker').getByRole('button', { name: 'Done', exact: true }).click();
}
export async function setFootprint(panel: Locator, enabled: boolean) {
  const row = panel.locator('.active-indicator[data-definition-id="native.footprint"]');
  if (enabled) { if (await row.count()) { const show = row.getByRole('button', { name: 'Show Footprint', exact: true }); if (await show.count()) await show.click(); } else await addIndicator(panel, 'Footprint'); }
  else if (await row.count()) await row.getByRole('button', { name: 'Remove Footprint', exact: true }).click();
}
export async function footprintSettings(panel: Locator) { await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click(); }
export async function setPriceLevel(panel: Locator, value: string) {
  await footprintSettings(panel); await panel.getByLabel('Price level (USDT)', { exact: true }).fill(value);
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
}
export async function setUnits(panel: Locator, value: string) {
  await footprintSettings(panel); await panel.getByLabel('Footprint volume units', { exact: true }).selectOption(value);
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
}
export async function chooseChartMarket(panel: Locator, label: string) {
  await panel.getByRole('button',{name:'Chart market',exact:true}).click();
  const picker=panel.locator('.market-picker');await picker.getByRole('radio',{name:label,exact:true}).check();
  await picker.getByRole('button',{name:'Apply',exact:true}).click();
}
