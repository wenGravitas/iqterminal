import type { CompiledProgram } from 'openalgo-script';

export const SCRIPT_RUNTIME_VERSION = '0.8.1' as const;
export const SCRIPT_CAPABILITY_VERSION = 'iqcap-v1' as const;
export const MAX_COMPILED_CACHE_ENTRIES = 16;
export const MAX_COMPILED_CACHE_BYTES = 4 * 1024 * 1024;
export const MAX_COMPILED_CACHE_ENTRY_BYTES = 512 * 1024;
export const MAX_COMPILED_SOURCE_BYTES = 100_000;

/** A compiler-produced program that can be reused only with its exact source/version tuple. */
export interface CompiledProgramArtifact {
  source: string;
  runtimeVersion: typeof SCRIPT_RUNTIME_VERSION;
  capabilityVersion: typeof SCRIPT_CAPABILITY_VERSION;
  program: CompiledProgram;
}

interface Entry { artifact: CompiledProgramArtifact; bytes: number }
const cache = new Map<string, Entry>();
let cacheBytes = 0;
const encoder = new TextEncoder();

/** Exact source text is the collision-free source key; runtime and host contract version are namespaced in it. */
export function getCompiledProgram(source: string): CompiledProgramArtifact | undefined {
  if (encoder.encode(source).byteLength > MAX_COMPILED_SOURCE_BYTES) return undefined;
  const key = cacheKey(source);
  const entry = cache.get(key);
  if (!entry || entry.artifact.source !== source) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry.artifact;
}

/** Stores only a bounded structured clone received from a successful, client-validated worker start. */
export function rememberCompiledProgram(source: string, program: CompiledProgram): void {
  if (encoder.encode(source).byteLength > MAX_COMPILED_SOURCE_BYTES) return;
  let serialized: string;
  try { serialized = JSON.stringify(program); } catch { return; }
  if (typeof serialized !== 'string') return;
  const bytes = encoder.encode(source).byteLength + encoder.encode(serialized).byteLength;
  if (bytes > MAX_COMPILED_CACHE_ENTRY_BYTES) return;

  let copy: CompiledProgram;
  try { copy = structuredClone(program); } catch { return; }
  deepFreeze(copy);
  const key = cacheKey(source);
  const previous = cache.get(key);
  if (previous) { cache.delete(key); cacheBytes -= previous.bytes; }
  while (cache.size >= MAX_COMPILED_CACHE_ENTRIES || cacheBytes + bytes > MAX_COMPILED_CACHE_BYTES) evictOldest();
  const artifact: CompiledProgramArtifact = Object.freeze({
    source, runtimeVersion: SCRIPT_RUNTIME_VERSION, capabilityVersion: SCRIPT_CAPABILITY_VERSION, program: copy,
  });
  cache.set(key, { artifact, bytes });
  cacheBytes += bytes;
}

/** A cache envelope is internal worker-to-worker data, never accepted from a script package. */
export function isCompatibleCompiledProgram(value: unknown, source: string): value is CompiledProgramArtifact {
  if (encoder.encode(source).byteLength > MAX_COMPILED_SOURCE_BYTES) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const artifact = value as Partial<CompiledProgramArtifact>;
  if (artifact.source !== source || artifact.runtimeVersion !== SCRIPT_RUNTIME_VERSION
    || artifact.capabilityVersion !== SCRIPT_CAPABILITY_VERSION || !artifact.program
    || typeof artifact.program !== 'object') return false;
  try {
    const bytes = encoder.encode(source).byteLength + encoder.encode(JSON.stringify(artifact.program)).byteLength;
    return bytes <= MAX_COMPILED_CACHE_ENTRY_BYTES;
  } catch { return false; }
}

export function compiledProgramCacheStats() { return { entries: cache.size, bytes: cacheBytes }; }
export function clearCompiledProgramCache() { cache.clear(); cacheBytes = 0; }

function cacheKey(source: string) { return `${SCRIPT_RUNTIME_VERSION}\0${SCRIPT_CAPABILITY_VERSION}\0${source}`; }
function evictOldest() {
  const oldest = cache.entries().next().value as [string, Entry] | undefined;
  if (!oldest) return;
  cache.delete(oldest[0]);
  cacheBytes = Math.max(0, cacheBytes - oldest[1].bytes);
}
function deepFreeze(value: unknown) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
