import {
  addCompositionMember,
  compositionPaneId,
  DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT,
  makeCompositionPane,
  MAX_COMPOSITION_MEMBERS,
  MAX_COMPOSITION_PANES,
  MAX_EMBEDDED_BAND_HEIGHT_PERCENT,
  MIN_EMBEDDED_BAND_HEIGHT_PERCENT,
  PRICE_PANE_ID,
  removeCompositionMember,
  validateComposition,
  type NumericOutputDescriptor,
  type IndicatorCompositionState,
} from '../scripts/composition';
import type { PriceScaleId } from 'openalgo-charts';

export interface SmaPlacementPlan {
  placement: 'overlay' | 'pane';
  paneId: string;
  plotScaleIds: { p0: PriceScaleId };
  composition: IndicatorCompositionState;
}

export interface SmaPlacementRequest {
  instanceId: string;
  source: Pick<NumericOutputDescriptor, 'instanceId' | 'scaleId'>;
  sourcePlacement: 'overlay' | 'pane';
  sourcePaneId?: string;
  sourceTitle: string;
  sourceIsVolume: boolean;
  existing?: { placement: 'overlay' | 'pane'; paneId?: string; plotScaleIds?: Record<string, PriceScaleId> };
  changeScale?: boolean;
}

export interface ManagedMemberRegistration {
  instanceId: string;
  title: string;
  placement: 'overlay' | 'pane';
  paneId?: string;
  bandSourceId?: string;
}

export interface ManagedCompositionPlacementSubject {
  instanceId: string;
  title: string;
  kind: 'script' | 'native';
  placement: 'overlay' | 'pane';
  paneId?: string;
  /** Only the native CVD/Open Interest adapters may be explicitly adopted from an opaque legacy pane. */
  adoptablePane?: boolean;
  paneIndex(): number;
  moveTo(placement: 'overlay' | 'pane', paneId: string, paneIndex: number, silent: boolean): boolean;
}

export interface ManagedCompositionPane {
  element: object;
}

export interface ManagedCompositionPlacementChart {
  panes(): readonly ManagedCompositionPane[];
  primaryPaneIndex(): number;
  paneWeight?(index: number): number;
  paneCollapsed?(index: number): boolean;
  indicators(): readonly { paneIndex: number }[];
  removePane(index: number, options?: { force?: boolean }): boolean | void;
}

export interface CompositionPlacementSnapshot {
  id: string;
  memberIds: string[];
  element: object;
}

export interface ManagedPaneResolutionDiagnostic {
  paneId: string;
  exceptInstanceId?: string;
  memberIds: string[];
  paneIndex: number;
  chartPaneCount: number;
}

export interface ManagedCompositionPlacementOptions {
  chart: ManagedCompositionPlacementChart;
  getComposition(): IndicatorCompositionState;
  getSubjects(): readonly ManagedCompositionPlacementSubject[];
  setApplying(value: boolean): void;
  /** Apply the fully built config once; if scripts moved, persist via the host transaction. */
  commit(state: IndicatorCompositionState, placements: readonly { instanceId: string; placement: 'overlay' | 'pane'; paneId: string }[], scriptMoves: boolean): void;
  hasProtectedPaneContent?(paneIndex: number): boolean;
  makePaneId?(seed: string): string;
  reportError(message: string): void;
  clearError(): void;
}

/** Owns the state and chart transaction for moving managed script/SMA outputs. */
export class ManagedCompositionPlacementController {
  private busy = false;
  private readonly paneResolutionHistory: ManagedPaneResolutionDiagnostic[] = [];

  constructor(private readonly options: ManagedCompositionPlacementOptions) {}

