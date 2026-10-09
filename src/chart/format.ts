const priceFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const labels = new Map<number, string>();
const LABEL_LIMIT = 512;

export function formatPrice(value: number) {
  if (!Number.isFinite(value) || Object.is(value, -0)) return priceFormat.format(value);
  const cached = labels.get(value);
  if (cached !== undefined) return cached;
  const formatted = priceFormat.format(value);
  if (labels.size === LABEL_LIMIT) labels.delete(labels.keys().next().value!);
  labels.set(value, formatted);
  return formatted;
}
