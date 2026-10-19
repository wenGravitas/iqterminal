import { instrumentKey, instrumentOf, type CanonicalSeries } from '../feed/protocol';
import type { NormalizedExecution } from '../feed/footprint';

export interface ExecutionHoverTarget {
  series(): CanonicalSeries;
  setExecutionHoverRay(execution: NormalizedExecution | null): void;
  addExecutionRay?(execution: NormalizedExecution): boolean;
}

export function executionMatchesSeries(execution: NormalizedExecution, series: CanonicalSeries) {
  return instrumentKey(execution) === instrumentKey(series) && execution.nativeSymbol === instrumentOf(series).native;
}

/** Keeps transient ticker hover state on matching chart instruments only. */
export class TickerExecutionHoverCoordinator {
  private readonly charts = new Map<string, ExecutionHoverTarget>();
  private sourceId: string | null = null;
  private execution: NormalizedExecution | null = null;

  registerChart(id: string, target: ExecutionHoverTarget | null) {
    const existing = this.charts.get(id);
    if (existing && existing !== target) existing.setExecutionHoverRay(null);
    if (!target) {
      this.charts.delete(id);
      return;
    }
    this.charts.set(id, target);
    this.apply(target);
  }

  publish(sourceId: string, execution: NormalizedExecution | null) {
    if (!execution && this.sourceId !== sourceId) return;
    if (execution && this.sourceId === sourceId && this.execution?.executionId === execution.executionId) return;
    this.sourceId = execution ? sourceId : null;
    this.execution = execution;
    for (const target of this.charts.values()) this.apply(target);
  }

  /** Re-evaluate the current ticker execution after one chart changes instrument or interval. */
  refreshChart(id: string) {
    const target = this.charts.get(id);
    if (target) this.apply(target);
  }

  /** Commit one native ray on every currently open chart that shows this instrument. */
  addExecutionRay(execution: NormalizedExecution) {
    let added = 0;
    for (const target of this.charts.values()) {
      if (executionMatchesSeries(execution, target.series()) && target.addExecutionRay?.(execution)) added++;
    }
    return added;
  }

  private apply(target: ExecutionHoverTarget) {
    const execution = this.execution && executionMatchesSeries(this.execution, target.series()) ? this.execution : null;
    target.setExecutionHoverRay(execution);
  }
}
