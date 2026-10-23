export function easeInOutCubic(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

export class WheelAnimation {
  rotation = 0;
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private run: object | null = null;

  constructor(private readonly onUpdate: (rotation: number) => void) {}

  get busy(): boolean { return this.run !== null; }

  start(target: number, durationMs: number, revealDelayMs: number, onComplete: () => void): boolean {
    if (this.busy) return false;
    const run = {};
    this.run = run;
    const from = this.rotation;
    const started = performance.now();
    const update = (now: number) => {
      if (this.run !== run) return;
      const progress = durationMs === 0 ? 1 : Math.min(1, Math.max(0, (now - started) / durationMs));
      this.rotation = from + (target - from) * easeInOutCubic(progress);
      this.onUpdate(this.rotation);
      if (progress < 1) {
        this.frame = requestAnimationFrame(update);
      } else {
        this.frame = null;
        this.timer = setTimeout(() => {
          if (this.run !== run) return;
          this.run = null;
          this.timer = null;
          onComplete();
        }, revealDelayMs);
      }
    };
    this.frame = requestAnimationFrame(update);
    return true;
  }

  cancel(): void {
    this.run = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.timer !== null) clearTimeout(this.timer);
    this.frame = null;
    this.timer = null;
  }
}
