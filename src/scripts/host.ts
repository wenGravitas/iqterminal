import { registerIndicator, type Bar, type IndicatorApi } from 'openalgo-charts';
import { FeedClient } from '../feed/client';
import { depthSeriesNames, duration, type Candle, type DepthObservation, type DepthStatus, type Event, type Series, instrumentLabel, marketOf, supportsScriptDepth } from '../feed/protocol';
import { OpenAlgoCandleChart } from '../chart/openalgo';
import { browserScriptWorker, ScriptWorkerClient } from './client';
import { createScriptChartBridge, depthBandFor, requiresDepth } from './chart-adapter';
import { ScriptLibrary } from './library';
import { requiredScriptCapabilities } from './capabilities';
import type { ScriptBar, ScriptContext, ScriptDiagnostic, ScriptResult } from './runtime';

export const MAX_STUDIES_PER_CHART = 8;
const DESCRIPTOR_SLOT_COUNT = 9;
const descriptorSlots = new Set<number>();
let applyQueue = Promise.resolve();

export interface StudyPin {
  attachmentId: string;
  scriptId: string;
  revisionId: string;
  title: string;
  description: string;
  settings: Record<string, string | number | boolean>;
  visible: boolean;
  placement?: 'overlay' | 'pane';
}

export interface StudyView extends StudyPin {
  status: string;
  diagnostics: ScriptDiagnostic[];
  inputs: ScriptInputView[];
  outputs: Record<string, number | null>;
}

export interface DepthNotice { text: string; details: string }

export interface ScriptInputView {
  key: string;
  label: string;
  kind: string;
  defaultValue: string | number | boolean | null;
  min: number | null;
  max: number | null;
  step: number | null;
  options: (string | number | boolean)[];
  tooltip: string;
}

interface BandState {
  percent: number;
  release: (() => void) | null;
  status: DepthStatus;
  samples: Map<number, DepthObservation>;
  bucketed: Map<number, DepthObservation>;
}

interface StudyInstance extends StudyPin {
  source: string;
  descriptorId: string;
  api: IndicatorApi;
  worker: ScriptWorkerClient;
  bridge: ReturnType<typeof createScriptChartBridge>;
  depthBand: number | null;
  depthUnavailable: boolean;
  status: string;
  diagnostics: ScriptDiagnostic[];
  inputs: ScriptInputView[];
  outputs: Record<string, number | null>;
  needsHistory: boolean;
}

export interface StudyDraft {
  attachmentId?: string;
  scriptId: string;
  source: string;
  title: string;
  description: string;
  settings: Record<string, string | number | boolean>;
  visible?: boolean;
}

/** Attaches isolated study workers to one native chart and persists only revision pins. */
export class ScriptStudyHost {
  private intents = new Map<string, number>();
  private contextGeneration = 0;
  private candles: Candle[] = [];
  private series: Series;
  private visible = false;
  private dead = false;
  private restoreStarted = false;
  private contextNeedsReload = false;
  private pendingPins: StudyPin[] = [];
  private studies = new Map<string, StudyInstance>();
  private restoreErrors = new Map<string, StudyView>();
  private bands = new Map<number, BandState>();
  private listeners = new Set<() => void>();

