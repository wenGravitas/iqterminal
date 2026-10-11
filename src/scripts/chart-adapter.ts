import type { Bar, IndicatorDescriptor, IndicatorInput, IndicatorMarker, IndicatorPlot, IndicatorValues } from 'openalgo-charts';
import type { CompiledProgram } from 'openalgo-script';
import type { ScriptResult } from './runtime';

type Field = CompiledProgram['meta']['title'];
type CompiledInput = CompiledProgram['inputs'][number];

interface BridgeState {
  result: ScriptResult;
  requestRecompute: (() => void) | null;
}

/** Bound sparse-point annotations even when an entire chart history alternates values and gaps. */
export const MAX_ISOLATED_LINE_MARKERS = 64;

/** A native chart descriptor whose plotted values come only from the script worker. */
export function createScriptChartBridge(
  result: ScriptResult,
  id: string,
  settings: Record<string, unknown>,
) {
  if (!result.ok || !result.program) throw new Error('A script chart descriptor requires a successful worker result.');
  const program = result.program;
  const state: BridgeState = { result, requestRecompute: null };
  const overlay = boolField(program.meta.overlay, program, settings) ?? false;
  const title = stringField(program.meta.title, program, settings, 'Study');
  const group = stringField(program.meta.group, program, settings, '');
  const plots = program.outputs.plots.map(plot => {
    const plotOverlay = boolField(plot.overlay, program, settings);
    const color = colorField(plot.color, program, settings);
    const style = {
      title: stringField(plot.title, program, settings, plot.key),
      lineWidth: numberField(plot.width, program, settings, 1.5),
      lineStyle: supportedLineStyle(stringField(plot.lineStyle, program, settings, 'solid')),
      ...(color === undefined ? {} : { color }),
    };
    const scale = stringField(plot.scale, program, settings, 'right');
    const ownPane = !overlay && plotOverlay !== true;
    const formatField = plot.priceFormat ?? (ownPane ? program.meta.format : null);
    const format = formatField === null ? undefined : stringField(formatField, program, settings, 'price');
    const precisionField = plot.precision ?? (ownPane ? program.meta.precision : null);
    const precision = precisionField === null ? undefined : numberField(precisionField, program, settings, 4);
    const priceFormat = format === 'volume' ? { type: 'volume' as const }
      : format === 'percent' ? { type: 'percent' as const, ...(precision === undefined ? {} : { precision }) }
        : format === undefined ? undefined : { type: 'price' as const, ...(precision === undefined ? {} : { precision }) };
    return {
      key: plot.key,
      type: plot.type as 'line' | 'histogram',
      title: style.title,
      style,
      priceScaleId: (scale === 'none' ? '' : scale === 'left' ? 'left' : 'right') as IndicatorPlot['priceScaleId'],
      ...(priceFormat === undefined ? {} : { priceFormat }),
      ...(plotOverlay === undefined ? {} : { overlay: plotOverlay }),
      ...(numberField(plot.offset, program, settings, 0) === 0 ? {} : { offset: numberField(plot.offset, program, settings, 0) }),
      ...(inputKey(plot.color) === undefined ? {} : { colorKey: inputKey(plot.color) }),
    };
  });
  const descriptor: IndicatorDescriptor = {
    id,
    name: title,
    category: group || 'Scripts',
    placement: overlay ? 'onchart' : 'pane',
    hasSource: true,
    inputs: nativeInputs(program, settings),
    plots,
    ...(program.outputs.fills.length ? {
      fills: program.outputs.fills.map(fill => ({
        between: fill.between,
        ...(colorField(fill.colorUp, program, settings) === undefined ? {} : { colorUp: colorField(fill.colorUp, program, settings) }),
        ...(colorField(fill.colorDown, program, settings) === undefined ? {} : { colorDown: colorField(fill.colorDown, program, settings) }),
        ...(inputKey(fill.colorUp) === undefined ? {} : { colorUpKey: inputKey(fill.colorUp) }),
        ...(inputKey(fill.colorDown) === undefined ? {} : { colorDownKey: inputKey(fill.colorDown) }),
        opacity: numberField(fill.opacity, program, settings, 0.12),
        ...(boolField(fill.overlay, program, settings) === undefined ? {} : { overlay: boolField(fill.overlay, program, settings) }),
      })),
    } : {}),
    calc: bars => align(state.result, bars),
    calcTail: (bars, _settings, fromIndex) => Object.fromEntries(
      Object.entries(align(state.result, bars)).map(([key, values]) => [key, values.slice(fromIndex)]),
    ),
    markers: ({ bars, values }) => isolatedLineMarkers(plots, bars, values, id),
    attach: context => {
      state.requestRecompute = context.requestRecompute;
      return () => { state.requestRecompute = null; };
    },
  };

  return {
    descriptor,
    update(next: ScriptResult, requestFrame: (callback: () => void) => void) {
      if (!next.ok) return;
      state.result = next;
      const recompute = state.requestRecompute;
      if (recompute) requestFrame(recompute);
    },
    clear() { state.requestRecompute = null; },
  };
}

