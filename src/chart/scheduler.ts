export interface Drawable { visible: boolean; draw(): void }

/** Coalesces chart invalidations into one frame for all visible panels. */
export class Scheduler {
  private readonly dirty = new Set<Drawable>();
  private readonly drawing = new Set<Drawable>();
  private frame = 0;
  private dead = false;
  readonly intervals: number[] = [];
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
      try {
        // A synchronous flush may consume a chart after this callback is queued.
        for (const chart of [...this.dirty]) {
          if (!this.dirty.has(chart) || !chart.visible || this.drawing.has(chart)) continue;
          this.dirty.delete(chart);
          this.drawChart(chart);
        }
      } finally {
        this.scheduleRemainingWork();
      }
    });
  }

  remove(chart: Drawable) {
    this.dirty.delete(chart);
    this.scheduleRemainingWork();
  }

  dispose() {
    this.dead = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.dirty.clear();
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
