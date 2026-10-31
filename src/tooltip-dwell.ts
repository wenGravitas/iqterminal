/** One cancellable hover dwell gate for a custom data tooltip. */
export class TooltipDwell {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingKey: string | undefined;
  private activeKey: string | undefined;
  private onActivate: (() => void) | undefined;
  private disposed = false;

  constructor(private readonly delayMs = 500) {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('Tooltip dwell delay must be a non-negative finite number.');
  }

  /** Returns true once this target has completed its dwell. Repeated requests update the activation callback. */
  request(key: string, onActivate: () => void): boolean {
    if (this.disposed || !key) return false;
    if (this.activeKey === key) return true;
    if (this.pendingKey === key) {
      this.onActivate = onActivate;
      return false;
    }

    this.cancelTimer();
    this.activeKey = undefined;
    this.pendingKey = key;
    this.onActivate = onActivate;
    this.timer = setTimeout(() => {
      if (this.disposed || this.pendingKey !== key) return;
      this.timer = undefined;
      this.pendingKey = undefined;
      this.activeKey = key;
      const activate = this.onActivate;
      this.onActivate = undefined;
      activate?.();
    }, this.delayMs);
    return false;
  }

  isActive(key: string) { return !this.disposed && this.activeKey === key; }

  clear() {
    this.cancelTimer();
    this.pendingKey = undefined;
    this.activeKey = undefined;
    this.onActivate = undefined;
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
