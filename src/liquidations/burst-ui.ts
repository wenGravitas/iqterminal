import { compactSize } from '../ticker/presentation';
import { formatCalendarDate, formatTickerTime, timezoneName, getTimezonePreference } from '../timezone';
import { liquidationBurstAveragePerSecond, liquidationBurstBackgroundWidth, liquidationBurstDurationMs, liquidationBurstHistogram, LIQUIDATION_BURST_BACKGROUND_REFERENCE_USDT, type LiquidationBurst } from './engine';
import { liquidationColour } from './colors';

export interface BurstCardParts {
  root: HTMLDivElement;
  burst?: LiquidationBurst;
  side: HTMLSpanElement;
  total: HTMLSpanElement;
  state: HTMLSpanElement;
  count: HTMLSpanElement;
  duration: HTMLSpanElement;
  average: HTMLSpanElement;
  quality: HTMLButtonElement;
  details: HTMLButtonElement;
  sizeFill: HTMLSpanElement;
  activity: HTMLDivElement;
  activityBars: HTMLSpanElement[];
  unknown: HTMLSpanElement;
  venues: Map<'bybit' | 'binance', HTMLImageElement>;
}

const label = (tag: 'span' | 'strong', className: string) => {
  const element = document.createElement(tag); element.className = className; return element;
};
function actionButton(text: string, name: string, activate: (burst: LiquidationBurst) => void, current: () => LiquidationBurst | undefined) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'liquidation-burst-action'; button.textContent = text;
  button.setAttribute('aria-label', name); button.title = name; button.addEventListener('click', () => { const burst = current(); if (burst) activate(burst); }); return button;
}

/** Stable keyed burst card, shared by pinned active rows and tape summaries. */
export function createBurstCard(kind: 'pinned' | 'tape', openDetails: (burst: LiquidationBurst) => void, openQuality: (burst: LiquidationBurst) => void): BurstCardParts {
  const root = document.createElement('div'); root.className = `liquidation-burst-card liquidation-burst-${kind}`;
  const main = document.createElement('div'); main.className = 'liquidation-burst-main';
  const side = label('span', 'liquidation-burst-side'), total = label('strong', 'liquidation-burst-total'), state = label('span', 'liquidation-burst-state');
  const current = () => parts.burst;
  const quality = actionButton('PARTIAL', 'Open burst coverage details', openQuality, current); quality.classList.add('liquidation-burst-quality');
  const details = document.createElement('button'); details.type = 'button'; details.className = 'liquidation-burst-action liquidation-burst-details';
  details.setAttribute('aria-label', 'Open burst constituents'); details.title = 'Open burst constituents';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'm5 3 5 5-5 5'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.4'); path.setAttribute('stroke-linecap', 'square'); svg.append(path); details.append(svg);
  details.addEventListener('click', () => { const burst = current(); if (burst) openDetails(burst); });
  main.append(side, total, state, quality, details);

  const metadata = document.createElement('div'); metadata.className = 'liquidation-burst-meta';
  const count = label('span', 'liquidation-burst-count'), duration = label('span', 'liquidation-burst-duration'), average = label('span', 'liquidation-burst-average');
  const venues = new Map<'bybit' | 'binance', HTMLImageElement>();
  const venueGroup = document.createElement('span'); venueGroup.className = 'liquidation-burst-venues'; venueGroup.setAttribute('aria-label', 'Contributing venues');
  for (const venue of ['bybit', 'binance'] as const) {
    const icon = document.createElement('img'); icon.className = 'liquidation-burst-venue'; icon.alt = venue === 'bybit' ? 'Bybit' : 'Binance'; icon.src = venue === 'bybit' ? '/venues/bybit.svg' : '/venues/binance.ico'; icon.dataset.venue = venue; icon.hidden = true; venues.set(venue, icon); venueGroup.append(icon);
  }
  metadata.append(count, duration, average, venueGroup);
  const sizeTrack = document.createElement('div'); sizeTrack.className = 'liquidation-burst-size-track';
  const sizeFill = document.createElement('span'); sizeFill.className = 'liquidation-burst-size-fill'; sizeTrack.append(sizeFill);
  const activityRow = document.createElement('div'); activityRow.className = 'liquidation-burst-activity-row';
  const activityLabel = label('span', 'liquidation-burst-activity-label'); activityLabel.textContent = 'SHAPE';
  const activity = document.createElement('div'); activity.className = 'liquidation-burst-activity'; activity.setAttribute('aria-label', 'Activity shape; bar heights are normalized to this burst’s own peak');
  const unknown = label('span', 'liquidation-burst-unknown'); unknown.textContent = '?'; unknown.hidden = true;
  activityRow.append(activityLabel, activity, unknown);
  root.append(main, metadata, sizeTrack, activityRow);

  const parts: BurstCardParts = { root, side, total, state, count, duration, average, quality, details, sizeFill, activity, activityBars: [], unknown, venues };
  root.dataset.kind = kind; return parts;
}

