import { isNumericOutputRef, type NumericOutputRef } from './composition';

export const MAX_CHART_NUMERIC_OUTPUTS = 128;
export const MAX_CHART_NUMERIC_CONSUMERS = 32;
export const MAX_CHART_NUMERIC_VALUES = 5_000;
export const MAX_OUTPUT_RESET_SEGMENTS = 128;

export interface NumericChangedRange { from: number; to: number }
export type NumericQuantity = 'flow' | 'level' | 'cumulative' | 'unknown';
export type NumericTimestampConvention = 'candle-open' | 'interval-end' | 'observation-time' | 'unknown';
export type NumericQuality = 'complete' | 'partial' | 'stale' | 'unavailable' | 'unknown';
export interface NumericResetSegment { fromTime: number; toTime?: number; reason: string }

/** A bounded candle-aligned output. Arrays are retained by reference and patched in place by their owner. */
export interface ChartNumericOutput extends NumericOutputRef {
  title: string;
  engineInstanceId?: string;
  revision: number;
  contextRevision: number;
  available: boolean;
  times: readonly number[];
  values: readonly (number | null)[];
  quantity: NumericQuantity;
  marketScope: string;
  sourceScope: string;
  timestampConvention: NumericTimestampConvention;
  quality: NumericQuality;
  resets: readonly NumericResetSegment[];
  changedRange: NumericChangedRange;
}

export interface NumericOutputResolution { output?: ChartNumericOutput; available: boolean; reason?: string }
export type NumericOutputListener = (resolution: NumericOutputResolution) => void;
export interface ManagedNumericOutputBinding {
  registry: ChartNumericOutputRegistry;
  consumerId: string;
  ref: NumericOutputRef;
}

export interface SavedNumericConsumerReference {
  instanceId: string;
  ref: NumericOutputRef;
}

interface Consumer {
  instanceId: string;
  ref: NumericOutputRef;
  active: boolean;
  listener: NumericOutputListener;
  completedRevision?: number;
  completedContextRevision?: number;
}

/**
 * One chart's managed output graph. It stores bounded latest values, validates
 * semantic replacements, and only reports a consumer current after the exact
 * upstream revision it read is still published.
 */
export class ChartNumericOutputRegistry {
  private outputs = new Map<string, ChartNumericOutput>();
  private outputsByOwner = new Map<string, Set<string>>();
  private consumers = new Map<string, Consumer>();
  private listenersByOutput = new Map<string, Set<string>>();
  private outputListeners = new Set<(output: ChartNumericOutput) => void>();
  private revision = 0;
  private dead = false;

  constructor(readonly chartId: string, private readonly requestVisible?: (callback: () => void) => void,
    private readonly savedConsumerReferences?: () => readonly SavedNumericConsumerReference[]) {
    if (!chartId || chartId.length > 120) throw new Error('A chart output registry needs a bounded chart identity.');
  }

  publish(output: ChartNumericOutput): boolean {
    this.assertAlive();
    validateOutput(output);
    this.preflight(output);
    const previous = this.outputs.get(output.outputId);
    if (!previous && this.outputs.size >= MAX_CHART_NUMERIC_OUTPUTS) throw new Error('This chart reached its managed numeric output limit.');
    const revision = Math.max(output.revision, (previous?.revision ?? 0) + 1);
    const changedRange = normalizeChangedRange(output.changedRange, output.values.length,
      !previous || previous.contextId !== output.contextId || previous.contextRevision !== output.contextRevision
        || previous.values.length !== output.values.length || compatibilityKey(previous) !== compatibilityKey(output));
    const published = { ...output, revision, resets: output.resets.slice(0, MAX_OUTPUT_RESET_SEGMENTS), changedRange };
    this.outputs.set(output.outputId, published);
    const owned = this.outputsByOwner.get(output.instanceId) ?? new Set<string>();
    owned.add(output.outputId); this.outputsByOwner.set(output.instanceId, owned);
    this.revision++;
    this.notifyConsumers(output.outputId, published);
    for (const listener of [...this.outputListeners]) listener(published);
    return true;
  }