  /** Resolve a logical managed pane to the current Dockview pane that owns one of its members. */
  resolveManagedPaneIndex(paneId: string, exceptInstanceId?: string): number {
    const chartPanes = this.options.chart.panes();
    const state = this.options.getComposition();
    const managedPane = state.panes.find(pane => pane.id === paneId);
    const subjects = new Map(this.options.getSubjects().map(subject => [subject.instanceId, subject]));
    const orderedIds = [
      ...(managedPane?.memberIds ?? []),
      ...[...subjects.values()].filter(subject => subject.paneId === paneId).map(subject => subject.instanceId),
    ];
    const seen = new Set<string>();
    let paneIndex = paneId === PRICE_PANE_ID ? this.options.chart.primaryPaneIndex() : -1;
    for (const instanceId of orderedIds) {
      if (paneIndex >= 0) break;
      if (instanceId === exceptInstanceId || seen.has(instanceId)) continue;
      seen.add(instanceId);
      const subject = subjects.get(instanceId);
      const liveIndex = subject?.paneIndex() ?? -1;
      if (liveIndex >= 0 && liveIndex < chartPanes.length && chartPanes[liveIndex]) paneIndex = liveIndex;
    }
    this.paneResolutionHistory.push({ paneId, ...(exceptInstanceId ? { exceptInstanceId } : {}),
      memberIds: [...new Set(orderedIds)].slice(0, MAX_COMPOSITION_MEMBERS), paneIndex, chartPaneCount: chartPanes.length });
    if (this.paneResolutionHistory.length > 64) this.paneResolutionHistory.splice(0, this.paneResolutionHistory.length - 64);
    return paneIndex;
  }

  paneResolutionDiagnostics() { return this.paneResolutionHistory.map(item => ({ ...item, memberIds: [...item.memberIds] })); }

  /** Resolve a new or edited SMA's latest placement and scale presentation. */
  planSma(request: SmaPlacementRequest, state = this.options.getComposition()): SmaPlacementPlan {
    const existingPlot = request.existing && state.plots.find(plot => plot.producerInstanceId === request.instanceId && plot.outputKey === 'p0');
    const paneId = request.existing
      ? existingPlot?.paneId ?? request.existing.paneId ?? (request.existing.placement === 'overlay' ? PRICE_PANE_ID : compositionPaneId(request.instanceId))
      : request.sourcePlacement === 'pane' ? (request.sourcePaneId ?? compositionPaneId(request.source.instanceId)) : PRICE_PANE_ID;
    const placement = paneId === PRICE_PANE_ID ? 'overlay' : 'pane';
    const retainedScale = request.existing?.plotScaleIds?.p0;
    const plotScaleIds = { p0: request.existing && !request.changeScale && retainedScale ? retainedScale : request.source.scaleId };
    let composition = state;

    if (!request.existing && placement === 'pane') {
      composition = this.registerSourcePane(composition, paneId, request.sourceTitle, request.source.instanceId);
      const allowed = [...this.options.getSubjects().map(subject => subject.instanceId), request.instanceId];
      composition = addCompositionMember(composition, paneId, request.sourceTitle, request.instanceId, allowed);
    } else if (!request.existing && request.sourceIsVolume) {
      composition = this.registerBandMember(composition, { instanceId: request.instanceId, title: request.sourceTitle,
        placement, bandSourceId: request.source.instanceId }, true);
    }
    return { placement, paneId, plotScaleIds, composition };
  }

  /** Adopt an explicitly selected legacy native source pane without changing its live geometry/order. */
  private registerSourcePane(state: IndicatorCompositionState, paneId: string, title: string, instanceId: string) {
    const subjects=this.options.getSubjects(),allowed=[...subjects.map(subject=>subject.instanceId),instanceId];
    if(state.panes.some(pane=>pane.id===paneId))return addCompositionMember(state,paneId,title,instanceId,allowed);
    const subject=subjects.find(candidate=>candidate.instanceId===instanceId);
    const paneIndex=subject?.paneIndex()??-1;
    const legacy=state.opaqueLegacyPanes.find(pane=>pane.ownerInstanceId===instanceId||pane.id===paneId);
    const pane=makeCompositionPane(paneId,title,[instanceId],legacy?.order??state.panes.length,
      paneIndex>=0?this.options.chart.paneWeight?.(paneIndex)??1:1);
    pane.collapsed=paneIndex>=0?this.options.chart.paneCollapsed?.(paneIndex)??false:false;
    return validateComposition({ ...state, panes:[...state.panes,pane],
      opaqueLegacyPanes:state.opaqueLegacyPanes.filter(item=>item.ownerInstanceId!==instanceId&&item.id!==paneId) },allowed);
  }

