// Shared browser actions for the product catalogue/settings path.
export async function addIndicator(panel, name) {
  await panel.getByRole('button', { name: 'Indicators', exact: true }).click();
  await panel.getByRole('button', { name: `Add ${name}`, exact: true }).click();
  await panel.locator('.indicator-picker').getByRole('button', { name: 'Done', exact: true }).click();
}
export async function footprintSettings(panel) {
  await panel.getByRole('button', { name: 'Footprint settings', exact: true }).click();
}
export async function setPriceLevel(panel, value) {
  await footprintSettings(panel); await panel.getByLabel('Price level (USDT)', { exact: true }).fill(String(value));
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
}
export async function setUnits(panel, units) {
  await footprintSettings(panel); await panel.getByLabel('Footprint volume units', { exact: true }).selectOption(units);
  await panel.locator('.footprint-settings-dialog').getByRole('button', { name: 'Apply', exact: true }).click();
}
