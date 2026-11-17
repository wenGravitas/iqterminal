export interface Drawable { visible: boolean; draw(): void }

const FRAME_WORK_BUDGET_MS=8;
/** Coalesces visible invalidations into one RAF, yielding between expensive
 * charts. A single chart remains synchronous and may exceed the soft budget. */
export class Scheduler {
  private readonly dirty = new Set<Drawable>();
  private readonly drawing = new Set<Drawable>();
  private frame = 0;
  private dead = false;
  readonly intervals: number[] = [];
  private readonly work={frames:0,draws:0,budgetYields:0,lastMs:0,maxMs:0};
  private last = 0;

  private readonly visibility = () => {
    if (document.hidden) {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.last = 0;
    } else {
      this.request();
    }
  };

  constructor() { document.addEventListener('visibilitychange', this.visibility); }

  invalidate(chart: Drawable) {
    if (this.dead) return;
    this.dirty.add(chart);
    this.request();
  }

  /** Draws one already-dirty visible chart synchronously, without consuming other work. */
  flush(chart: Drawable): boolean {
    if (this.dead || document.hidden || !chart.visible || !this.dirty.has(chart) || this.drawing.has(chart)) return false;
    this.dirty.delete(chart);
    try {
      this.drawChart(chart);
      return true;
    } finally {
      this.scheduleRemainingWork();
    }
  }

  private drawChart(chart: Drawable) {
    this.drawing.add(chart);
    try { chart.draw(); }
    finally { this.drawing.delete(chart); }
  }

  private hasVisibleDirty() { return [...this.dirty].some(chart => chart.visible); }

  private scheduleRemainingWork() {
    if (this.hasVisibleDirty()) this.request();
    else {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.last = 0;
    }
  }

  private request() {
    if (this.dead || this.frame || document.hidden || !this.hasVisibleDirty()) return;
    this.frame = requestAnimationFrame(time => {
      this.frame = 0;
      if (this.last) this.intervals.push(time - this.last);
      if (this.intervals.length > 2000) this.intervals.shift();
      this.last = time;
      const started=performance.now();this.work.frames++;
      try {
        // A synchronous flush may consume a chart after this callback is queued.
        for (const chart of [...this.dirty]) {
          if (!this.dirty.has(chart) || !chart.visible || this.drawing.has(chart)) continue;
          this.dirty.delete(chart);
          this.drawChart(chart);
          this.work.draws++;
          if(performance.now()-started>=FRAME_WORK_BUDGET_MS){if(this.hasVisibleDirty())this.work.budgetYields++;break;}
        }
      } finally {
        this.work.lastMs=performance.now()-started;this.work.maxMs=Math.max(this.work.maxMs,this.work.lastMs);
        this.scheduleRemainingWork();
      }
    });
  }

  remove(chart: Drawable) {
    this.dirty.delete(chart);
    this.scheduleRemainingWork();
  }

  diagnostics(){return {...this.work,budgetMs:FRAME_WORK_BUDGET_MS,dirty:this.dirty.size,drawing:this.drawing.size};}

  dispose() {
    this.dead = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.dirty.clear();
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