  /** Register an attached provider or duplicate into its existing managed pane/band. */
  registerMember(state: IndicatorCompositionState, registration: ManagedMemberRegistration): IndicatorCompositionState {
    let next = state;
    if (registration.placement === 'pane' && registration.paneId && registration.paneId !== PRICE_PANE_ID) {
      const allowed = [...this.options.getSubjects().map(subject => subject.instanceId), registration.instanceId];
      next = addCompositionMember(next, registration.paneId, registration.title, registration.instanceId, allowed);
    }
    if (registration.bandSourceId) next = this.registerBandMember(next, registration);
    return next;
  }

  private registerBandMember(state: IndicatorCompositionState, registration: ManagedMemberRegistration, createWithSource = false): IndicatorCompositionState {
    const sourceBand = registration.bandSourceId
      ? state.embeddedBands.find(band => band.memberIds.includes(registration.bandSourceId!)) : undefined;
    if (!sourceBand) {
      if (!createWithSource || !registration.bandSourceId) return state;
      return { ...state, embeddedBands: [...state.embeddedBands, { id: `band:${registration.bandSourceId}`,
        title: registration.title, memberIds: [registration.bandSourceId, registration.instanceId], heightPercent: DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT }] };
    }
    if (sourceBand.memberIds.includes(registration.instanceId)) return state;
    return { ...state, embeddedBands: state.embeddedBands.map(band => band.id === sourceBand.id
      ? { ...band, memberIds: [...band.memberIds, registration.instanceId].slice(0, MAX_COMPOSITION_MEMBERS) } : band) };
  }

  captureManagedPane(paneId: string): CompositionPlacementSnapshot | null {
    const pane = this.options.getComposition().panes.find(candidate => candidate.id === paneId);
    if (!pane) return null;
    const subjects = new Map(this.options.getSubjects().map(subject => [subject.instanceId, subject]));
    const representative = pane.memberIds.map(id => subjects.get(id)).find(Boolean);
    const paneIndex = representative?.paneIndex() ?? -1;
    const element = paneIndex >= 0 ? this.options.chart.panes()[paneIndex]?.element : undefined;
    return element ? { id: pane.id, memberIds: [...pane.memberIds], element } : null;
  }

  cleanupManagedPane(snapshot: CompositionPlacementSnapshot | null) {
    if (snapshot) this.removeEmptyPane(snapshot.element);
  }

  /** Remove a detached native pane only when no study, object, drawing or managed member still uses it. */
  cleanupPaneIfUnshared(element: object) {
    this.removeEmptyPane(element);
  }

  move(instanceId: string, targetId: string, moveTogether: boolean,
    heightPercent = DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT, keepLowerBottomBand = false): boolean {
    if (this.busy) return this.fail('Another composition move is still being applied.');
    this.busy = true;
    this.options.setApplying(true);
    try {
      return this.moveTransaction(instanceId, targetId, moveTogether, heightPercent, keepLowerBottomBand);
    } finally {
      this.options.setApplying(false);
      this.busy = false;
    }
  }

