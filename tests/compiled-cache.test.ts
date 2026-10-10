import { describe, expect, it } from 'vitest';
import { compileStudy } from '../src/scripts/runtime';
import {
  clearCompiledProgramCache, compiledProgramCacheStats, getCompiledProgram,
  MAX_COMPILED_CACHE_BYTES, MAX_COMPILED_CACHE_ENTRIES, MAX_COMPILED_CACHE_ENTRY_BYTES,
  MAX_COMPILED_SOURCE_BYTES, rememberCompiledProgram,
} from '../src/scripts/compiled-cache';

const source = 'version 1\nstudy("Close")\nplot(close, "Close")';
const program = compileStudy(source).program!;

describe('bounded trusted compiled-program cache', () => {
  it('uses an exact source key, isolates source changes and enforces entry/total-byte limits', () => {
    clearCompiledProgramCache();
    rememberCompiledProgram(source, program);
    expect(getCompiledProgram(source)?.program).toEqual(program);
    expect(getCompiledProgram(`${source}\n`)).toBeUndefined();

    for (let i = 0; i <= MAX_COMPILED_CACHE_ENTRIES; i++) rememberCompiledProgram(`${source}\n// ${i}`, program);
    const stats = compiledProgramCacheStats();
    expect(stats.entries).toBe(MAX_COMPILED_CACHE_ENTRIES);
    expect(stats.bytes).toBeLessThanOrEqual(MAX_COMPILED_CACHE_BYTES);
    expect(getCompiledProgram(`${source}\n// 0`)).toBeUndefined();
    expect(getCompiledProgram(`${source}\n// ${MAX_COMPILED_CACHE_ENTRIES}`)).toBeDefined();

    const oversized = { ...program, cachePadding: 'x'.repeat(MAX_COMPILED_CACHE_ENTRY_BYTES) } as typeof program;
    rememberCompiledProgram('oversized', oversized);
    expect(getCompiledProgram('oversized')).toBeUndefined();
    expect(getCompiledProgram('x'.repeat(MAX_COMPILED_SOURCE_BYTES + 1))).toBeUndefined();
  });
});