  /** Check semantic compatibility before mutating a cached incremental output. */
  preflight(output: ChartNumericOutput) {
    this.assertAlive();
    validateOutputMetadata(output);
    const previous = this.outputs.get(output.outputId);
    if (!previous && this.outputs.size >= MAX_CHART_NUMERIC_OUTPUTS) throw new Error('This chart reached its managed numeric output limit.');
    if (previous && previous.instanceId !== output.instanceId) throw new Error(`Output ${output.outputId} is already owned by another producer.`);
    if (previous && previous.contextId === output.contextId && compatibilityKey(previous) !== compatibilityKey(output)
      && this.listenersByOutput.has(output.outputId)) {
      throw new Error(`Output ${output.outputId} cannot change unit, quantity, source scope, market scope or timestamp convention while consumers depend on it.`);
    }
    return true;
  }

  /** Strictly validate an explicit producer replacement before its saved inputs are changed. */
  preflightReplacement(output: ChartNumericOutput, savedConsumers: readonly { title: string; ref: NumericOutputRef }[] = []) {
    this.preflight(output);
    const previous = this.outputs.get(output.outputId);
    const incompatibleSavedConsumers = savedConsumers.filter(({ ref }) => ref.instanceId === output.instanceId
      && ref.outputId === output.outputId && (ref.schemaId !== output.schemaId || ref.domain !== output.domain
        || ref.contextId !== output.contextId || ref.unit !== output.unit));
    if (incompatibleSavedConsumers.length) {
      const titles = [...new Set(incompatibleSavedConsumers.map(item => item.title))].slice(0, 4).join(', ');
      throw new Error(`Output ${output.outputId} cannot change schema, unit or chart context while saved consumers ${titles} depend on it.`);
    }
    if (previous && this.listenersByOutput.has(output.outputId)
      && previous.contextId !== output.contextId) {
      throw new Error(`Output ${output.outputId} cannot change chart context while consumers depend on it.`);
    }
    return true;
  }

  publishMany(outputs: readonly ChartNumericOutput[]) {
    this.assertAlive();
    const ids = new Set<string>();
    let additions = 0;
    for (const output of outputs) {
      validateOutput(output);
      if (ids.has(output.outputId)) throw new Error(`Output ${output.outputId} occurs more than once in one publication.`);
      ids.add(output.outputId);
      const previous = this.outputs.get(output.outputId);
      if (!previous) additions++;
      else {
        if (previous.instanceId !== output.instanceId) throw new Error(`Output ${output.outputId} is already owned by another producer.`);
        if (previous.contextId === output.contextId && compatibilityKey(previous) !== compatibilityKey(output)
          && this.listenersByOutput.has(output.outputId)) {
          throw new Error(`Output ${output.outputId} cannot change unit, quantity, source scope, market scope or timestamp convention while consumers depend on it.`);
        }
      }
    }
    if (this.outputs.size + additions > MAX_CHART_NUMERIC_OUTPUTS) throw new Error('This chart reached its managed numeric output limit.');
    for (const output of outputs) this.publish(output);
    return true;
  }

  markUnavailable(instanceId: string, reason: string, quality: NumericQuality = 'unavailable') {
    this.assertAlive();
    for (const outputId of this.outputsByOwner.get(instanceId) ?? []) {
      const previous = this.outputs.get(outputId);
      if (!previous || !previous.available && previous.quality === quality) continue;
      const next = { ...previous, revision: previous.revision + 1, available: false, quality,
        title: previous.title || reason, changedRange: { from: 0, to: previous.values.length } };
      this.outputs.set(outputId, next); this.revision++; this.notifyConsumers(outputId, next, reason);
    }
  }

