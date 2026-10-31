import { buildSessionSchedule, formatCountdown, MARKET_META, MARKET_ORDER, statusAt, timelineTicks, timelineWindow, type MarketId, type MarketStatus } from './market-sessions';
import { detectLocalTimezone, formatCalendarDate, formatClockTime, formatCompactZoneLabel, formatDateTime, formatZoneOffset, getDisplayTimezone, getTimezonePreference, resolveTimezone, setTimezonePreference, timezoneName, TIMEZONE_EVENT, type TimezonePreference } from './timezone';

const DAY_MS = 86_400_000;
const svgNs = 'http://www.w3.org/2000/svg';
const labelForTransition: Record<NonNullable<MarketStatus['transition']>, string> = {
  opens: 'opens', closes: 'closes', resumes: 'resumes', maintenance: 'maintenance', unknown: 'schedule unverified',
};
const transitionPriority: Record<NonNullable<MarketStatus['transition']>, number> = {
  maintenance: 0, resumes: 1, closes: 2, opens: 3, unknown: 4,
};
type Transition = NonNullable<MarketStatus['transition']>;
type NextTransition = { at: number; entries: Array<{ market: MarketId; transition: Transition }> };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, className?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(svgNs, tag);
  if (className) node.setAttribute('class', className);
  return node;
}

function zoneInstant(ms: number, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short', hourCycle: 'h23',
  }).format(ms);
}

function statusTitle(market: MarketId, status: MarketStatus, displayZone: string): string {
  const meta = MARKET_META[market];
  const lines = [`${meta.name} · ${status.reason}`, `Market zone: ${meta.zone}`, `Display zone: ${displayZone}`];
  if (status.transitionAt !== null && status.transition) {
    lines.push(`${labelForTransition[status.transition]}: ${zoneInstant(status.transitionAt, meta.zone)} (${meta.zone})`);
    lines.push(`${labelForTransition[status.transition]}: ${zoneInstant(status.transitionAt, displayZone)} (${displayZone})`);
  }
  return lines.join('\n');
}

export class MarketPulseController {
  private readonly trigger: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private readonly clockText: HTMLElement;
  private readonly clockLargeText: HTMLElement;
  private readonly clockDate: HTMLElement;
  private readonly clockOffset: HTMLElement;
  private readonly clockZone: HTMLElement;
  private readonly zoneShort: HTMLElement;
  private readonly activeText: HTMLElement;
  private readonly localButton: HTMLButtonElement;
  private readonly utcButton: HTMLButtonElement;
  private readonly statuses: HTMLElement;
  private readonly nextEventLabel: HTMLElement;
  private readonly nextEventTime: HTMLElement;
  private readonly nextEventCountdown: HTMLElement;
  private readonly nextEventPanel: HTMLElement;
  private readonly timelineLabels: HTMLElement;
  private readonly timelineTicks: HTMLElement;
  private readonly nowLabel: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly nowLine: SVGLineElement;
  private readonly statusNodes = new Map<MarketId, { row: HTMLElement; label: HTMLElement; dot: HTMLElement; state: HTMLElement; countdown: HTMLElement }>();
  private preference: TimezonePreference;
  private zone: string;
  private schedule = buildSessionSchedule(Date.now() - DAY_MS, Date.now() + 9 * DAY_MS);
  private scheduleEnd = Date.now() + 9 * DAY_MS;
  private marketStatuses = new Map<MarketId, MarketStatus>();
  private nextTransition: NextTransition | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private visible = !document.hidden;
  private disposed = false;
  private timelineStart = 0;
  private timelineEnd = 0;
  private timelineRefreshAt = 0;
  private dismissExternalPopover?: () => void;
  private readonly abort = new AbortController();