  private moveTransaction(instanceId: string, targetId: string, moveTogether: boolean, heightPercent: number, keepLowerBottomBand: boolean) {
    const chart = this.options.chart;
    const state = this.options.getComposition();
    const subjects = new Map(this.options.getSubjects().map(subject => [subject.instanceId, subject]));
    const selected = subjects.get(instanceId);
    if (!selected) return this.fail('Could not move this study; its managed study handle is unavailable.');

    const sourcePaneId = selected.paneId ?? PRICE_PANE_ID;
    const sourceGroup = state.panes.find(pane => pane.id === sourcePaneId);
    const sourceBand = state.embeddedBands.find(band => band.memberIds.includes(instanceId));
    const groupMemberIds = sourceGroup?.memberIds ?? sourceBand?.memberIds;
    const memberIds = (moveTogether && groupMemberIds ? groupMemberIds : [instanceId])
      .filter(id => subjects.has(id));
    if (!memberIds.includes(instanceId)) memberIds.push(instanceId);
    const moving = memberIds.map(id => subjects.get(id)!);

    const targetPaneId = targetId === '@price' ? PRICE_PANE_ID
      : targetId === '@new' ? (this.options.makePaneId ?? (seed => compositionPaneId(seed)))(`${instanceId}-${crypto.randomUUID()}`)
        : targetId;
    const placement = targetPaneId === PRICE_PANE_ID ? 'overlay' as const : 'pane' as const;
    const targetGroup = state.panes.find(pane => pane.id === targetPaneId);
    const adoptingTarget = !targetGroup ? [...subjects.values()].find(subject => subject.adoptablePane
      && subject.placement === 'pane' && subject.paneId === targetPaneId && subject.instanceId !== instanceId
      && subject.paneIndex() >= 0) : undefined;
    if (targetId !== '@price' && targetId !== '@new' && !targetGroup && !adoptingTarget) return this.fail('The selected destination pane no longer exists. Choose a current pane.');

    const panes = chart.panes();
    const original = new Map<ManagedCompositionPlacementSubject, { paneElement: object; paneId: string; placement: 'overlay' | 'pane' }>();
    for (const subject of moving) {
      const paneIndex = subject.paneIndex();
      const pane = panes[paneIndex];
      if (paneIndex < 0 || !pane || !subject.moveTo) {
        return this.fail(`Could not move ${subject.title}; its current study handle or pane is unavailable.`);
      }
      original.set(subject, { paneElement: pane.element, paneId: subject.paneId ?? PRICE_PANE_ID, placement: subject.placement });
    }
    const sourceElement = original.get(selected)!.paneElement;
    if (moving.some(subject => original.get(subject)!.paneElement !== sourceElement)) {
      return this.fail('The selected studies no longer occupy one pane. Reload the chart and try again.');
    }

    let targetElement: object | undefined;
    if (targetPaneId === PRICE_PANE_ID) targetElement = panes[chart.primaryPaneIndex()]?.element;
    else if (targetGroup) {
      for (const id of targetGroup.memberIds) {
        const subject = subjects.get(id);
        const pane = subject && chart.panes()[subject.paneIndex()];
        if (pane) { targetElement = pane.element; break; }
      }
      if (!targetElement) return this.fail('Could not move to that pane; its live chart pane is unavailable.');
    } else if (adoptingTarget) {
      targetElement = panes[adoptingTarget.paneIndex()]?.element;
      if (!targetElement) return this.fail('Could not adopt that native pane; its live chart pane is unavailable.');
    }

    const movedIdsForState=new Set(memberIds);
    const withoutMoved = memberIds.reduce((next, id) => removeCompositionMember(next, id,
      this.options.getSubjects().map(subject => subject.instanceId)), state);
    withoutMoved.opaqueLegacyPanes=withoutMoved.opaqueLegacyPanes.filter(pane=>!movedIdsForState.has(pane.ownerInstanceId));
    if (placement === 'pane') {
      const capacity = targetGroup?.memberIds.filter(id => !memberIds.includes(id)).length ?? (adoptingTarget ? 1 : 0);
      if (capacity + memberIds.length > MAX_COMPOSITION_MEMBERS) return this.fail('That pane already contains the maximum number of managed studies.');
      if (!targetGroup && !adoptingTarget && withoutMoved.panes.length >= MAX_COMPOSITION_PANES) return this.fail('This chart already has the maximum number of managed panes.');
    }

    const moved: ManagedCompositionPlacementSubject[] = [];
    let createdTargetElement: object | undefined;
    for (const subject of moving) {
      const targetIndex = placement === 'overlay' ? chart.primaryPaneIndex()
        : targetElement ? chart.panes().findIndex(pane => pane.element === targetElement) : chart.panes().length;
      if (targetIndex < 0 || !subject.moveTo(placement, targetPaneId, targetIndex, true)) {
        const failure = `Could not move ${subject.title}; its current study handle is unavailable.`;
        const rollbackFailed = this.rollback(moved, original);
        if (createdTargetElement) this.removeEmptyPane(createdTargetElement);
        return this.fail(rollbackFailed ? `${failure} The group could not be fully returned to its original panes.` : failure);
      }
      moved.push(subject);
      if (targetPaneId !== PRICE_PANE_ID && !targetElement) {
        const createdPane = chart.panes()[subject.paneIndex()];
        if (!createdPane) {
          const rollbackFailed = this.rollback(moved, original);
          return this.fail(rollbackFailed ? 'The new pane was created without a recoverable chart handle.' : 'Could not resolve the new destination pane.');
        }
        targetElement = createdTargetElement = createdPane.element;
      }
    }

    let composition = withoutMoved;
    if (placement === 'pane') {
      const title = targetGroup?.title ?? adoptingTarget?.title ?? selected.title;
      if (!targetGroup && adoptingTarget) {
        const targetIndex = adoptingTarget.paneIndex();
        const legacy = state.opaqueLegacyPanes.find(item => item.ownerInstanceId === adoptingTarget.instanceId || item.id === targetPaneId);
        const adoptedPane = makeCompositionPane(targetPaneId, title, [adoptingTarget.instanceId], legacy?.order ?? composition.panes.length,
          targetIndex >= 0 ? chart.paneWeight?.(targetIndex) ?? 1 : 1);
        adoptedPane.collapsed = targetIndex >= 0 ? chart.paneCollapsed?.(targetIndex) ?? false : false;
        composition = { ...composition, panes: [...composition.panes, adoptedPane],
          opaqueLegacyPanes: composition.opaqueLegacyPanes.filter(item => item.ownerInstanceId !== adoptingTarget.instanceId && item.id !== targetPaneId) };
      }
      const allowed = this.options.getSubjects().map(subject => subject.instanceId);
      for (const id of memberIds) composition = addCompositionMember(composition, targetPaneId, title, id, allowed);
      const sourceBandIsLower = Boolean(sourceBand?.memberIds.some(id => state.plots.some(plot => plot.producerInstanceId === id && plot.paneId !== PRICE_PANE_ID)));
      composition = this.attachBottomBand(composition, state, memberIds, targetPaneId,
        keepLowerBottomBand || sourceBandIsLower ? sourceBand : undefined, title, keepLowerBottomBand || sourceBandIsLower, heightPercent);
    } else {
      const previousBand = sourceBand ?? state.embeddedBands.find(band => band.memberIds.some(id => memberIds.includes(id)));
      const remainingBandUsesId = Boolean(previousBand && composition.embeddedBands.some(band => band.id === previousBand.id));
      const band = { id: previousBand && !remainingBandUsesId ? previousBand.id : `band:${memberIds[0]}`,
        title: previousBand?.title ?? selected.title, memberIds: [...memberIds],
        heightPercent: clampBandHeight(heightPercent, previousBand?.heightPercent ?? DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT) };
      composition = { ...composition, embeddedBands: [...composition.embeddedBands.filter(item => !item.memberIds.some(id => memberIds.includes(id))), band] };
    }

    const movedIds = new Set(memberIds);
    composition = { ...composition, plots: composition.plots.map(plot => movedIds.has(plot.producerInstanceId) ? { ...plot, paneId: targetPaneId } : plot) };
    composition = withRebuiltBandMemberships(composition);
    composition = validateComposition(composition, this.options.getSubjects().map(subject => subject.instanceId));
    if (placement === 'pane' && memberIds.some(id => !composition.panes.find(pane => pane.id === targetPaneId)?.memberIds.includes(id))) {
      const rollbackFailed = this.rollback(moved, original);
      if (createdTargetElement) this.removeEmptyPane(createdTargetElement);
      return this.fail(rollbackFailed ? 'Pane membership could not be applied or rolled back completely.' : 'Pane membership could not be applied; the chart move was rolled back.');
    }

    const placements = moving.map(subject => ({ instanceId: subject.instanceId, placement, paneId: targetPaneId }));
    const scriptMoves = moved.some(subject => subject.kind === 'script');
    this.removeEmptyPane(sourceElement);
    this.options.commit(composition, placements, scriptMoves);
    this.options.clearError();
    return true;
  }