/**
 * Line renderers correctly break at nulls but do not paint a lone point. Add a
 * native, plot-anchored dot only for finite points with no finite neighbour.
 * Retain the latest isolated events and cap output across the study at 64
 * markers so sparse or alternating 5,000-bar scripts remain bounded.
 */
export function isolatedLineMarkers(
  plots: IndicatorDescriptor['plots'],
  bars: readonly Bar[],
  values: IndicatorValues,
  id: string,
): IndicatorMarker[] {
  if (!bars.length || !plots.length) return [];
  const markers: IndicatorMarker[] = [];
  // Keep the latest isolated events so chart panning never depends on a stale
  // visible-range snapshot. OpenAlgo culls the bounded set to its current pane.
  for (let index = bars.length - 1; index >= 0; index--) {
    const bar = bars[index]!;
    for (const plot of plots) {
      if (plot.type !== 'line') continue;
      const column = values[plot.key];
      const value = column?.[index];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const previous = index > 0 ? column?.[index - 1] : null;
      const next = index + 1 < bars.length ? column?.[index + 1] : null;
      if (typeof previous === 'number' && Number.isFinite(previous)
        || typeof next === 'number' && Number.isFinite(next)) continue;
      markers.push({
        id: `${id}:${plot.key}:${bar.time}`,
        time: bar.time,
        position: 'atPrice',
        price: value,
        shape: 'circle',
        size: 'small',
        color: typeof plot.style?.color === 'string' ? plot.style.color : '#737373',
        plot: plot.key,
      });
      if (markers.length >= MAX_ISOLATED_LINE_MARKERS) return markers.reverse();
    }
  }
  return markers.reverse();
}

function nativeInputs(program: CompiledProgram, settings: Record<string, unknown>): IndicatorInput[] {
  return program.inputs.map(input => {
    const fallback = defaultValue(input);
    const value = Object.hasOwn(settings, input.key) ? settings[input.key] : fallback;
    const presentation = { key: input.key, label: input.label, ...(input.tooltip ? { tooltip: input.tooltip } : {}) };
    if (input.kind === 'number') return {
      ...presentation, type: 'number' as const,
      default: typeof value === 'number' && Number.isFinite(value) ? value : 0,
      ...(typeof input.min === 'number' ? { min: input.min } : {}),
      ...(typeof input.max === 'number' ? { max: input.max } : {}),
      ...(typeof input.step === 'number' ? { step: input.step } : {}),
    };
    if (input.kind === 'boolean') return { ...presentation, type: 'boolean' as const, default: typeof value === 'boolean' ? value : false };
    if (input.kind === 'color') return { ...presentation, type: 'color' as const, default: inputColor(value) };
    const options = (input.options ?? []).map(inputPrimitive).filter((option): option is string | number | boolean => option !== null);
    if (options.length && options.every((option): option is string => typeof option === 'string')) return {
      ...presentation, type: 'select' as const, default: String(value ?? options[0] ?? ''),
      options: options.map(option => ({ label: option, value: option })),
    };
    // Source names include host capabilities such as Binance depth fields and
    // cannot be constrained to the chart engine's built-in source enum.
    return { ...presentation, type: 'text' as const, default: String(value ?? '') };
  });
}

function inputColor(value: unknown): string {
  if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) return value;
  const color = value as unknown as Record<string, unknown>;
  const channels = Array.isArray(value) ? value : value && typeof value === 'object' && color.tag === 'color'
    ? [color.r, color.g, color.b] : [];
  if (channels.length < 3 || channels.slice(0, 3).some(channel => typeof channel !== 'number' || !Number.isFinite(channel))) return '#c7c7c7';
  return `#${channels.slice(0, 3).map(channel => Math.max(0, Math.min(255, Math.round(channel as number))).toString(16).padStart(2, '0')).join('')}`;
}