  /** Release an owner after its runtime is removed, keeping a tombstone only while a saved consumer still refers to it. */
  releaseOwner(instanceId: string, reason = 'Numeric output producer was removed.') {
    this.assertAlive();
    const outputIds = this.outputsByOwner.get(instanceId);
    if (!outputIds?.size) return false;
    if ([...outputIds].some(outputId => (this.listenersByOutput.get(outputId)?.size ?? 0) > 0)) {
      this.markUnavailable(instanceId, reason);
      return false;
    }
    for (const outputId of outputIds) this.outputs.delete(outputId);
    this.outputsByOwner.delete(instanceId);
    this.revision++;
    return true;
  }

  /** Release one named output, retaining an unavailable tombstone for any saved consumer. */
  releaseOutput(instanceId: string, outputId: string, reason = 'Numeric output was removed.') {
    this.assertAlive();
    const output=this.outputs.get(outputId);
    if(!output||output.instanceId!==instanceId)return false;
    if((this.listenersByOutput.get(outputId)?.size??0)>0){
      if(output.available||output.quality!=='unavailable'){
        const next={...output,revision:output.revision+1,available:false,quality:'unavailable' as const,title:output.title||reason,
          changedRange:{from:0,to:output.values.length}};
        this.outputs.set(outputId,next);this.revision++;this.notifyConsumers(outputId,next,reason);
      }
      return false;
    }
    this.outputs.delete(outputId);const owned=this.outputsByOwner.get(instanceId);owned?.delete(outputId);
    if(!owned?.size)this.outputsByOwner.delete(instanceId);
    this.revision++;
    return true;
  }

  resolve(ref: NumericOutputRef): NumericOutputResolution {
    if (this.dead) return { available: false, reason: 'Chart output registry is disposed.' };
    const output = this.outputs.get(ref.outputId);
    if (!output || !sameRef(output, ref)) return { output, available: false, reason: 'The referenced output is unavailable or its schema changed.' };
    if (!output.available) return { output, available: false, reason: output.quality === 'stale' ? 'The referenced output is stale.' : 'The referenced output is unavailable.' };
    return { output, available: true };
  }

  get(outputId: string) { return this.outputs.get(outputId); }
  hasConsumer(instanceId: string) { return this.consumers.has(instanceId); }

  /** Read-only cycle check against both live bindings and persisted (possibly hidden) inputs. */
  preflightConsumer(instanceId: string, ref: NumericOutputRef) {
    this.assertAlive();
    if (!instanceId || instanceId.length > 120 || !isNumericOutputRef(ref)) {
      throw new Error('A numeric output consumer reference is invalid.');
    }
    const graph = new Map<string, string[]>();
    const addEdge = (consumerId: string, producerId: string) => {
      if (!consumerId || consumerId.length > 120 || !producerId || producerId.length > 120) return;
      const dependencies = graph.get(consumerId) ?? [];
      if (!dependencies.includes(producerId)) dependencies.push(producerId);
      graph.set(consumerId, dependencies);
    };
    for (const consumer of this.consumers.values()) {
      if (consumer.instanceId !== instanceId) addEdge(consumer.instanceId, consumer.ref.instanceId);
    }
    for (const saved of this.savedConsumerReferences?.() ?? []) {
      if (saved.instanceId !== instanceId && isNumericOutputRef(saved.ref)) addEdge(saved.instanceId, saved.ref.instanceId);
    }
    addEdge(instanceId, ref.instanceId);
    if (hasCycleFrom(graph, instanceId)) throw new Error('This numeric output link would create a dependency cycle.');
    return true;
  }

  subscribeOutputs(listener: (output: ChartNumericOutput) => void) {
    this.assertAlive(); this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }
  outputsForOwner(instanceId: string) {
    return [...(this.outputsByOwner.get(instanceId) ?? [])].map(outputId => this.outputs.get(outputId))
      .filter((output): output is ChartNumericOutput => Boolean(output));
  }
  latestRevision() { return this.revision; }