  constructor(
    private readonly panelId: string,
    private readonly engine: OpenAlgoCandleChart,
    private readonly feed: FeedClient,
    private readonly library: ScriptLibrary,
    series: Series,
    private readonly save: (pins: StudyPin[]) => void,
  ) {
    this.series = series;
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  views(): StudyView[] {
    const active = [...this.studies.values()].map(study => ({
      attachmentId: study.attachmentId, scriptId: study.scriptId, revisionId: study.revisionId,
      title: study.title, description: study.description, settings: { ...study.settings }, visible: study.visible,
      placement: study.placement, status: study.status, diagnostics: [...study.diagnostics], inputs: [...study.inputs], outputs: { ...study.outputs },
    }));
    return [...active, ...this.restoreErrors.values()].map(view => ({ ...view, settings: { ...view.settings }, diagnostics: [...view.diagnostics], inputs: [...view.inputs], outputs: { ...view.outputs } }));
  }
  pins(): StudyPin[] { return validStudyPins([...this.pendingPins, ...[...this.studies.values()].map(study => pinOf(study)), ...[...this.restoreErrors.values()].map(pinOf)]).filter((p,i,a) => a.findIndex(v => v.attachmentId === p.attachmentId) === i); }

  depthNotices(): DepthNotice[] {
    const unsupported = !supportsScriptDepth(this.series);
    const unitsByBand = new Map<number, Set<string>>();
    let hasUnsupportedStudy = false;
    for (const study of this.studies.values()) {
      if (!study.visible) continue;
      if (study.depthUnavailable || unsupported) { hasUnsupportedStudy = true; continue; }
      if (study.depthBand === null) continue;
      const units = unitsByBand.get(study.depthBand) ?? new Set<string>();
      for (const unit of depthOutputUnits(study)) units.add(unit);
      unitsByBand.set(study.depthBand, units);
    }

    const notices: DepthNotice[] = [];
    if (hasUnsupportedStudy) {
      notices.push({
        text: 'Depth unavailable · Binance BTCUSDT USD-M Perp only · earlier candles: no depth history',
        details: `This study needs Binance BTCUSDT USD-M perpetual market depth. ${instrumentLabel(this.series)} candles do not provide that book; no historical depth is available before Binance collection starts.`,
      });
    }
    for (const [percent, units] of unitsByBand) {
      const band = this.bands.get(percent);
      const status = band?.status ?? null;
      const samples = band ? [...band.samples.values()] : [];
      const latest = samples.at(-1) ?? null;
      const latestCandle = this.candles.at(-1);
      const latestCandleHasSample = latestCandle !== undefined && band?.bucketed.has(latestCandle.t) === true;
      const unitText = [...units].sort().join(' + ') || 'source-dependent units';
      const midText = latest ? `mid ${formatDepthPrice(latest.mid)} USDT` : 'mid price pending';
      const collectionText = status?.collectionStartedAt === null || !status
        ? 'collection starts after sync'
        : `samples since ${utcTimestamp(status.collectionStartedAt)}`;
      const availability = status?.state !== 'live'
        ? `Depth ${status?.state ?? 'syncing'}${status?.message ? ` · ${status.message}` : ''}`
        : latest && (!latest.bidCovered || !latest.askCovered)
          ? `Unavailable: synchronized snapshot does not cover ${[!latest.bidCovered ? 'bid' : '', !latest.askCovered ? 'ask' : ''].filter(Boolean).join(' and ')} band; plotted values are null`
          : !latestCandleHasSample ? 'No sample in the latest candle yet; plots remain empty there' : 'Depth live';
      const context = `±${percent.toFixed(2)}% around ${midText} · outputs ${unitText} · sampled every 1s · ${collectionText} · earlier candles: no depth history`;
      notices.push({ text: `${availability} · ${context}`, details: `${availability}. Visible depth is measured within ±${percent.toFixed(2)}% of the latest Binance midpoint (${latest ? `${formatDepthPrice(latest.mid)} USDT` : 'waiting for the first midpoint'}). Output source units: ${unitText}. Binance samples once per second and assigns each sample to its enclosing candle. Collection ${status?.collectionStartedAt === null || !status ? 'has not started; it begins after the synchronized snapshot is ready' : `started ${utcTimestamp(status.collectionStartedAt)}`}. Earlier candles have no depth history; missing values remain gaps, never zero or carried forward.` });
    }
    return notices;
  }

  restore(pins: StudyPin[]) {
    this.pendingPins = validStudyPins(pins);
    this.restoreStarted = false;
    void this.restoreWhenReady();
  }

  setSeries(series: Series) {
    if (this.series.venue === series.venue && marketOf(this.series) === marketOf(series) && this.series.interval === series.interval) return;
    this.series = series; this.contextGeneration++;
    this.contextNeedsReload = true;
    for (const band of this.bands.values()) this.releaseBand(band);
    this.bands.clear();
    for (const study of this.studies.values()) {
      const needsDepth = study.depthBand !== null || study.depthUnavailable;
      study.depthBand = null;
      study.depthUnavailable = needsDepth && !supportsScriptDepth(series);
      study.status = 'reloading for the selected market';
      study.needsHistory = true;
    }
    this.notify();
  }

  setVisible(visible: boolean) {
    const wasVisible = this.visible;
    this.visible = visible;
    this.engine.visible = visible;
    if (!wasVisible && visible) {
      for (const study of this.studies.values()) {
        if (!study.needsHistory || !study.visible) continue;
        study.needsHistory = false;
        study.worker.history(this.scriptBars(study.depthBand));
      }
    }
  }

  setSnapshot(candles: Candle[]) {
    this.candles = boundedCandles(candles);
    if (this.contextNeedsReload && this.studies.size) {
      this.contextNeedsReload = false;
      void this.rebuildContext();
    } else for (const study of this.studies.values()) this.queueHistory(study);
    void this.restoreWhenReady();
  }

  applyPatch(candles: Candle[]) {
    if (this.dead || !candles.length) return;
    let requiresHistory = false;
    const changes: { kind: 'append' | 'update'; bar: Candle }[] = [];
    for (const candle of [...candles].sort((a, b) => a.t - b.t)) {
      const index = lowerBound(this.candles, candle.t);
      const exists = this.candles[index]?.t === candle.t;
      if (exists) {
        if (index !== this.candles.length - 1) requiresHistory = true;
        this.candles[index] = candle;
        changes.push({ kind: 'update', bar: candle });
      } else if (!this.candles.length || candle.t > this.candles.at(-1)!.t) {
        this.candles.push(candle);
        changes.push({ kind: 'append', bar: candle });
      } else {
        this.candles.splice(index, 0, candle);
        requiresHistory = true;
      }
    }
    if (this.candles.length > 5_000) this.candles.splice(0, this.candles.length - 5_000);
    for (const study of this.studies.values()) {
      if (!this.visible || document.hidden || !study.visible) { study.needsHistory = true; continue; }
      if (requiresHistory) study.worker.history(this.scriptBars(study.depthBand));
      else study.worker.patch(changes.map(change => ({ kind: change.kind, bar: this.scriptBar(change.bar, study.depthBand) })));
    }
  }

  async apply(draft: StudyDraft): Promise<string> {
    const id = draft.attachmentId ?? `study-${crypto.randomUUID()}`;
    const intent = (this.intents.get(id) ?? 0) + 1; this.intents.set(id, intent);
    const generation = this.contextGeneration;
    return enqueueApply(() => this.applyNow({ ...draft, attachmentId: id }, intent, generation));
  }

  async applySettings(attachmentId: string, settings: Record<string, string | number | boolean>): Promise<string> {
    const study = this.studies.get(attachmentId);
    if (!study) throw new Error('This study was removed from the chart.');
    const revision = await this.library.getRevision(study.scriptId, study.revisionId);
    if (!revision || this.studies.get(attachmentId) !== study) throw new Error('The pinned source revision is no longer available.');
    return this.apply({
      attachmentId, scriptId: study.scriptId, source: revision.source,
      title: study.title, description: study.description, settings, visible: study.visible,
    });
  }

  attachmentForInstance(instanceId: string): string | null {
    for (const study of this.studies.values()) if (study.api.id === instanceId) return study.attachmentId;
    return null;
  }

  removeNativeInstance(instanceId: string): boolean {
    const attachmentId = this.attachmentForInstance(instanceId);
    return attachmentId ? this.remove(attachmentId, false) : false;
  }

  syncNativeVisibility() {
    let changed = false;
    for (const study of this.studies.values()) {
      const visible = study.api.visible();
      if (visible === study.visible) continue;
      study.visible = visible;
      if (visible) this.queueHistory(study);
      else study.needsHistory = true;
      changed = true;
    }
    if (changed) { this.persist(); this.notify(); }
  }

  async preview(source: string, settings: Record<string, string | number | boolean>): Promise<ScriptResult> {
    return enqueueApply(async () => {
      if (this.dead) throw new Error('This chart panel is closed.');
      if (!this.candles.length) throw new Error('Wait for candle history before previewing inputs.');
      const bars = this.candles.map(candle => ({
        ...candle,
        numericSeries: Object.fromEntries(depthSeriesNames.map(name => [name, null])),
      }));
      const worker = new ScriptWorkerClient(browserScriptWorker, {
        currentBars: () => bars,
        onResult: () => undefined,
        onFailure: () => undefined,
      });
      try { return await worker.start(source, settings, bars, this.context()); }
      finally { worker.dispose(); }
    });
  }

  setVisibleStudy(attachmentId: string, visible: boolean) {
    const study = this.studies.get(attachmentId);
    if (!study) {
      const pin = this.pendingPins.find(p => p.attachmentId === attachmentId) ?? this.restoreErrors.get(attachmentId);
      if (!pin) return false;
      pin.visible = visible; this.persist(); this.notify(); return true;
    }
    study.visible = visible;
    if (study.api.visible() !== visible) study.api.setVisible(visible);
    if (visible) this.queueHistory(study);
    else study.needsHistory = true;
    this.persist();
    this.notify();
    return true;
  }

  remove(attachmentId: string, removeChartIndicator = true) {
    this.intents.set(attachmentId, (this.intents.get(attachmentId) ?? 0) + 1);
    const pending = this.pendingPins.some(pin => pin.attachmentId === attachmentId);
    this.pendingPins = this.pendingPins.filter(pin => pin.attachmentId !== attachmentId);
    const study = this.studies.get(attachmentId);
    if (!study) {
      if (!this.restoreErrors.delete(attachmentId) && !pending) return false;
      this.persist();
      this.notify();
      return true;
    }
    this.studies.delete(attachmentId);
    if (removeChartIndicator) study.api.remove({ force: true });
    study.bridge.clear();
    study.worker.dispose();
    releaseSlot(study.descriptorId);
    if (study.depthBand !== null) this.releaseDepth(study.depthBand);
    this.restoreErrors.delete(attachmentId);
    this.persist();
    this.notify();
    return true;
  }

  diagnostics() {
    return {
      context: this.context(),
      attached: this.studies.size,
      workers: [...this.studies.values()].filter(study => study.worker.alive).length,
      depthBands: [...this.bands.values()].map(band => {
        const observations = [...band.samples.values()].sort((a, b) => a.sampledAt - b.sampledAt);
        const lastCandle = this.candles.at(-1)?.t;
        const latest = observations.at(-1);
        return {
          percent: band.percent,
          status: band.status.state,
          samples: observations.length,
          firstSampleAt: observations[0]?.sampledAt ?? null,
          lastSampleAt: latest?.sampledAt ?? null,
          bidCoveredSamples: observations.filter(observation => observation.bidCovered).length,
          askCoveredSamples: observations.filter(observation => observation.askCovered).length,
          latestCandleHasSample: lastCandle !== undefined && band.bucketed.has(lastCandle),
        };
      }),
      statuses: this.views().map(study => ({ id: study.attachmentId, title: study.title, status: study.status })),
    };
  }

  dispose() {
    if (this.dead) return;
    this.dead = true; this.contextGeneration++; this.pendingPins = [];
    const studies = [...this.studies.values()];
    this.studies.clear();
    for (const study of studies) {
      study.api.remove({ force: true });
      study.bridge.clear();
      study.worker.dispose();
      releaseSlot(study.descriptorId);
    }
    this.studies.clear();
    for (const band of this.bands.values()) this.releaseBand(band);
    this.bands.clear();
    this.listeners.clear();
    this.candles = [];
  }

  private async applyNow(draft: StudyDraft, intent: number, generation: number): Promise<string> {
    const assertCurrent = () => { if (this.dead || generation !== this.contextGeneration || this.intents.get(draft.attachmentId!) !== intent) throw new Error('Apply cancelled: indicator or chart changed. Reapply to the current chart.'); };
    assertCurrent();
    if (this.dead) throw new Error('This chart panel is closed.');
    if (!this.candles.length) throw new Error('Wait for candle history before applying a study.');
    const attachmentId = draft.attachmentId ?? `study-${crypto.randomUUID()}`;
    const existing = this.studies.get(attachmentId);
    if (!existing && this.studies.size >= MAX_STUDIES_PER_CHART) throw new Error(`A chart can attach at most ${MAX_STUDIES_PER_CHART} studies.`);
    const slot = reserveSlot();
    const descriptorId = `iq-script-slot-${slot}`;
    const latest: { result?: ScriptResult; committed: boolean } = { committed: false };
    let candidateDepthBand: number | null = null;
    let candidate: ScriptWorkerClient;
    try {
      candidate = new ScriptWorkerClient(browserScriptWorker, {
        currentBars: () => this.scriptBars(candidateDepthBand),
        onResult: result => {
          latest.result = result;
          if (!latest.committed) return;
          const active = this.studies.get(attachmentId);
          if (active?.worker === candidate && active.visible) {
            active.bridge.update(result, callback => this.engine.enqueueVisible(callback));
            active.outputs = outputAtTail(result);
            const activeBand = active.depthBand === null ? null : this.bands.get(active.depthBand);
            active.status = active.depthBand === null ? 'Study ready'
              : depthStatusText(activeBand?.status ?? null, active.depthUnavailable, this.series, [...(activeBand?.samples.values() ?? [])].at(-1));
            active.diagnostics = [];
          }
        },
        onFailure: diagnostics => {
          const active = this.studies.get(attachmentId);
          if (latest.committed && active?.worker === candidate) {
            active.status = diagnostics[0]?.message ?? 'study worker stopped';
            active.diagnostics = diagnostics;
            this.notify();
          }
        },
      }, Boolean(existing));
    } catch (error) { releaseSlot(descriptorId); throw error; }

    let api: IndicatorApi | null = null;
    let bridge: ReturnType<typeof createScriptChartBridge> | null = null;
    let nextDepthBand: number | null = null;
    let depthUnavailable = false;
    try {
      const result = await candidate.start(draft.source, draft.settings, this.scriptBars(null), this.context());
      assertCurrent();
      if (!result.program) throw new Error('The script worker did not return its compiled study.');
      const needsDepth = requiresDepth(result.program, draft.settings);
      if (needsDepth) {
        nextDepthBand = depthBandFor(result, draft.settings);
        if (nextDepthBand === null) throw new Error('Depth band must be between 0.01% and 0.25% in 0.01% steps.');
        depthUnavailable = !supportsScriptDepth(this.series);
      }
      candidateDepthBand = nextDepthBand;
      const revision = await this.library.pinRevision(draft.scriptId, draft.source, requiredScriptCapabilities(result.program));
      assertCurrent();
      bridge = createScriptChartBridge(result, descriptorId, draft.settings);
      (bridge.descriptor as { name: string }).name = draft.title;
      registerIndicator(bridge.descriptor);
      api = this.engine.chart.addIndicator(descriptorId, {}, { policy: { removable: true, configurable: true, movable: true } });
      api.setVisible(draft.visible ?? existing?.visible ?? true);
      api.setPolicy({ removable: true, configurable: true });
      api.legend()?.setOptions({ visible: false });

      // Keep at least one live depth subscriber while atomically replacing an
      // attachment's band. This retains the shared book/socket and its samples.
      if (nextDepthBand !== null && !depthUnavailable) this.acquireDepth(nextDepthBand);

      if (existing) {
        this.studies.delete(attachmentId);
        existing.api.remove({ force: true });
        existing.bridge.clear();
        existing.worker.dispose();
        releaseSlot(existing.descriptorId);
        if (existing.depthBand !== null && (existing.depthBand !== nextDepthBand || depthUnavailable)) this.releaseDepth(existing.depthBand);
      }
      const instance: StudyInstance = {
        attachmentId, scriptId: draft.scriptId, revisionId: revision.id,
        title: draft.title, description: draft.description,
        settings: { ...draft.settings }, visible: draft.visible ?? existing?.visible ?? true,
        placement: bridge.descriptor.placement === 'pane' ? 'pane' : 'overlay',
        source: draft.source, descriptorId, api, worker: candidate, bridge,
        depthBand: nextDepthBand, depthUnavailable,
        status: nextDepthBand === null ? 'Study ready' : depthStatusText(
          depthUnavailable ? null : this.bands.get(nextDepthBand)?.status ?? null,
          depthUnavailable,
          this.series,
          nextDepthBand === null || depthUnavailable ? undefined : [...(this.bands.get(nextDepthBand)?.samples.values() ?? [])].at(-1),
        ), diagnostics: [], inputs: inputViews(result), outputs: outputAtTail(result), needsHistory: false,
      };
      this.studies.set(attachmentId, instance);
      latest.committed = true;
      if (instance.visible && latest.result && latest.result !== result) bridge.update(latest.result, callback => this.engine.enqueueVisible(callback));
      if (nextDepthBand !== null && !depthUnavailable) this.acquireDepth(nextDepthBand);
      if (this.visible && !document.hidden) candidate.history(this.scriptBars(nextDepthBand));
      else instance.needsHistory = true;
      candidate.promote();
      this.restoreErrors.delete(attachmentId);
      this.persist();
      this.notify();
      return attachmentId;
    } catch (error) {
      if (api && !this.studies.has(attachmentId)) api.remove({ force: true });
      bridge?.clear();
      candidate.dispose();
      releaseSlot(descriptorId);
      throw error;
    }
  }

  private async restoreWhenReady() {
    if (this.dead || this.restoreStarted || !this.pendingPins.length || !this.candles.length) return;
    this.restoreStarted = true;
    const pins = this.pendingPins;
    for (const pin of pins) {
      if (this.dead) return;
      if (this.studies.has(pin.attachmentId)) { this.pendingPins = this.pendingPins.filter(p => p.attachmentId !== pin.attachmentId); continue; }
      let intent = this.intents.get(pin.attachmentId) ?? 0;
      try {
        const revision = await this.library.getRevision(pin.scriptId, pin.revisionId);
        if (this.dead || (this.intents.get(pin.attachmentId) ?? 0) !== intent) continue;
        if (!revision) throw new Error('The pinned local script revision is missing. Reimport the script or remove this attachment.');
        const currentPin = this.pendingPins.find(p => p.attachmentId === pin.attachmentId);
        if (!currentPin) continue;
        const applying = this.apply({ ...currentPin, source: revision.source }); intent++;
        await applying;
        this.pendingPins = this.pendingPins.filter(p => p.attachmentId !== pin.attachmentId);
        this.persist();
      } catch (error) {
        if (this.dead || (this.intents.get(pin.attachmentId) ?? 0) !== intent) continue;
        this.pendingPins = this.pendingPins.filter(p => p.attachmentId !== pin.attachmentId);
        this.restoreErrors.set(pin.attachmentId, { ...pin, status: error instanceof Error ? error.message : 'Could not restore this study.', diagnostics: [], inputs: [], outputs: {} });
        this.persist(); this.notify();
      }
    }
  }

  private async rebuildContext() {
    const drafts = [...this.studies.values()].map(study => ({
      attachmentId: study.attachmentId, scriptId: study.scriptId, source: study.source,
      title: study.title, description: study.description, settings: { ...study.settings }, visible: study.visible,
    }));
    for (const draft of drafts) {
      try { await this.apply(draft); }
      catch (error) {
        const study = this.studies.get(draft.attachmentId!);
        if (study) { study.status = error instanceof Error ? error.message : 'Could not restore study on this market.'; this.notify(); }
      }
    }
  }

  private acquireDepth(percent: number) {
    const existing = this.bands.get(percent);
    if (existing) return;
    const band: BandState = {
      percent, release: null, samples: new Map(), bucketed: new Map(),
      status: { state: 'syncing', message: 'Waiting for Binance depth', lastUpdate: 0, collectionStartedAt: null },
    };
    this.bands.set(percent, band);
    band.release = this.feed.subscribeDepth(`script-depth:${this.panelId}:${percent}`, percent, event => this.depthEvent(percent, event));
  }

  private releaseDepth(percent: number) {
    if ([...this.studies.values()].some(study => study.depthBand === percent)) return;
    const band = this.bands.get(percent);
    if (!band) return;
    this.releaseBand(band);
    this.bands.delete(percent);
  }

  private releaseBand(band: BandState) { band.release?.(); band.release = null; }

  private depthEvent(percent: number, event: Event) {
    const band = this.bands.get(percent);
    if (!band || this.dead) return;
    if (event.type === 'depth-status') {
      band.status = event.status;
      const latest = [...band.samples.values()].at(-1);
      for (const study of this.studies.values()) if (study.depthBand === percent) study.status = depthStatusText(event.status, false, this.series, latest);
      this.notify();
    } else if (event.type === 'depth-history' && event.bandPercent === percent) {
      band.samples.clear();
      band.bucketed.clear();
      for (const observation of event.observations.slice(-3_600)) {
        band.samples.set(observation.sampledAt, observation);
        this.addBucketSample(band, observation);
      }
      this.depthChanged(percent, true);
    } else if (event.type === 'depth-sample' && event.observation.bandPercent === percent) {
      band.samples.set(event.observation.sampledAt, event.observation);
      this.addBucketSample(band, event.observation);
      while (band.samples.size > 3_600) band.samples.delete(Math.min(...band.samples.keys()));
      while (band.bucketed.size > 3_600) band.bucketed.delete(Math.min(...band.bucketed.keys()));
      this.depthChanged(percent, false);
    }
  }

  private depthChanged(percent: number, full: boolean) {
    const band = this.bands.get(percent);
    if (!band) return;
    const tail = this.candles.at(-1);
    for (const study of this.studies.values()) {
      if (study.depthBand !== percent) continue;
      study.status = depthStatusText(band.status, false, this.series, [...band.samples.values()].at(-1));
      if (!this.visible || document.hidden || !study.visible) { study.needsHistory = true; continue; }
      if (full) study.worker.history(this.scriptBars(percent));
      else if (tail) study.worker.patch([{ kind: 'update', bar: this.scriptBar(tail, percent) }]);
    }
    this.notify();
  }

  private scriptBars(depthBand: number | null) { return this.candles.map(candle => this.scriptBar(candle, depthBand)); }

  private scriptBar(candle: Candle, depthBand: number | null): ScriptBar {
    if (depthBand === null) return { ...candle };
    const band = this.bands.get(depthBand);
    const sample = band?.bucketed.get(candle.t) ?? null;
    return {
      ...candle,
      numericSeries: Object.fromEntries(depthSeriesNames.map((key, index) => [key, sample ? [sample.bidBase, sample.askBase, sample.bidQuote, sample.askQuote][index] ?? null : null])),
    };
  }

  private context(): ScriptContext {
    return {
      symbol: this.series.venue === 'binance' ? 'BTCUSDT' : 'BTC',
      exchange: this.series.venue === 'hyperliquid' ? 'Hyperliquid'
        : marketOf(this.series) === 'spot' ? 'Binance Spot' : 'Binance USD-M',
      interval: this.series.interval,
    };
  }

  private addBucketSample(band: BandState, observation: DepthObservation) {
    const intervalMs = duration[this.series.interval];
    const bucket = Math.floor(observation.sampledAt / intervalMs) * intervalMs;
    const previous = band.bucketed.get(bucket);
    if (!previous || observation.sampledAt > previous.sampledAt) band.bucketed.set(bucket, observation);
  }

  private queueHistory(study: StudyInstance) {
    if (!this.visible || document.hidden || !study.visible) study.needsHistory = true;
    else { study.needsHistory = false; study.worker.history(this.scriptBars(study.depthBand)); }
  }

  private persist() { this.save(this.pins()); }
  private notify() { for (const listener of this.listeners) listener(); }
}

function enqueueApply<T>(task: () => Promise<T>): Promise<T> {
  const result = applyQueue.then(task);
  applyQueue = result.then(() => undefined, () => undefined);
  return result;
}

function reserveSlot() {
  for (let slot = 0; slot < DESCRIPTOR_SLOT_COUNT; slot++) {
    if (!descriptorSlots.has(slot)) { descriptorSlots.add(slot); return slot; }
  }
  throw new Error('All bounded chart script slots are occupied. Remove a study or retry after the current apply.');
}

function releaseSlot(id: string) {
  const slot = /^iq-script-slot-(\d+)$/.exec(id);
  if (slot) descriptorSlots.delete(Number(slot[1]));
}

function pinOf(study: StudyPin): StudyPin {
  return {
    attachmentId: study.attachmentId, scriptId: study.scriptId, revisionId: study.revisionId,
    title: study.title, description: study.description, settings: { ...study.settings }, visible: study.visible,
    ...(study.placement ? { placement: study.placement } : {}),
  };
}

export function validStudyPins(value: unknown): StudyPin[] {
  if (!Array.isArray(value)) return [];
  const pins: StudyPin[] = [];
  for (const pin of value.slice(0, MAX_STUDIES_PER_CHART)) {
    if (!pin || typeof pin.attachmentId !== 'string' || pin.attachmentId.length > 100
      || typeof pin.scriptId !== 'string' || pin.scriptId.length > 120
      || typeof pin.revisionId !== 'string' || !/^[a-f0-9]{64}$/.test(pin.revisionId)
      || typeof pin.title !== 'string' || pin.title.length > 80
      || typeof pin.description !== 'string' || pin.description.length > 500
      || typeof pin.visible !== 'boolean' || !pin.settings || typeof pin.settings !== 'object' || Array.isArray(pin.settings)) continue;
    const settings: StudyPin['settings'] = {};
    for (const [key, setting] of Object.entries(pin.settings).slice(0, 16)) {
      if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)
        && (typeof setting === 'string' && setting.length <= 128 || typeof setting === 'number' && Number.isFinite(setting) || typeof setting === 'boolean')) settings[key] = setting;
    }
    pins.push({ ...pin, settings });
  }
  return pins;
}