  private rollback(moved: readonly ManagedCompositionPlacementSubject[], original: ReadonlyMap<ManagedCompositionPlacementSubject, { paneElement: object; paneId: string; placement: 'overlay' | 'pane' }>) {
    let failed = false;
    for (const subject of [...moved].reverse()) {
      const previous = original.get(subject);
      const paneIndex = previous ? this.options.chart.panes().findIndex(pane => pane.element === previous.paneElement) : -1;
      if (!previous || paneIndex < 0 || !subject.moveTo(previous.placement, previous.paneId, paneIndex, true)) failed = true;
    }
    return failed;
  }

  private attachBottomBand(composition: IndicatorCompositionState, original: IndicatorCompositionState, memberIds: readonly string[],
    targetPaneId: string, sourceBand: IndicatorCompositionState['embeddedBands'][number] | undefined, fallbackTitle: string,
    enabled: boolean, heightPercent: number) {
    if (!enabled) return composition;
    const movedBandMembers = memberIds.filter(id => sourceBand?.memberIds.includes(id)
      || original.plots.some(plot => plot.producerInstanceId === id
        && original.scales.find(scale => scale.scaleId === plot.scaleId)?.policy === 'zero-based'));
    if (!movedBandMembers.length) return composition;
    const moved = new Set(memberIds);
    const targetBand = composition.embeddedBands.find(band => band.memberIds.some(id => !moved.has(id)
      && composition.plots.some(plot => plot.producerInstanceId === id && plot.paneId === targetPaneId)));
    const previousBand = sourceBand ?? original.embeddedBands.find(band => band.memberIds.some(id => moved.has(id)));
    const candidate = targetBand ?? (previousBand && !composition.embeddedBands.some(band => band.id === previousBand.id) ? previousBand : undefined);
    const bandId = candidate?.id ?? `band:${movedBandMembers[0]}`;
    const band = { id: bandId, title: candidate?.title ?? previousBand?.title ?? fallbackTitle,
      memberIds: [...new Set([...(candidate?.memberIds ?? []), ...movedBandMembers])].slice(0, MAX_COMPOSITION_MEMBERS),
      heightPercent: candidate?.heightPercent ?? clampBandHeight(heightPercent, previousBand?.heightPercent ?? DEFAULT_EMBEDDED_BAND_HEIGHT_PERCENT) };
    return { ...composition, embeddedBands: [...composition.embeddedBands.filter(item => item.id !== bandId
      && !item.memberIds.some(id => movedBandMembers.includes(id))), band] };
  }

