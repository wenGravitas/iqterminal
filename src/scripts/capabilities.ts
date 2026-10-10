import type { CompiledProgram } from 'openalgo-script';

const DEPTH_FIELD_NAMES = new Set([
  'iq_depth_bid_base_v1', 'iq_depth_ask_base_v1',
  'iq_depth_bid_quote_v1', 'iq_depth_ask_quote_v1',
]);

/** Cheap metadata extraction from a program already compiled and validated in a worker. */
export function requiredScriptCapabilities(program: CompiledProgram): string[] {
  const capabilities = new Set(['ohlcv']);
  if (program.inputs.some(input => input.kind === 'source' && [input.default, ...(input.options ?? [])]
    .some(([kind, value]) => kind === 's' && typeof value === 'string' && DEPTH_FIELD_NAMES.has(value)))) {
    capabilities.add('iqterminal.depth.series.v1');
  }
  return [...capabilities].sort();
}