function boundedCandles(candles: Candle[]) { return [...candles].sort((a, b) => a.t - b.t).slice(-5_000); }
function lowerBound(candles: readonly Candle[], time: number) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (candles[mid]!.t < time) lo = mid + 1; else hi = mid; }
  return lo;
}

function depthStatusText(status: DepthStatus | null, unsupported: boolean, series: Series, coverage?: DepthObservation) {
  if (unsupported || !supportsScriptDepth(series)) return 'Depth study · Binance BTCUSDT USD-M Perp only';
  if (!status) return 'Depth study · syncing Binance snapshot; no historical depth is available before collection starts';
  const collection = status.collectionStartedAt === null
    ? ' · earlier candles have no depth history; collection starts after sync'
    : ` · samples since ${utcTimestamp(status.collectionStartedAt)} · earlier candles have no depth history`;
  if (status.state === 'live' && coverage && (!coverage.bidCovered || !coverage.askCovered)) {
    const sides = [!coverage.bidCovered ? 'bid' : '', !coverage.askCovered ? 'ask' : ''].filter(Boolean).join(' and ');
    return `Depth live · ${coverage.bandPercent.toFixed(2)}% band exceeds synchronized snapshot coverage on ${sides}; values unavailable${collection}`;
  }
  return `Depth ${status.state} · ${status.message}${collection}`;
}