  constructor() {
    this.trigger = document.querySelector<HTMLButtonElement>('#market-pulse-trigger')!;
    this.popover = document.querySelector<HTMLElement>('#market-pulse-popover')!;
    this.clockText = this.trigger.querySelector<HTMLElement>('[data-clock]')!;
    this.activeText = this.trigger.querySelector<HTMLElement>('[data-active]')!;
    this.zoneShort = this.trigger.querySelector<HTMLElement>('[data-zone-short]')!;
    this.clockLargeText = this.popover.querySelector<HTMLElement>('[data-clock-large]')!;
    this.clockDate = this.popover.querySelector<HTMLElement>('[data-clock-date]')!;
    this.clockOffset = this.popover.querySelector<HTMLElement>('[data-clock-offset]')!;
    this.clockZone = this.popover.querySelector<HTMLElement>('[data-clock-zone]')!;
    this.localButton = this.popover.querySelector<HTMLButtonElement>('[data-timezone="local"]')!;
    this.utcButton = this.popover.querySelector<HTMLButtonElement>('[data-timezone="UTC"]')!;
    this.statuses = this.popover.querySelector<HTMLElement>('[data-market-statuses]')!;
    this.nextEventPanel = this.popover.querySelector<HTMLElement>('[data-next-event]')!;
    this.nextEventLabel = this.popover.querySelector<HTMLElement>('[data-next-event-label]')!;
    this.nextEventTime = this.popover.querySelector<HTMLElement>('[data-next-event-time]')!;
    this.nextEventCountdown = this.popover.querySelector<HTMLElement>('[data-next-event-countdown]')!;
    this.timelineLabels = this.popover.querySelector<HTMLElement>('[data-timeline-labels]')!;
    this.timelineTicks = this.popover.querySelector<HTMLElement>('[data-timeline-ticks]')!;
    this.nowLabel = this.popover.querySelector<HTMLElement>('[data-now-label]')!;
    this.svg = this.popover.querySelector<SVGSVGElement>('[data-market-timeline]')!;
    this.nowLine = this.svg.querySelector<SVGLineElement>('[data-now-line]')!;
    this.preference = getTimezonePreference();
    this.zone = getDisplayTimezone();
    this.buildStatusNodes();
    this.renderPreference();
    this.refreshSchedule(Date.now(), true);
    const options = { signal: this.abort.signal };
    this.trigger.addEventListener('click', () => this.isOpen() ? this.close(true) : this.open(), options);
    this.localButton.addEventListener('click', () => this.setPreference('local'), options);
    this.utcButton.addEventListener('click', () => this.setPreference('UTC'), options);
    this.popover.querySelector<HTMLButtonElement>('[data-close]')!.addEventListener('click', () => this.close(true), options);
    document.addEventListener('pointerdown', event => {
      if (this.isOpen() && event.target instanceof Node && !this.popover.contains(event.target) && !this.trigger.contains(event.target)) this.close(false);
    }, options);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.isOpen()) { event.preventDefault(); event.stopPropagation(); this.close(true); }
    }, { ...options, capture: true });
    document.addEventListener('visibilitychange', () => this.visibilityChanged(), options);
    window.addEventListener(TIMEZONE_EVENT, event => {
      const detail = (event as CustomEvent<{ preference?: TimezonePreference; zone?: string }>).detail;
      if (detail?.preference) this.preference = detail.preference;
      this.zone = detail?.zone ?? getDisplayTimezone();
      this.renderPreference();
      this.refreshSchedule(Date.now(), true);
      this.renderClock(Date.now());
    }, options);
    this.startTimer();
    this.updateClock(Date.now());
  }

  isOpen() { return !this.popover.hidden; }

  setExternalPopoverDismiss(dismiss: () => void) { this.dismissExternalPopover = dismiss; }

  /** Lets a sibling footer popover close Market Pulse without changing focus. */
  dismissForOtherPopup() { this.close(false); }

  private buildStatusNodes() {
    this.timelineLabels.replaceChildren();
    for (const id of MARKET_ORDER) {
      const row = el('div', 'market-pulse-status-row');
      row.dataset.market = id;
      row.setAttribute('role', 'group');
      const label = el('span', 'market-pulse-market-name'); label.textContent = MARKET_META[id].short;
      const dot = el('i', 'market-pulse-state-dot'); dot.setAttribute('aria-hidden', 'true');
      const state = el('span', 'market-pulse-state');
      const countdown = el('span', 'market-pulse-countdown');
      row.append(label, dot, state, countdown);
      this.statuses.append(row);
      this.statusNodes.set(id, { row, label, dot, state, countdown });
      const timelineLabel = el('span', 'market-pulse-timeline-label');
      timelineLabel.textContent = MARKET_META[id].short;
      this.timelineLabels.append(timelineLabel);
    }
  }

  private renderPreference() {
    this.localButton.setAttribute('aria-pressed', String(this.preference === 'local'));
    this.utcButton.setAttribute('aria-pressed', String(this.preference === 'UTC'));
    this.zoneShort.textContent = formatCompactZoneLabel(Date.now(), this.preference, this.zone);
    this.clockZone.textContent = this.zone;
    this.localButton.title = `Use detected local timezone · ${this.zone}`;
    this.trigger.setAttribute('aria-label', `Market Pulse · ${timezoneName(this.preference, this.zone)} · open session timeline`);
    this.trigger.title = `${this.activeText.textContent} · ${timezoneName(this.preference, this.zone)}`;
  }

  private setPreference(preference: TimezonePreference) {
    if (preference === this.preference) return;
    this.preference = preference;
    this.zone = resolveTimezone(preference, detectLocalTimezone());
    setTimezonePreference(preference);
    this.renderPreference();
  }

  private open() {
    this.dismissExternalPopover?.();
    this.popover.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.refreshSchedule(Date.now(), true);
    this.utcButton.focus();
  }

  private close(restoreFocus: boolean) {
    if (!this.isOpen()) return;
    this.popover.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.trigger.focus();
  }

  private visibilityChanged() {
    this.visible = !document.hidden;
    if (this.visible) {
      this.refreshSchedule(Date.now(), false);
      this.startTimer();
      this.updateClock(Date.now());
    } else {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private startTimer() {
    if (!this.visible || this.timer || this.disposed) return;
    this.timer = setInterval(() => this.updateClock(Date.now()), 1000);
  }

  private refreshSchedule(now: number, force: boolean) {
    if (force || now >= this.scheduleEnd - DAY_MS) {
      this.schedule = buildSessionSchedule(now - DAY_MS, now + 9 * DAY_MS);
      this.scheduleEnd = now + 9 * DAY_MS;
    }
    const window = timelineWindow(now, this.zone);
    this.timelineStart = window.startMs;
    this.timelineEnd = this.timelineStart + DAY_MS;
    this.timelineRefreshAt = window.nextRollMs;
    this.marketStatuses.clear();
    for (const market of MARKET_ORDER) {
      const status = statusAt(this.schedule, market, now);
      this.marketStatuses.set(market, status);
      this.renderStatus(market, status, now);
    }
    this.nextTransition = this.findNextTransition();
    this.renderTimeline(now);
    this.updateActiveLabel();
    this.renderNextTransition(now);
  }

  private findNextTransition(): NextTransition | null {
    const entries = MARKET_ORDER.flatMap(market => {
      const status = this.marketStatuses.get(market);
      return status?.transitionAt !== null && status?.transitionAt !== undefined && status.transition
        ? [{ at: status.transitionAt, market, transition: status.transition }]
        : [];
    });
    entries.sort((a, b) => a.at - b.at || transitionPriority[a.transition] - transitionPriority[b.transition]);
    const first = entries[0];
    if (!first) return null;
    return {
      at: first.at,
      entries: entries.filter(entry => entry.at === first.at)
        .sort((a, b) => transitionPriority[a.transition] - transitionPriority[b.transition] || MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market))
        .map(({ market, transition }) => ({ market, transition })),
    };
  }

  private renderNextTransition(now: number) {
    const next = this.nextTransition;
    if (!next) {
      this.nextEventPanel.dataset.state = 'unknown';
      this.nextEventLabel.textContent = 'No verified transition';
      this.nextEventTime.textContent = 'No scheduled boundary in the current calendar window';
      this.nextEventCountdown.textContent = '—';
      return;
    }
    const phrases = next.entries.map(entry => `${MARKET_META[entry.market].short} ${entry.transition === 'maintenance' ? 'maintenance starts' : labelForTransition[entry.transition]}`);
    const localTimes = next.entries.map(entry => `${MARKET_META[entry.market].short} ${zoneInstant(next.at, MARKET_META[entry.market].zone)} (${MARKET_META[entry.market].zone})`);
    const state = next.entries.some(entry => entry.transition === 'unknown') ? 'unknown'
      : next.entries.some(entry => entry.transition === 'maintenance') ? 'maintenance' : 'scheduled';
    this.nextEventPanel.dataset.state = state;
    this.nextEventLabel.textContent = phrases.join(' · ');
    this.nextEventTime.textContent = `${formatDateTime(next.at, this.zone)} ${formatZoneOffset(next.at, this.zone)} (${this.zone}) · ${localTimes.join(' · ')}`;
    this.nextEventTime.setAttribute('datetime', new Date(next.at).toISOString());
    this.nextEventTime.title = `${new Date(next.at).toISOString()} · ${this.nextEventTime.textContent}`;
    this.updateNextTransitionCountdown(now);
  }

  private updateNextTransitionCountdown(now: number) {
    if (!this.nextTransition) return;
    const countdown = formatCountdown(this.nextTransition.at, now);
    this.nextEventCountdown.textContent = this.nextTransition.entries.some(entry => entry.transition === 'unknown')
      ? `schedule unverified in ${countdown}` : `in ${countdown}`;
    this.nextEventCountdown.setAttribute('aria-label', `Countdown: ${this.nextEventCountdown.textContent}`);
  }

  private renderStatus(market: MarketId, status: MarketStatus, now: number) {
    const nodes = this.statusNodes.get(market)!;
    nodes.row.dataset.state = status.state;
    const accessibleTitle = statusTitle(market, status, this.zone);
    nodes.row.setAttribute('aria-label', accessibleTitle);
    nodes.label.title = accessibleTitle;
    nodes.dot.dataset.state = status.state;
    nodes.state.textContent = status.state === 'active' ? 'OPEN' : status.state === 'unknown' ? 'UNKNOWN' : 'CLOSED';
    nodes.countdown.textContent = this.countdownText(status, now);
    nodes.countdown.title = nodes.label.title;
  }

  private countdownText(status: MarketStatus, now: number) {
    if (status.transitionAt === null || status.transition === null) return status.transition === null && status.state === 'active' ? '24/7' : status.state === 'unknown' ? 'calendar not published' : '—';
    const countdown = formatCountdown(status.transitionAt, now);
    return status.transition === 'unknown' ? `schedule unverified in ${countdown}` : `${labelForTransition[status.transition]} in ${countdown}`;
  }

  private updateStatusText(now: number) {
    for (const market of MARKET_ORDER) {
      const status = this.marketStatuses.get(market);
      if (status) this.statusNodes.get(market)!.countdown.textContent = this.countdownText(status, now);
    }
    this.updateNextTransitionCountdown(now);
  }

  private updateActiveLabel() {
    const activeMarkets = MARKET_ORDER.filter(id => this.marketStatuses.get(id)?.state === 'active');
    const active = activeMarkets.map(id => MARKET_META[id].short);
    const unknown = MARKET_ORDER.filter(id => this.marketStatuses.get(id)?.state === 'unknown').length;
    const state = active.length ? 'active' : unknown ? 'unknown' : 'closed';
    const label = active.length ? `${active.length} OPEN` : unknown ? 'SCHEDULE ?' : 'ALL CLOSED';
    this.trigger.dataset.state = state;
    this.activeText.textContent = label;
    this.trigger.querySelector<HTMLElement>('[data-session-indicator]')!.dataset.state = state;
    const detail = `${active.length} open: ${active.join(', ') || 'none'}; ${unknown} unknown`;
    this.trigger.title = `${detail} · ${timezoneName(this.preference, this.zone)}`;
    this.trigger.setAttribute('aria-label', `Market Pulse · ${timezoneName(this.preference, this.zone)} · ${detail} · open session timeline`);
  }

  private updateClock(now: number) {
    if (this.disposed || !this.visible) return;
    if (this.nextTransition !== null && now >= this.nextTransition.at) {
      this.refreshSchedule(now, false);
    } else if (now >= this.scheduleEnd - DAY_MS) {
      this.refreshSchedule(now, true);
    } else {
      this.updateStatusText(now);
      if (now >= this.timelineRefreshAt) this.refreshTimeline(now);
    }
    this.renderClock(now);
    this.updateNowMarker(now);
  }

  private renderClock(now: number) {
    const time = formatClockTime(now, this.zone);
    if (this.clockText.textContent !== time) this.clockText.textContent = time;
    if (this.clockLargeText.textContent !== time) this.clockLargeText.textContent = time;
    this.clockDate.textContent = formatCalendarDate(now, this.zone);
    this.clockOffset.textContent = formatZoneOffset(now, this.zone);
    this.clockZone.textContent = this.zone;
    this.zoneShort.textContent = formatCompactZoneLabel(now, this.preference, this.zone);
  }

  private updateNowMarker(now: number) {
    const inside = now >= this.timelineStart && now <= this.timelineEnd;
    const x = Math.min(1000, Math.max(0, (now - this.timelineStart) / DAY_MS * 1000));
    this.nowLine.setAttribute('x1', String(x));
    this.nowLine.setAttribute('x2', String(x));
    this.nowLine.style.display = inside ? '' : 'none';
    this.nowLine.querySelector('title')!.textContent = `Now · ${zoneInstant(now, this.zone)} (${formatZoneOffset(now, this.zone)})`;
    this.nowLabel.style.left = `${Math.min(98, Math.max(2, x / 10))}%`;
    this.nowLabel.style.display = inside ? '' : 'none';
    this.nowLabel.title = `Now · ${zoneInstant(now, this.zone)} (${formatZoneOffset(now, this.zone)})`;
  }

  private renderTimeline(now: number) {
    const existing = [...this.svg.querySelectorAll('[data-dynamic]')];
    for (const node of existing) node.remove();
    const plotTop = 8, rowHeight = 14, gap = 4;
    const yFor = (index: number) => plotTop + index * (rowHeight + gap);
    for (let index = 0; index < MARKET_ORDER.length; index++) {
      const market = MARKET_ORDER[index]!;
      const y = yFor(index);
      const track = svg('rect', 'market-pulse-track');
      track.dataset.dynamic = '1'; track.setAttribute('x', '0'); track.setAttribute('y', String(y)); track.setAttribute('width', '1000'); track.setAttribute('height', String(rowHeight));
      track.setAttribute('rx', '0'); track.setAttribute('aria-hidden', 'true'); this.svg.append(track);
      for (const interval of this.schedule[market]) {
        if (interval.endMs <= this.timelineStart || interval.startMs >= this.timelineEnd) continue;
        const start = Math.max(interval.startMs, this.timelineStart), end = Math.min(interval.endMs, this.timelineEnd);
        const phase = interval.kind === 'unknown' ? 'unknown' : interval.startMs <= now && now < interval.endMs ? 'active' : interval.endMs <= now ? 'past' : 'future';
        const rect = svg('rect', `market-pulse-interval ${interval.kind} is-${phase}`);
        rect.dataset.dynamic = '1'; rect.dataset.kind = interval.kind; rect.dataset.phase = phase; rect.dataset.market = market;
        rect.setAttribute('x', String((start - this.timelineStart) / DAY_MS * 1000));
        rect.setAttribute('y', String(y + 2)); rect.setAttribute('width', String(Math.max(.8, (end - start) / DAY_MS * 1000)));
        rect.setAttribute('height', String(rowHeight - 3)); rect.setAttribute('aria-label', `${MARKET_META[market].short} ${interval.label} · ${phase}`);
        const title = svg('title');
        const titleParts = [`${MARKET_META[market].name} · ${interval.label}`, `${zoneInstant(start, MARKET_META[market].zone)} – ${zoneInstant(end, MARKET_META[market].zone)} (${MARKET_META[market].zone})`, `${zoneInstant(start, this.zone)} – ${zoneInstant(end, this.zone)} (${this.zone})`];
        if (interval.reason) titleParts.push(interval.reason);
        title.textContent = titleParts.join('\n'); rect.append(title); this.svg.append(rect);
      }
    }
    this.timelineTicks.replaceChildren();
    const ticks = [...timelineTicks(this.timelineStart, this.timelineEnd, 6), this.timelineEnd];
    for (let index = 0; index < ticks.length; index++) {
      const tick = ticks[index]!;
      const x = (tick - this.timelineStart) / DAY_MS * 1000;
      const line = svg('line', 'market-pulse-grid-line'); line.dataset.dynamic = '1';
      line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x)); line.setAttribute('y1', '6'); line.setAttribute('y2', String(yFor(MARKET_ORDER.length - 1) + rowHeight));
      this.svg.append(line);
      const label = el('time', `market-pulse-tick${index === 0 ? ' is-start' : index === ticks.length - 1 ? ' is-end' : ''}`);
      label.textContent = formatClockTime(tick, this.zone).slice(0, 5);
      label.setAttribute('datetime', new Date(tick).toISOString());
      label.title = `${zoneInstant(tick, this.zone)} (${this.zone})`;
      label.style.left = `${x / 10}%`;
      this.timelineTicks.append(label);
    }
    this.nowLine.setAttribute('y1', '6');
    this.nowLine.setAttribute('y2', String(yFor(MARKET_ORDER.length - 1) + rowHeight));
    this.svg.setAttribute('aria-label', `Twenty-four elapsed-hour market session timeline in ${this.zone}, starting ${zoneInstant(this.timelineStart, this.zone)}. Market labels and readable time ticks appear beside the plot. Hover an interval for local session times.`);
    this.svg.append(this.nowLine);
    this.updateNowMarker(now);
  }

  private refreshTimeline(now: number) {
    const window = timelineWindow(now, this.zone);
    this.timelineStart = window.startMs;
    this.timelineEnd = window.endMs;
    this.timelineRefreshAt = window.nextRollMs;
    this.renderTimeline(now);
  }

  diagnostics() { return { preference: this.preference, zone: this.zone, open: this.isOpen(), scheduleEnd: this.scheduleEnd, timelineStart: this.timelineStart, timelineRefreshAt: this.timelineRefreshAt, timerRunning: Boolean(this.timer) }; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    this.abort.abort();
    this.popover.hidden = true;
  }
}
