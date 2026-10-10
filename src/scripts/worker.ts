/// <reference lib="webworker" />
import { OpenScriptSession } from './runtime';
import { type ScriptWorkerRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const session = new OpenScriptSession();
let disposed = false;
scope.onmessage = (event: MessageEvent<ScriptWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'dispose') {
    disposed = true;
    session.reset();
    scope.postMessage({ type: 'disposed' });
    scope.close();
    return;
  }
  if (disposed) return;
  try {
    const result = message.type === 'start'
      ? session.start(message.generation, message.source, message.settings, message.bars, message.context, message.compiledProgram)
      : message.type === 'history'
        ? session.history(message.generation, message.bars)
        : session.patch(message.generation, message.changes);
    scope.postMessage(result);
  } catch (error) {
    scope.postMessage({ generation: message.generation, ok: false, diagnostics: [{ code: 'IQ1099', title: 'Study runtime error', message: error instanceof Error ? error.message : 'Unexpected OpenScript runtime failure.', fix: 'Edit the study or remove it to continue.', line: 1, column: 1, from: 0, to: 0, severity: 'error' }] });
  }
};