function depthOutputUnits(study: StudyInstance): string[] {
  const sources = study.inputs
    .filter(input => input.kind === 'source')
    .map(input => study.settings[input.key] ?? input.defaultValue)
    .filter((value): value is string => typeof value === 'string' && (depthSeriesNames as readonly string[]).includes(value));
  return [...new Set(sources.map(source => source.endsWith('_quote_v1') ? 'quote USDT' : 'base BTC'))];
}

function utcTimestamp(value: number) { return `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC`; }
function formatDepthPrice(value: number) { return value.toLocaleString('en-US', { maximumFractionDigits: 1 }); }

function outputAtTail(result: ScriptResult): Record<string, number | null> {
  const outputs: Record<string, number | null> = {};
  const plots = result.program?.outputs.plots ?? [];
  for (const plot of plots) {
    const values = result.values?.[plot.key];
    const value = values?.at(-1);
    outputs[plot.key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return outputs;
}

function inputViews(result: ScriptResult): ScriptInputView[] {
  return (result.program?.inputs ?? []).map(input => ({
    key: input.key,
    label: input.label,
    kind: input.kind,
    defaultValue: inputPrimitive(input.default),
    min: input.min,
    max: input.max,
    step: input.step,
    options: (input.options ?? []).map(option => inputPrimitive(option)).filter((value): value is string | number | boolean => value !== null),
    tooltip: input.tooltip ?? '',
  }));
}

function inputPrimitive(value: unknown): string | number | boolean | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [tag, raw] = value;
  if (tag === 'n' && typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (tag === 'b' && typeof raw === 'boolean') return raw;
  if (tag === 's' && typeof raw === 'string') return raw;
  if (tag === 'c' && Array.isArray(raw) && raw.length >= 3 && raw.slice(0, 3).every(c => typeof c === 'number' && Number.isFinite(c))) {
    return `#${raw.slice(0, 3).map(c => Math.round(c as number).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}