  registerConsumer(instanceId: string, ref: NumericOutputRef, listener: NumericOutputListener, active = true) {
    this.assertAlive();
    if (!instanceId || instanceId.length > 120) throw new Error('A numeric output consumer needs a bounded instance identity.');
    if (!this.outputs.has(ref.outputId) && this.outputs.size >= MAX_CHART_NUMERIC_OUTPUTS) throw new Error('This chart reached its managed numeric output limit.');
    const previous = this.consumers.get(instanceId);
    if (!previous && this.consumers.size >= MAX_CHART_NUMERIC_CONSUMERS) throw new Error('This chart reached its managed numeric consumer limit.');
    const candidate: Consumer = { instanceId, ref, listener, active };
    this.preflightConsumer(instanceId, ref);
    this.unregisterConsumer(instanceId);
    this.consumers.set(instanceId, candidate);
    const consumers = this.listenersByOutput.get(ref.outputId) ?? new Set<string>();
    consumers.add(instanceId); this.listenersByOutput.set(ref.outputId, consumers);
    if (active) listener(this.resolve(ref));
    return () => this.unregisterConsumer(instanceId, candidate);
  }

  setConsumerActive(instanceId: string, active: boolean) {
    const consumer = this.consumers.get(instanceId);
    if (!consumer || consumer.active === active) return;
    consumer.active = active;
    if (active) {
      const resolution = this.resolve(consumer.ref);
      const output = resolution.output;
      const missedRevision = Boolean(output && (consumer.completedRevision !== output.revision
        || consumer.completedContextRevision !== output.contextRevision));
      consumer.listener(missedRevision && output
        ? { ...resolution, output: { ...output, changedRange: { from: 0, to: output.values.length } } }
        : resolution);
    }
  }

  markConsumerComplete(instanceId: string, consumedRevision: number, contextRevision: number) {
    const consumer = this.consumers.get(instanceId);
    if (!consumer) return false;
    const current = this.resolve(consumer.ref).output;
    if (!current?.available || current.revision !== consumedRevision || current.contextRevision !== contextRevision) return false;
    consumer.completedRevision = consumedRevision;
    consumer.completedContextRevision = contextRevision;
    return true;
  }

  consumerIsCurrent(instanceId: string) {
    const consumer = this.consumers.get(instanceId);
    if (!consumer) return false;
    const current = this.resolve(consumer.ref).output;
    return Boolean(current?.available && consumer.completedRevision === current.revision
      && consumer.completedContextRevision === current.contextRevision);
  }

  dependencyOrder() {
    const result: string[] = [], visiting = new Set<string>(), visited = new Set<string>();
    const visit = (instanceId: string) => {
      if (visited.has(instanceId) || visiting.has(instanceId)) return;
      visiting.add(instanceId);
      const consumer = this.consumers.get(instanceId);
      if (consumer) { visit(consumer.ref.instanceId); result.push(instanceId); }
      visiting.delete(instanceId); visited.add(instanceId);
    };
    for (const id of this.consumers.keys()) visit(id);
    return result;
  }

  demandedProducerIds(activeConsumers: readonly string[]) {
    const needed = new Set<string>(), visiting = new Set<string>();
    const include = (instanceId: string) => {
      if (visiting.has(instanceId)) return;
      visiting.add(instanceId);
      const consumer = this.consumers.get(instanceId);
      if (consumer) include(consumer.ref.instanceId);
      else needed.add(instanceId);
      visiting.delete(instanceId);
    };
    for (const id of activeConsumers) include(id);
    return needed;
  }

  diagnostics() {
    return { chartId: this.chartId, revision: this.revision, outputs: [...this.outputs.values()].map(output => ({
      outputId: output.outputId, instanceId: output.instanceId, revision: output.revision, contextRevision: output.contextRevision,
      available: output.available, quality: output.quality, changedRange: output.changedRange,
      values: output.values.length,
    })), consumers: [...this.consumers.values()].map(consumer => ({ instanceId: consumer.instanceId,
      outputId: consumer.ref.outputId, active: consumer.active, completedRevision: consumer.completedRevision,
      current: this.consumerIsCurrent(consumer.instanceId) })) };
  }

  dispose() {
    if (this.dead) return;
    this.dead = true; this.consumers.clear(); this.listenersByOutput.clear(); this.outputListeners.clear(); this.outputsByOwner.clear(); this.outputs.clear();
  }