function inputPrimitive(value: unknown): string | number | boolean | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [kind, raw] = value;
  if (kind === 'n' && typeof raw === 'number' && Number.isFinite(raw)
    || kind === 's' && typeof raw === 'string'
    || kind === 'b' && typeof raw === 'boolean') return raw as string | number | boolean;
  if (kind === 'c' && Array.isArray(raw) && raw.length >= 3 && raw.slice(0, 3).every(channel => typeof channel === 'number' && Number.isFinite(channel))) {
    return `#${raw.slice(0, 3).map(channel => Math.round(channel as number).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

function align(result: ScriptResult, bars: readonly Bar[]): Record<string, (number | null)[]> {
  const times = result.times;
  const values = result.values;
  const plots = result.program?.outputs.plots;
  if (!result.ok || !times || !values || !plots) return {};
  const positions = new Map<number, number>();
  for (let i = 0; i < times.length; i++) positions.set(Math.floor(times[i]! / 1000), i);
  const aligned: Record<string, (number | null)[]> = {};
  for (const plot of plots) {
    const column = values[plot.key] ?? [];
    aligned[plot.key] = bars.map(bar => {
      const index = positions.get(bar.time);
      return index === undefined ? null : column[index] ?? null;
    });
  }
  return aligned;
}

function resolve(field: Field, program: CompiledProgram, settings: Record<string, unknown>): unknown {
  if (!field || typeof field !== 'object' || Array.isArray(field) || !('input' in field)) return field;
  const key = field.input;
  if (Object.hasOwn(settings, key)) return settings[key];
  const input = program.inputs.find(candidate => candidate.key === key);
  return input ? defaultValue(input) : undefined;
}

function defaultValue(input: CompiledInput): unknown {
  const [kind, value] = input.default;
  if (kind === 'z') return null;
  if (kind === 'c') return value;
  return value;
}

function stringField(field: Field, program: CompiledProgram, settings: Record<string, unknown>, fallback: string) {
  const value = resolve(field, program, settings);
  return typeof value === 'string' ? value : fallback;
}

function boolField(field: Field, program: CompiledProgram, settings: Record<string, unknown>) {
  const value = resolve(field, program, settings);
  return typeof value === 'boolean' ? value : undefined;
}

function numberField(field: Field, program: CompiledProgram, settings: Record<string, unknown>, fallback: number) {
  const value = resolve(field, program, settings);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function inputKey(field: Field) {
  return field && typeof field === 'object' && !Array.isArray(field) && 'input' in field ? field.input : undefined;
}

function colorField(field: Field, program: CompiledProgram, settings: Record<string, unknown>): string | undefined {
  const value = resolve(field, program, settings);
  if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) {
    const r = Number.parseInt(value.slice(1, 3), 16);
    const g = Number.parseInt(value.slice(3, 5), 16);
    const b = Number.parseInt(value.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 1)`;
  }
  let rgba: readonly number[] | undefined;
  if (Array.isArray(value) && value.length === 4) rgba = value;
  else if (value && typeof value === 'object' && 'tag' in value && value.tag === 'color') {
    const color = value as unknown as { r: number; g: number; b: number; a: number };
    rgba = [color.r, color.g, color.b, color.a];
  }
  if (!rgba || rgba.some((part, i) => typeof part !== 'number' || !Number.isFinite(part) || part < 0 || part > (i === 3 ? 1 : 255))) return undefined;
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})`;
}

function supportedLineStyle(value: string): 'solid' | 'dashed' | 'dotted' {
  return value === 'dashed' || value === 'dotted' ? value : 'solid';
}

export function requiresDepth(program: CompiledProgram, settings: Record<string, unknown> = {}): boolean {
  const fields = new Set(['iq_depth_bid_base_v1', 'iq_depth_ask_base_v1', 'iq_depth_bid_quote_v1', 'iq_depth_ask_quote_v1']);
  return program.inputs.some(input => {
    if (input.kind !== 'source') return false;
    const fallback = input.default[0] === 's' ? input.default[1] : undefined;
    const selected = settings[input.key] ?? fallback;
    return typeof selected === 'string' && fields.has(selected);
  });
}

export function depthBandFor(result: ScriptResult, settings: Record<string, unknown>): number | null {
  if (!result.program || !requiresDepth(result.program, settings)) return null;
  const input = result.program.inputs.find(item => item.key === 'iq_depth_band_pct_v1');
  const fallback = input?.default[0] === 'n' ? input.default[1] : undefined;
  const raw = settings.iq_depth_band_pct_v1 ?? fallback;
  const value = typeof raw === 'number' ? raw : 0.05;
  return value >= 0.01 && value <= 0.25 && Math.round(value * 100) === value * 100 ? value : null;
}
