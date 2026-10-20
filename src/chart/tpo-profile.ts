import type { IPrimitive, PrimitiveHost, PrimitiveRenderContext } from 'openalgo-charts';
import { DAY_MS, tpoBracketLabel, type TpoNakedLevel, type TpoSession } from '../indicators/tpo-engine';
import type { TpoIndicatorSettings } from '../indicators/tpo-settings';

/** Native canvas rendering for UTC TPO sessions and derived levels. It retains data only; all drawing uses the chart frame. */
export class TpoProfilePrimitive implements IPrimitive {
  private host?: PrimitiveHost;
  private sessions: TpoSession[] = [];
  private naked: TpoNakedLevel[] = [];
  private asOf = 0;
  private geometry: { dpr: number; plotWidth: number; plotHeight: number; visibleFrom: number; visibleTo: number; sessions: Array<{ dayStart: number; dayEnd: number; left: number; right: number; clippedLeft: number; clippedRight: number }> } = { dpr: 1, plotWidth: 0, plotHeight: 0, visibleFrom: 0, visibleTo: 0, sessions: [] };
  private settings: TpoIndicatorSettings;
  readonly stats = { draws: 0, profiles: 0, rows: 0, nakedLevels: 0, lettersDrawn: 0, blockCells: 0, silhouetteRows: 0 };

  constructor(settings: TpoIndicatorSettings) { this.settings = settings; }
  zOrder() { return 'normal' as const; }
  autoscaleInfo() { return null; }
  attached(host: PrimitiveHost) { this.host = host; }
  detached() { this.host = undefined; this.sessions = []; this.naked = []; }
  setSettings(settings: TpoIndicatorSettings) { this.settings = settings; this.host?.requestUpdate(); }
  setSnapshot(sessions: TpoSession[], naked: TpoNakedLevel[], asOf = 0) { this.sessions = sessions.slice(-100); this.naked = naked.slice(-270); this.asOf = asOf; this.host?.requestUpdate(); }
  patch(sessions: TpoSession[], naked: TpoNakedLevel[], asOf = 0) {
    const byDay = new Map(this.sessions.map(session => [session.day, session]));
    for (const session of sessions) byDay.set(session.day, session);
    this.sessions = [...byDay.values()].sort((a, b) => a.day - b.day).slice(-100);
    this.naked = naked.slice(-270); this.asOf = asOf; this.host?.requestUpdate();
  }
  diagnostics() { return { ...this.stats, sessions: this.sessions.length, levels: this.naked.length, geometry: this.geometry, settings: { ...this.settings } }; }