const durationText = (ms: number) => ms < 1000 ? '<1s' : `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`;
const shareText = (share: number | null) => share === null ? 'Unknown' : `${(share * 100).toFixed(1)}%`;
export const formatLiquidationExactTime = (time: number, timezone: string) => `${formatCalendarDate(time, timezone)} ${formatTickerTime(time, timezone)}`;
export function updateBurstCard(parts: BurstCardParts, burst: LiquidationBurst, light: boolean) {
  const snapshot = burst as LiquidationBurst & { state?: LiquidationBurst['state']; closedAt?: number | null; quality?: LiquidationBurst['quality']; coverageGap?: boolean; retainedEventCount?: number; histogram?: LiquidationBurst['histogram']; histogramStepMs?: number };
  const quality = snapshot.quality === 'complete' ? 'complete' : 'partial';
  const stateLabel = labelForBurst(snapshot);
  const hue = liquidationColour(burst.side, light); parts.burst = burst;
  parts.root.dataset.burstId = burst.id; parts.root.dataset.side = burst.side; parts.root.dataset.state = stateLabel.toLowerCase(); parts.root.dataset.quality = quality;
  parts.root.style.setProperty('--liquidation-burst-color', hue);
  const hasTotal = Number.isFinite(burst.notional), hasCount = Number.isFinite(burst.count);
  parts.side.textContent = burst.side === 'LONG' ? 'LONGS' : 'SHORTS'; parts.total.textContent = hasTotal ? `${compactSize(burst.notional)} USDT` : 'Unknown total'; parts.state.textContent = stateLabel;
  parts.count.textContent = hasCount ? `${burst.count} priced reports` : 'Report count unavailable'; parts.duration.textContent = durationText(liquidationBurstDurationMs(burst));
  const average = hasTotal ? liquidationBurstAveragePerSecond(burst) : null; parts.average.textContent = average === null ? 'avg —' : `avg ${compactSize(average)}/s`;
  const quietProved = quality === 'complete' && stateLabel === 'COMPLETED';
  parts.quality.textContent = quality === 'partial' ? 'PARTIAL' : quietProved ? 'OBSERVED' : 'COVERED';
  const qualityDescription = quietProved ? 'Observed-feed quiet proof complete for this interval; this is not verified unique liquidation volume'
    : quality === 'partial' ? 'Partial observed-feed coverage; empty activity intervals may be unknown, not zero' : 'Observed source coverage through the current burst; the burst remains active';
  parts.quality.setAttribute('aria-label', `Open ${quality === 'complete' ? 'observed' : 'partial'} coverage evidence for ${burst.side} burst`); parts.quality.title = qualityDescription;
  parts.details.setAttribute('aria-label', `Open ${burst.side} burst constituents`); parts.details.title = `Open ${burst.side} burst constituents`;
  for (const [venue, icon] of parts.venues) { icon.hidden = burst.venues[venue] === undefined; icon.title = venue === 'bybit' ? 'Bybit bankruptcy-price valuation' : 'Binance sampled cumulative snapshots'; }
  const width = hasTotal ? liquidationBurstBackgroundWidth(burst.notional) : 0; parts.sizeFill.style.width = `${width}%`;
  parts.root.style.setProperty('--liquidation-burst-width', `${width}%`);
  parts.sizeFill.parentElement?.setAttribute('aria-label', hasTotal ? `Burst size bar: ${width.toFixed(1)} percent of fixed ${compactSize(LIQUIDATION_BURST_BACKGROUND_REFERENCE_USDT)} USDT reference` : 'Burst size reference unavailable');
  const histogram = Array.isArray(snapshot.histogram) ? snapshot.histogram : [];
  const activityKnown = histogram.length > 0 && snapshot.histogramStepMs !== undefined;
  parts.unknown.hidden = quality === 'complete' && !snapshot.coverageGap && activityKnown;
  parts.activity.dataset.quality = activityKnown ? quality : 'unavailable';
  parts.activity.setAttribute('aria-label', activityKnown ? `Activity shape, normalized to this burst’s own peak. ${parts.unknown.hidden ? 'Observed report buckets.' : 'Partial coverage: unobserved intervals are unknown, not zero.'}` : 'Activity histogram unavailable in this batch; no bars are inferred.');
  const buckets = activityKnown ? liquidationBurstHistogram(burst) : [], peak = Math.max(0, ...buckets.map(bucket => bucket.ratePerSecond));
  while (parts.activityBars.length < histogram.length) { const bar = document.createElement('span'); bar.className = 'liquidation-burst-activity-bar'; parts.activityBars.push(bar); parts.activity.append(bar); }
  while (parts.activityBars.length > histogram.length) parts.activityBars.pop()?.remove();
  const start = histogram[0]?.from ?? burst.from, end = histogram.at(-1)?.to ?? burst.to + 1, span = Math.max(1, end - start);
  histogram.forEach((bucket, index) => {
    const bar = parts.activityBars[index]!, entry = buckets[index], left = (bucket.from - start) / span * 100, barWidth = (bucket.to - bucket.from) / span * 100;
    bar.style.left = `${left}%`; bar.style.width = `${barWidth}%`; bar.style.height = peak > 0 && entry ? `${Math.max(3, entry.ratePerSecond / peak * 100)}%` : '0%';
    bar.title = entry ? `${shareText(entry.shareOfReportedNotional)} of reported notional · ${durationText(entry.durationMs)} bucket` : 'Activity unavailable';
  });
}