  private notifyConsumers(outputId: string, output: ChartNumericOutput, reason?: string) {
    for (const id of this.listenersByOutput.get(outputId) ?? []) {
      const consumer = this.consumers.get(id);
      if (!consumer?.active) continue;
      const resolution = this.resolve(consumer.ref);
      consumer.listener(reason && !resolution.available ? { output, available: false, reason } : resolution);
    }
  }

  private unregisterConsumer(instanceId: string, expected?: Consumer) {
    const consumer = this.consumers.get(instanceId);
    if (!consumer || expected && consumer !== expected) return;
    this.consumers.delete(instanceId);
    const listeners = this.listenersByOutput.get(consumer.ref.outputId);
    listeners?.delete(instanceId);
    if (listeners?.size === 0) this.listenersByOutput.delete(consumer.ref.outputId);
  }

  private assertAlive() { if (this.dead) throw new Error('Chart output registry is disposed.'); }
}

const registryByChart = new Map<string, ChartNumericOutputRegistry>();
const managedBindings = new Map<string, ManagedNumericOutputBinding>();

export function registerChartNumericOutputRegistry(registry: ChartNumericOutputRegistry) {
  const existing = registryByChart.get(registry.chartId);
  if (existing && existing !== registry) throw new Error(`Chart ${registry.chartId} already has an output registry.`);
  registryByChart.set(registry.chartId, registry);
  return () => { if (registryByChart.get(registry.chartId) === registry) registryByChart.delete(registry.chartId); };
}

export function managedNumericOutputToken(chartId: string, outputId: string) {
  return `iq-output:${encodeURIComponent(chartId)}:${encodeURIComponent(outputId)}`;
}

/** Ephemeral native-engine binding; its ref remains in chart configuration as a logical numeric link. */
export function registerManagedNumericOutputBinding(registry: ChartNumericOutputRegistry, consumerId: string, ref: NumericOutputRef) {
  if (!consumerId || consumerId.length > 120 || !isNumericOutputRef(ref)) throw new Error('Managed numeric output binding is invalid.');
  const token = `iq-sma:${encodeURIComponent(registry.chartId)}:${encodeURIComponent(consumerId)}:${encodeURIComponent(ref.outputId)}`;
  if (token.length > 1_200) throw new Error('Managed numeric output binding exceeds its size limit.');
  const binding: ManagedNumericOutputBinding = { registry, consumerId, ref: { ...ref } };
  const existing = managedBindings.get(token);
  if (existing && (existing.registry !== registry || existing.consumerId !== consumerId
    || JSON.stringify(existing.ref) !== JSON.stringify(binding.ref))) {
    throw new Error('Managed numeric output binding token is already in use.');
  }
  managedBindings.set(token, binding);
  return { token, release: () => { if (managedBindings.get(token) === binding) managedBindings.delete(token); } };
}

export function managedNumericOutputBindingForToken(token: string) {
  return managedBindings.get(token);
}

export function parseManagedNumericOutputToken(token: string) {
  if (!token.startsWith('iq-output:')) return null;
  const separator = token.indexOf(':', 'iq-output:'.length);
  if (separator < 0) return null;
  try {
    const chartId = decodeURIComponent(token.slice('iq-output:'.length, separator));
    const outputId = decodeURIComponent(token.slice(separator + 1));
    return chartId && outputId ? { chartId, outputId } : null;
  } catch { return null; }
}

export function outputRegistryForToken(token: string) {
  const parsed = parseManagedNumericOutputToken(token);
  return parsed ? registryByChart.get(parsed.chartId) : undefined;
}

export function outputForToken(token: string): ChartNumericOutput | undefined {
  const parsed = parseManagedNumericOutputToken(token);
  return parsed ? registryByChart.get(parsed.chartId)?.get(parsed.outputId) : undefined;
}