  draw(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext) {
    const dpr = rc.dpr, width = rc.plotWidth, height = rc.plotHeight;
    const visible = rc.timeScale.visibleRange();
    const sessionX = (day: number) => ({
      left: rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(day / 1_000)),
      right: rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat((day + DAY_MS) / 1_000)),
    });
    const yFor = (price: number) => rc.priceScale.priceToY(price);
    this.stats.profiles = 0; this.stats.rows = 0; this.stats.nakedLevels = 0; this.stats.lettersDrawn = 0; this.stats.blockCells = 0; this.stats.silhouetteRows = 0;
    const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
    this.geometry = { dpr: finite(dpr, 1), plotWidth: Math.max(0, finite(width)), plotHeight: Math.max(0, finite(height)), visibleFrom: finite(visible.from), visibleTo: finite(visible.to), sessions: [] };
    if (![dpr, width, height, visible.from, visible.to].every(Number.isFinite) || dpr <= 0 || width < 0 || height < 0) { this.stats.draws++; return; }
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    for (const session of this.sessions) {
      const x = sessionX(session.day), fromIndex = rc.dataLayer.timeToIndexFloat(session.day / 1_000), toIndex = rc.dataLayer.timeToIndexFloat((session.day + DAY_MS) / 1_000);
      if (![x.left, x.right, fromIndex, toIndex].every(Number.isFinite)) continue;
      if (toIndex < visible.from - 1 || fromIndex > visible.to + 1 || x.right < 0 || x.left > width || x.right - x.left < 5) continue;
      this.geometry.sessions.push({ dayStart: session.day, dayEnd: session.day + DAY_MS, left: x.left, right: x.right, clippedLeft: Math.max(0, x.left), clippedRight: Math.min(width, x.right) });
      if (this.settings.showProfile) {
        this.drawProfile(ctx, rc, session, x.left, x.right, yFor);
        this.stats.profiles++; this.stats.rows += session.rows.length;
      }
      this.drawProfileLevels(ctx, session, x.left, x.right, yFor);
      this.drawRange(ctx, rc, session.openingRange, this.settings.openingRangeEnabled, this.settings.openingRangeColor, this.settings.openingRangeOpacity, this.settings.openingRangeThickness, this.settings.openingRangeShade, this.settings.openingRangeExtend, this.settings.openingRangeHighVisible, this.settings.openingRangeLowVisible, this.settings.openingRangeMidpoint, this.settings.openingRangeLineStyle, yFor, x.left, x.right);
      this.drawRange(ctx, rc, this.settings.initialBalanceCompletedOnly && !session.initialBalance?.complete ? null : session.initialBalance, this.settings.initialBalanceEnabled, this.settings.initialBalanceColor, this.settings.initialBalanceOpacity, this.settings.initialBalanceThickness, this.settings.initialBalanceShade, this.settings.initialBalanceExtend, this.settings.initialBalanceHighVisible, this.settings.initialBalanceLowVisible, this.settings.initialBalanceMidpoint, this.settings.initialBalanceLineStyle, yFor, x.left, x.right);
      if (session.initialBalance?.complete && (this.settings.projectionHalf || this.settings.projectionFull)) {
        const range = session.initialBalance, span = range.high - range.low;
        const stop = this.settings.initialBalanceExtend ? x.right : rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(range.to / 1_000));
        const extensions = [...(this.settings.projectionHalf ? [.5] : []), ...(this.settings.projectionFull ? [1] : [])];
        ctx.globalAlpha = .58; ctx.strokeStyle = this.settings.initialBalanceColor; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        for (const extension of extensions) for (const price of [range.high + span * extension, range.low - span * extension]) if (price > 0 && Number.isFinite(price)) this.line(ctx, x.left, stop, yFor(price));
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    this.drawNaked(ctx, rc, sessionX, yFor);
    ctx.restore(); this.stats.draws++;
  }

  private drawProfile(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, session: TpoSession, left: number, right: number, yFor: (price: number) => number) {
    const dayWidth = right - left, maxWidth = Math.max(2, dayWidth * this.settings.profileWidthPercent / 100), maxCount = Math.max(1, ...session.rows.map(row => row.count));
    const cellWidth = maxWidth / maxCount;
    const rowHeight = Math.abs(yFor(session.rows[0]!.firstTick * session.tickSize) - yFor((session.rows[0]!.firstTick + session.rowTicks) * session.tickSize));
    const showLetters = this.settings.profileMode !== 'blocks' && rowHeight >= 10 && cellWidth >= 8;
    const showCells = cellWidth >= 3;
    const profileRight = Math.min(right, left + maxWidth);
    ctx.save(); ctx.beginPath(); ctx.rect(left, 0, Math.max(0, right - left), rc.plotHeight); ctx.clip();
    ctx.font = `${Math.max(8, Math.min(11, rowHeight - 1))}px ui-monospace, SFMono-Regular, Menlo, monospace`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const row of session.rows) {
      const low = row.firstTick * session.tickSize, high = (row.firstTick + row.rowTicks) * session.tickSize;
      const yTop = yFor(high), yBottom = yFor(low), top = Math.min(yTop, yBottom), cellHeight = Math.max(1, Math.abs(yBottom - yTop));
      if (![low, high, yTop, yBottom, top, cellHeight].every(Number.isFinite)) continue;
      if (top + cellHeight < 0 || top > rc.plotHeight) continue;
      const isPoc = Math.abs((low + high) / 2 - session.poc) < session.tickSize * row.rowTicks;
      const isValueArea = (low + high) / 2 >= session.val && (low + high) / 2 <= session.vah;
      if (this.settings.shadeValueArea && isValueArea) { ctx.globalAlpha = .11; ctx.fillStyle = this.settings.valueAreaColor; ctx.fillRect(left, top, Math.max(0, profileRight - left), cellHeight); }
      const fillOpacity = this.settings.profileOpacity / 100 * (isPoc && this.settings.highlightPoc ? 1 : .74);
      if (row.brackets.length && showLetters) {
        ctx.globalAlpha = .95;
        for (const [column, bracket] of row.brackets.entries()) {
          ctx.fillStyle = bracketColor(bracket, this.settings.theme, rc.theme.axisText);
          const cellLeft = left + column * cellWidth;
          ctx.fillText(tpoBracketLabel(bracket), cellLeft + cellWidth / 2, top + cellHeight / 2, Math.max(0, cellWidth - 1));
          this.stats.lettersDrawn++;
        }
      } else if (row.brackets.length && showCells) {
        ctx.globalAlpha = fillOpacity;
        for (const [column, bracket] of row.brackets.entries()) {
          ctx.fillStyle = isPoc && this.settings.highlightPoc ? this.settings.pocColor : bracketColor(bracket, this.settings.theme, rc.theme.axisText);
          const cellLeft = left + column * cellWidth;
          ctx.fillRect(cellLeft, top + .5, Math.max(1, cellWidth - .5), Math.max(1, cellHeight - 1));
          this.stats.blockCells++;
        }
      } else {
        const rowWidth = Math.min(dayWidth, Math.max(1, maxWidth * row.count / maxCount)), x = left;
        ctx.globalAlpha = fillOpacity; ctx.fillStyle = isPoc && this.settings.highlightPoc ? this.settings.pocColor : this.settings.profileColor;
        ctx.fillRect(x, top + .5, rowWidth, Math.max(1, cellHeight - 1));
        this.stats.silhouetteRows++;
      }
    }
    ctx.restore();
  }

  private drawProfileLevels(ctx: CanvasRenderingContext2D, session: TpoSession, left: number, right: number, yFor: (price: number) => number) {
    const profileLeft = left;
    const from = this.settings.profileLevelsExtend ? left : this.settings.showProfile ? profileLeft : left;
    const line = (visible: boolean, price: number, color: string, style: 'solid' | 'dashed' | 'dotted') => {
      if (!visible || !Number.isFinite(price)) return;
      ctx.globalAlpha = .85; ctx.strokeStyle = color; ctx.lineWidth = this.settings.levelLineThickness;
      ctx.setLineDash(dash(style)); this.line(ctx, from, right, yFor(price));
    };
    line(this.settings.pocLineVisible, session.poc, this.settings.pocColor, this.settings.pocLineStyle);
    line(this.settings.vahLineVisible, session.vah, this.settings.valueAreaColor, this.settings.vahLineStyle);
    line(this.settings.valLineVisible, session.val, this.settings.valueAreaColor, this.settings.valLineStyle);
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  private drawRange(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, range: TpoSession['openingRange'], enabled: boolean, color: string, opacity: number, thickness: number, shade: boolean, extend: boolean, highVisible: boolean, lowVisible: boolean, midpointVisible: boolean, style: 'solid' | 'dashed' | 'dotted', yFor: (price: number) => number, dayLeft: number, dayRight: number) {
    if (!enabled || !range) return;
    const startIndex = rc.dataLayer.timeToIndexFloat(range.from / 1_000), endIndex = rc.dataLayer.timeToIndexFloat(range.to / 1_000);
    const startX = rc.timeScale.indexToX(startIndex), endX = rc.timeScale.indexToX(endIndex);
    const start = Math.max(dayLeft, startX);
    const rangeEnd = Math.min(dayRight, endX);
    const lineStart = extend ? rangeEnd : start, end = extend ? dayRight : rangeEnd;
    const top = yFor(range.high), bottom = yFor(range.low);
    const midpoint = yFor(range.midpoint);
    if (![startIndex, endIndex, startX, endX, start, rangeEnd, lineStart, end, top, bottom, midpoint].every(Number.isFinite)) return;
    if (shade) { ctx.globalAlpha = opacity / 100 * .12; ctx.fillStyle = color; ctx.fillRect(start, Math.min(top, bottom), Math.max(0, rangeEnd - start), Math.abs(bottom - top)); }
    ctx.globalAlpha = opacity / 100; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, thickness); ctx.setLineDash(range.complete ? dash(style) : [3, 3]);
    if (highVisible) this.line(ctx, lineStart, end, top);
    if (lowVisible) this.line(ctx, lineStart, end, bottom);
    if (midpointVisible) this.line(ctx, lineStart, end, midpoint);
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  private drawNaked(ctx: CanvasRenderingContext2D, rc: PrimitiveRenderContext, sessionX: (day: number) => { left: number; right: number }, yFor: (price: number) => number) {
    if (!this.settings.nakedEnabled) return;
    const colors = { POC: this.settings.nakedPocColor, VAH: this.settings.nakedVahColor, VAL: this.settings.nakedValColor };
    const visibleKind: Record<TpoNakedLevel['kind'], boolean> = { POC: this.settings.nakedPoc, VAH: this.settings.nakedVah, VAL: this.settings.nakedVal };
    const style: Record<TpoNakedLevel['kind'], 'solid' | 'dashed' | 'dotted'> = { POC: this.settings.nakedPocLineStyle, VAH: this.settings.nakedVahLineStyle, VAL: this.settings.nakedValLineStyle };
    const visible = rc.timeScale.visibleRange();
    const asOf = this.asOf || this.naked.reduce((latest, level) => Math.max(latest, level.to), 0);
    const grouped = new Map<string, TpoNakedLevel[]>();
    for (const level of this.naked) {
      if (!visibleKind[level.kind] || level.originDay < asOf - this.settings.nakedDays * DAY_MS) continue;
      if (this.settings.nakedActiveOnly && level.state !== 'active') continue;
      if (level.state === 'tested' && this.settings.testedLevels === 'hide') continue;
      const key = `${level.kind}:${level.price}`;
      const levels = grouped.get(key) ?? [];
      levels.push(level); grouped.set(key, levels);
    }
    for (const levels of grouped.values()) {
      const representative = levels.reduce((latest, level) => level.originDay > latest.originDay ? level : latest);
      const intervals: Array<{ from: number; to: number; alpha: number; unknown: boolean }> = [];
      for (const level of levels) {
        const from = level.from, end = asOf;
        if (level.state === 'tested' && level.firstTouch !== null) {
          if (this.settings.testedLevels === 'show') intervals.push({ from, to: Math.min(end, level.firstTouch), alpha: .75, unknown: false });
          else {
            intervals.push({ from, to: Math.min(end, level.firstTouch), alpha: .75, unknown: false });
            intervals.push({ from: level.firstTouch, to: end, alpha: .28, unknown: false });
          }
        } else intervals.push({ from, to: end, alpha: level.state === 'unknown' ? .48 : .75, unknown: level.state === 'unknown' });
      }
      const boundaries = [...new Set(intervals.flatMap(part => [part.from, part.to]).filter(Number.isFinite))].sort((a, b) => a - b);
      const merged: Array<{ from: number; to: number; alpha: number; unknown: boolean }> = [];
      for (let i = 0; i + 1 < boundaries.length; i++) {
        const from = boundaries[i]!, to = boundaries[i + 1]!;
        const covering = intervals.filter(part => part.from < to && part.to > from);
        if (!covering.length) continue;
        const selected = covering.reduce((best, part) => part.alpha > best.alpha ? part : best);
        const previous = merged.at(-1);
        if (previous && previous.to === from && previous.alpha === selected.alpha && previous.unknown === selected.unknown) previous.to = to;
        else merged.push({ from, to, alpha: selected.alpha, unknown: selected.unknown });
      }
      const y = yFor(representative.price); if (!Number.isFinite(y) || y < -6 || y > rc.plotHeight + 6) continue;
      let visibleLine = false;
      for (const part of merged) {
        const x1 = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(part.from / 1_000));
        const x2 = rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(part.to / 1_000));
        const firstIndex = rc.dataLayer.timeToIndexFloat(part.from / 1_000), lastIndex = rc.dataLayer.timeToIndexFloat(part.to / 1_000);
        if (![x1, x2, firstIndex, lastIndex].every(Number.isFinite)) continue;
        if (x2 < 0 || x1 > rc.plotWidth || x1 > x2 || lastIndex < visible.from || firstIndex > visible.to) continue;
        ctx.globalAlpha = part.alpha; ctx.strokeStyle = colors[representative.kind]; ctx.lineWidth = this.settings.nakedLineThickness;
        ctx.setLineDash(part.unknown ? [2, 3] : dash(style[representative.kind])); this.line(ctx, x1, x2, y); ctx.setLineDash([]); visibleLine = true;
      }
      if (!visibleLine) continue;
      const age = Math.max(0, Math.floor((asOf - representative.originDay) / DAY_MS));
      const price = representative.price.toLocaleString('en-US', { maximumFractionDigits: 8 });
      const label = this.settings.nakedLabels === 'off' ? '' : this.settings.nakedLabels === 'price' ? `${representative.kind} ${price}` : this.settings.nakedLabels === 'age' ? `${representative.kind} ${age}d` : `${representative.kind} ${age}d · ${price}`;
      if (label && merged.some(part => part.to === asOf && rc.timeScale.indexToX(rc.dataLayer.timeToIndexFloat(part.to / 1_000)) > rc.plotWidth - 100)) { ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = colors[representative.kind]; ctx.fillText(label, rc.plotWidth - 4, y - 2); }
      this.stats.nakedLevels++;
    }
    ctx.globalAlpha = 1;
  }

  private line(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) { if (![x1, x2, y].every(Number.isFinite)) return; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); }
}

function dash(style: 'solid' | 'dashed' | 'dotted') { return style === 'solid' ? [] : style === 'dashed' ? [4, 3] : [1, 3]; }

function bracketColor(index: number, theme: TpoIndicatorSettings['theme'], axisText: string) {
  const rgb = /^#([da-f]{2})([da-f]{2})([da-f]{2})$/i.exec(axisText);
  const axisLuminance = rgb ? (Number.parseInt(rgb[1]!, 16) * .2126 + Number.parseInt(rgb[2]!, 16) * .7152 + Number.parseInt(rgb[3]!, 16) * .0722) / 255 : .5;
  const darkBackground = theme === 'dark' || theme === 'chart' && axisLuminance > .5;
  const palette = darkBackground
    ? ['#7fc7a4', '#87b7c9', '#9baadd', '#b9a0d0', '#d2a7ae', '#d1b087'] as const
    : ['#427d65', '#4b7486', '#586a96', '#786485', '#895f6c', '#8a6b46'] as const;
  return palette[index % palette.length]!;
}
