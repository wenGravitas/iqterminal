import { describe, expect, it } from 'vitest';
import {
  contentHash, decodeScriptPackage, MAX_SCRIPT_PACKAGE_BYTES,
  validateSource, type ScriptPackageV1,
} from '../src/scripts/library';
import { compileStudy } from '../src/scripts/runtime';
import { requiredScriptCapabilities } from '../src/scripts/capabilities';
import { BUILT_IN_STUDIES } from '../src/scripts/examples';

const source = 'version 1\nstudy("Close")\nplot(close, "Close")';
const metadata = { title: 'Close line', description: 'A small local study.', author: 'Desk', license: 'MIT' };
const inspectSource = async (value: string) => {
  const compiled = compileStudy(value);
  if (!compiled.program) throw new Error(compiled.diagnostics[0]?.message ?? 'Invalid script source.');
  return requiredScriptCapabilities(compiled.program);
};

async function packageText() {
  const hash = await contentHash(source);
  const compiled = compileStudy(source);
  expect(compiled.program).toBeTruthy();
  const pack: ScriptPackageV1 = {
    format: 'iqterminal.openscript', version: 1, metadata,
    revision: { contentHash: hash, source, languageVersion: 1, runtimeVersion: '0.8.1', declaredCapabilities: requiredScriptCapabilities(compiled.program!) },
  };
  return JSON.stringify(pack);
}

describe('local OpenScript library package boundary', () => {
  it('uses stable SHA-256 content-addressed immutable revision identifiers', async () => {
    const first = await contentHash(source);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await contentHash(source)).toBe(first);
    expect(await contentHash(`${source}\n`)).not.toBe(first);
  });

  it('accepts a compatible package and preserves only its versioned source metadata', async () => {
    const parsed = await decodeScriptPackage(await packageText(), inspectSource);
    expect(parsed).toMatchObject({
      format: 'iqterminal.openscript', version: 1, metadata,
      revision: { source, languageVersion: 1, runtimeVersion: '0.8.1', declaredCapabilities: ['ohlcv'] },
    });
  });

  it('discards any program-shaped field from a package and imports only its source', async () => {
    const packageValue = JSON.parse(await packageText());
    packageValue.revision.program = { compiled: true, opcodes: ['RUN'] };
    const imported = await decodeScriptPackage(JSON.stringify(packageValue), inspectSource);
    expect(imported.revision).not.toHaveProperty('program');
    expect(imported.revision.source).toBe(source);
  });

  it('rejects tampered source, incompatible runtimes and package oversize before persistence', async () => {
    const good = JSON.parse(await packageText());
    const changed = structuredClone(good);
    changed.revision.source += '\nplot(open, "Open")';
    await expect(decodeScriptPackage(JSON.stringify(changed), inspectSource)).rejects.toThrow('hash does not match');

    const incompatible = structuredClone(good);
    incompatible.revision.runtimeVersion = '0.9.0';
    await expect(decodeScriptPackage(JSON.stringify(incompatible), inspectSource)).rejects.toThrow('compatibility');
    await expect(decodeScriptPackage(' '.repeat(MAX_SCRIPT_PACKAGE_BYTES + 1), inspectSource)).rejects.toThrow('Import exceeds');
  });

  it('derives depth capabilities from compiled source inputs and rejects forged manifests', async () => {
    const depthSource = BUILT_IN_STUDIES.find(study => study.id === 'builtin.binance-depth-band')!.source;
    const compiled = compileStudy(depthSource);
    expect(compiled.program).toBeTruthy();
    const capabilities = requiredScriptCapabilities(compiled.program!);
    expect(capabilities).toEqual(['iqterminal.depth.series.v1', 'ohlcv']);
    const hash = await contentHash(depthSource);
    const pack: ScriptPackageV1 = {
      format: 'iqterminal.openscript', version: 1, metadata,
      revision: { contentHash: hash, source: depthSource, languageVersion: 1, runtimeVersion: '0.8.1', declaredCapabilities: capabilities },
    };
    await expect(decodeScriptPackage(JSON.stringify(pack), inspectSource)).resolves.toMatchObject({ revision: { declaredCapabilities: capabilities } });
    pack.revision.declaredCapabilities = ['ohlcv'];
    await expect(decodeScriptPackage(JSON.stringify(pack), inspectSource)).rejects.toThrow('do not match');
  });

  it('includes optional depth sources in derived capabilities even when the default source is OHLCV', () => {
    const compiled = compileStudy('version 1\nstudy("Optional source")\nsource = input(close, "Source", options = ["iq_depth_bid_quote_v1"])\nplot(source, "Selected source")');
    expect(compiled.program, JSON.stringify(compiled.diagnostics)).toBeTruthy();
    expect(requiredScriptCapabilities(compiled.program!)).toEqual(['iqterminal.depth.series.v1', 'ohlcv']);
  });

  it('measures source and metadata in bounded UTF-8 text without accepting control bytes', async () => {
    expect(() => validateSource('')).toThrow('empty');
    expect(() => validateSource('a\u0000b')).toThrow('null character');
    expect(() => validateSource('x'.repeat(100_001))).toThrow('100,000 UTF-8 bytes');
    expect(() => validateSource('€'.repeat(33_334))).toThrow('100,000 UTF-8 bytes');
    const invalid = await packageText().then(JSON.parse) as ScriptPackageV1;
    invalid.metadata.title = 'unsafe\u0001title';
    await expect(decodeScriptPackage(JSON.stringify(invalid), inspectSource)).rejects.toThrow('plain text');
  });
});