function validateOutput(output: ChartNumericOutput) {
  validateOutputMetadata(output);
  if (!Array.isArray(output.times) || !Array.isArray(output.values) || output.times.length !== output.values.length
    || output.values.length > MAX_CHART_NUMERIC_VALUES) throw new Error('Numeric output metadata or bounds are invalid.');
  for (let i = 0; i < output.times.length; i++) {
    if (!Number.isSafeInteger(output.times[i]) || output.times[i]! < 0 || i > 0 && output.times[i]! <= output.times[i - 1]!) throw new Error('Numeric output times must be strictly increasing UTC milliseconds.');
    const value = output.values[i];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Numeric output values must be finite numbers or explicit gaps.');
  }
  if (output.changedRange && (!Number.isInteger(output.changedRange.from) || !Number.isInteger(output.changedRange.to))) throw new Error('Numeric output changed range is invalid.');
}

function validateOutputMetadata(output: ChartNumericOutput) {
  if (!output || output.kind !== 'indicator-output' || output.version !== 1 || output.domain !== 'chart-candles-v1'
    || !output.instanceId || !output.outputId || !output.plotKey || !output.schemaId || !output.contextId
    || !(output.unit === null || typeof output.unit === 'string' && output.unit.length <= 32)
    || !Number.isSafeInteger(output.revision) || output.revision < 1 || !Number.isSafeInteger(output.contextRevision) || output.contextRevision < 0
    || !Array.isArray(output.times) || !Array.isArray(output.values) || output.times.length !== output.values.length
    || output.values.length > MAX_CHART_NUMERIC_VALUES || !Array.isArray(output.resets) || output.resets.length > MAX_OUTPUT_RESET_SEGMENTS
    || !['flow', 'level', 'cumulative', 'unknown'].includes(output.quantity)
    || !['candle-open', 'interval-end', 'observation-time', 'unknown'].includes(output.timestampConvention)
    || !['complete', 'partial', 'stale', 'unavailable', 'unknown'].includes(output.quality)
    || !output.marketScope || output.marketScope.length > 160 || !output.sourceScope || output.sourceScope.length > 160) {
    throw new Error('Numeric output metadata or bounds are invalid.');
  }
}

function compatibilityKey(output: ChartNumericOutput) {
  return JSON.stringify([output.schemaId, output.domain, output.contextId, output.unit, output.quantity,
    output.marketScope, output.sourceScope, output.timestampConvention]);
}

function sameRef(output: ChartNumericOutput, ref: NumericOutputRef) {
  return output.instanceId === ref.instanceId && output.outputId === ref.outputId && output.plotKey === ref.plotKey
    && output.schemaId === ref.schemaId && output.domain === ref.domain && output.contextId === ref.contextId && output.unit === ref.unit;
}

function normalizeChangedRange(range: NumericChangedRange, length: number, full: boolean): NumericChangedRange {
  if (full || !range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return { from: 0, to: length };
  const from = Math.max(0, Math.min(length, Math.trunc(range.from)));
  const to = Math.max(from, Math.min(length, Math.trunc(range.to)));
  return { from, to };
}

function hasCycleFrom(graph: ReadonlyMap<string, readonly string[]>, start: string) {
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (instanceId: string): boolean => {
    if (visiting.has(instanceId)) return true;
    if (visited.has(instanceId)) return false;
    visiting.add(instanceId);
    for (const dependency of graph.get(instanceId) ?? []) if (visit(dependency)) return true;
    visiting.delete(instanceId); visited.add(instanceId); return false;
  };
  return visit(start);
}

export function numericOutputMetadata(value: Partial<Pick<ChartNumericOutput, 'quantity' | 'marketScope' | 'sourceScope' | 'timestampConvention' | 'quality' | 'resets'>> = {}) {
  return {
    quantity: value.quantity ?? 'unknown',
    marketScope: value.marketScope ?? 'unknown',
    sourceScope: value.sourceScope ?? 'unknown',
    timestampConvention: value.timestampConvention ?? 'unknown',
    quality: value.quality ?? 'unknown',
    resets: value.resets ?? [],
  } as const;
}