  private removeEmptyPane(element: object) {
    const chart = this.options.chart;
    const index = chart.panes().findIndex(pane => pane.element === element);
    if (index < 0 || index === chart.primaryPaneIndex()) return;
    const subjects = this.options.getSubjects();
    if (subjects.some(subject => subject.paneIndex() === index)) return;
    if (chart.indicators().some(indicator => indicator.paneIndex === index) || this.options.hasProtectedPaneContent?.(index)) return;
    chart.removePane(index, { force: true });
  }

  private fail(message: string): false {
    this.options.reportError(message);
    return false;
  }
}

function clampBandHeight(value: number, fallback: number) {
  const normalized = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(MIN_EMBEDDED_BAND_HEIGHT_PERCENT, Math.min(MAX_EMBEDDED_BAND_HEIGHT_PERCENT, normalized));
}

/** Keep output scale identities independent; unit equality never merges assigned scales. */
function withRebuiltBandMemberships(state: IndicatorCompositionState): IndicatorCompositionState {
  const scales = new Map(state.scales.map(scale => [scale.scaleId, { ...scale, bandMemberships: [] as { paneId: string; bandId: string }[] }]));
  for (const plot of state.plots) {
    const band = state.embeddedBands.find(item => item.memberIds.includes(plot.producerInstanceId));
    const scale = scales.get(plot.scaleId);
    if (!band || !scale) continue;
    if (!scale.bandMemberships.some(item => item.paneId === plot.paneId && item.bandId === band.id)) {
      scale.bandMemberships.push({ paneId: plot.paneId, bandId: band.id });
    }
  }
  return { ...state, scales: [...scales.values()] };
}
