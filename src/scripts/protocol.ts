import type { ScriptBar, ScriptContext, ScriptResult } from './runtime';
import type { CompiledProgramArtifact } from './compiled-cache';

export type ScriptWorkerRequest =
  | { type: 'start'; generation: number; source: string; settings: Record<string, unknown>; bars: ScriptBar[]; context: ScriptContext; compiledProgram?: CompiledProgramArtifact }
  | { type: 'history'; generation: number; bars: ScriptBar[] }
  | { type: 'patch'; generation: number; changes: { kind: 'append' | 'update'; bar: ScriptBar }[] }
  | { type: 'dispose' };
export type ScriptWorkerResponse = ScriptResult | { type: 'disposed' };