function node(tag: 'div' | 'strong' | 'span' | 'small', className: string, text = '') {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function detailMetric(parent: HTMLElement, name: string, value: string, detail = '') {
  const row = node('div', 'liquidation-burst-detail-metric'); row.append(node('span', '', name), node('strong', '', value));
  if (detail) row.append(node('small', '', detail)); parent.append(row); return row;
}

/** Hover/focus evidence card for one reported burst. */
export function renderBurstHoverCard(element: HTMLElement, burst: LiquidationBurst, context: { timezone: string; paused: boolean; light: boolean }) {
  const snapshot = burst as LiquidationBurst & { state?: LiquidationBurst['state']; closedAt?: number | null; quality?: LiquidationBurst['quality']; coverageGap?: boolean; retainedEventCount?: number; histogram?: LiquidationBurst['histogram']; histogramStepMs?: number };
  const quality = snapshot.quality === 'complete' ? 'complete' : 'partial', zone = timezoneName(getTimezonePreference(), context.timezone);
  const heading = node('div', 'positioning-tooltip-heading');
  const side = node('strong', `positioning-tooltip-value ${burst.side === 'LONG' ? 'negative' : 'positive'}`, `${burst.side} liquidation burst`);
  side.style.color = liquidationColour(burst.side, context.light);
  heading.append(side, node('span', 'positioning-tooltip-muted', labelForBurst(burst)));
  const startDate = formatCalendarDate(burst.from, context.timezone), endDate = formatCalendarDate(burst.to, context.timezone);
  const exact = node('div', 'positioning-tooltip-muted positioning-tooltip-status', startDate === endDate
    ? `${startDate} · ${formatTickerTime(burst.from, context.timezone)}–${formatTickerTime(burst.to, context.timezone)} · ${zone}`
    : `${formatLiquidationExactTime(burst.from, context.timezone)}–${formatLiquidationExactTime(burst.to, context.timezone)} · ${zone}`);
  const metrics = node('div', 'liquidation-burst-detail-metrics');
  detailMetric(metrics, 'Reported notional', `${compactSize(burst.notional)} USDT`);
  detailMetric(metrics, 'Duration', durationText(liquidationBurstDurationMs(burst)), 'First to last report; quiet wait is excluded');
  const average = liquidationBurstAveragePerSecond(burst);
  detailMetric(metrics, 'Average rate', average === null ? 'Unavailable' : `${compactSize(average)} USDT/s`, average === null ? 'Spans under 1s' : 'Full-precision duration');
  detailMetric(metrics, 'Priced reports', String(burst.count));

  const venueRows = node('div', 'liquidation-burst-detail-venues');
  for (const venue of ['bybit', 'binance'] as const) {
    const amount = burst.venues[venue]; if (amount === undefined) continue;
    const share = burst.notional > 0 ? amount / burst.notional : null;
    const row = node('div', 'liquidation-burst-share-row'); row.dataset.venue = venue;
    const caption = node('span', 'liquidation-burst-share-label', venue.toUpperCase());
    const track = node('span', 'liquidation-burst-share-track'), fill = node('span', 'liquidation-burst-share-fill'); fill.style.background = liquidationColour(burst.side, context.light); fill.style.width = `${Math.max(0, Math.min(100, (share ?? 0) * 100))}%`; track.append(fill);
    row.append(caption, track, node('span', 'liquidation-burst-share-value', `${compactSize(amount)} USDT · ${shareText(share)}`)); venueRows.append(row);
  }
  const venueLabel = node('div', 'positioning-tooltip-muted positioning-tooltip-status', 'Venue bars are shares of reported notional');

  const activityLabel = node('div', 'positioning-tooltip-muted positioning-tooltip-status', 'Activity shape · own-peak normalized');
  const activity = node('div', 'liquidation-burst-detail-activity'); activity.setAttribute('role', 'img');
  activity.style.setProperty('--liquidation-burst-color', liquidationColour(burst.side, context.light));
  const rawHistogram = Array.isArray(snapshot.histogram) && snapshot.histogramStepMs !== undefined ? snapshot.histogram : [];
  const histogram = rawHistogram.length ? liquidationBurstHistogram(burst) : [], peak = Math.max(0, ...histogram.map(bucket => bucket.ratePerSecond)), start = rawHistogram[0]?.from ?? burst.from, end = rawHistogram.at(-1)?.to ?? burst.to + 1, span = Math.max(1, end - start);
  for (const bucket of histogram) {
    const bar = node('span', 'liquidation-burst-detail-activity-bar');
    bar.style.left = `${(bucket.from - start) / span * 100}%`; bar.style.width = `${(bucket.to - bucket.from) / span * 100}%`; bar.style.height = peak > 0 ? `${Math.max(3, bucket.ratePerSecond / peak * 100)}%` : '0%';
    bar.title = `${shareText(bucket.shareOfReportedNotional)} of observed reported notional`; activity.append(bar);
  }
  activity.setAttribute('aria-label', histogram.length ? `${histogram.length} time buckets; rates use bucket duration and heights are normalized to this burst’s own peak. Gaps can be unknown.` : 'Activity histogram unavailable; no bars are inferred from an older batch.');

  const coverageLine = node('div', 'positioning-tooltip-muted positioning-tooltip-status', quality === 'complete'
    ? 'Observed coverage; open the coverage button for verification, gaps and retention.'
    : 'Partial or unknown coverage; open the coverage button for verification, gaps and retention.');
  const caveats = node('div', 'liquidation-burst-detail-caveats');
  if (burst.venues.bybit !== undefined) caveats.append(node('div', 'positioning-tooltip-muted positioning-tooltip-status', 'Bybit value uses bankruptcy price.'));
  if (burst.venues.binance !== undefined) caveats.append(node('div', 'positioning-tooltip-muted positioning-tooltip-status', 'Binance uses sampled cumulative snapshots; reports can overlap.'));
  if (context.paused) caveats.append(node('div', 'positioning-tooltip-muted positioning-tooltip-status', 'Paused snapshot; display clock is frozen.'));
  element.replaceChildren(heading, exact, metrics, venueRows, venueLabel, activityLabel, activity, coverageLine, caveats); element.hidden = false;
}

function labelForBurst(burst: LiquidationBurst) {
  const snapshot = burst as LiquidationBurst & { state?: LiquidationBurst['state']; closedAt?: number | null };
  if (snapshot.state === 'completed' && snapshot.closedAt !== null) return 'COMPLETED';
  if (snapshot.closedAt === null && snapshot.state === 'active') return 'ACTIVE';
  return 'UNCERTAIN';
}
