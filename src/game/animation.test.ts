import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { easeInOutCubic, WheelAnimation } from './animation';
import { rotationForSegment } from './geometry';
import { gameConfig } from '../config';
import { wheelCases } from '../../tests/fixtures/wheel';

let frame: FrameRequestCallback;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('animation controller', () => {
  it('preserves angle and clockwise continuity for all 64 configured segment pairs', () => {
    for (const [firstIndex, firstCase] of wheelCases.entries()) {
      for (const [nextIndex, nextCase] of wheelCases.entries()) {
        const update = vi.fn();
        const complete = vi.fn();
        const animation = new WheelAnimation(update);
        const { durationMs, revealDelayMs, turns } = gameConfig.spin;
        vi.mocked(performance.now).mockReturnValue(0);
        animation.start(rotationForSegment(firstIndex, wheelCases.length, 0, turns), durationMs, revealDelayMs, complete);
        frame(durationMs);
        vi.advanceTimersByTime(revealDelayMs);
        expect(animation.rotation).toBe(firstCase.rotation);
        const previous = animation.rotation;
        const target = rotationForSegment(nextIndex, wheelCases.length, previous, turns);
        const now = durationMs + revealDelayMs;
        vi.mocked(performance.now).mockReturnValue(now);
        expect(animation.start(target, durationMs, revealDelayMs, complete)).toBe(true);
        frame(now);
        expect(update).toHaveBeenLastCalledWith(previous);
        frame(now + durationMs / 2);
        expect(animation.rotation).toBeGreaterThan(previous);
        frame(now + durationMs);
        vi.advanceTimersByTime(revealDelayMs);
        expect(animation.rotation).toBeGreaterThanOrEqual(previous + turns * 360);
        expect(animation.rotation % 360).toBe(nextCase.rotation % 360);
        expect(complete).toHaveBeenCalledTimes(2);
      }
    }
  });

  it('accelerates smoothly, decelerates and only reveals after completion plus the result delay', () => {
    const update = vi.fn();
    const done = vi.fn();
    const animation = new WheelAnimation(update);
    animation.start(2400, 16000, 2000, done);
    frame(0);
    expect(animation.rotation).toBe(0);
    frame(4000);
    expect(animation.rotation).toBe(150);
    frame(8000);
    expect(animation.rotation).toBe(1200);
    frame(12000);
    expect(animation.rotation).toBe(2250);
    expect(done).not.toHaveBeenCalled();
    frame(16000);
    expect(animation.rotation).toBe(2400);
    expect(animation.busy).toBe(true);
    vi.advanceTimersByTime(1999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(animation.busy).toBe(false);
    frame(17000);
    vi.runAllTimers();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('blocks repeated attempts both during rotation and while waiting to reveal', () => {
    const first = vi.fn();
    const second = vi.fn();
    const animation = new WheelAnimation(vi.fn());
    expect(animation.start(2400, 16000, 2000, first)).toBe(true);
    expect(animation.start(5000, 1, 0, second)).toBe(false);
    frame(16000);
    expect(animation.start(5000, 1, 0, second)).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    const next = rotationForSegment(5, 8, animation.rotation, 6);
    expect(animation.start(next, 16000, 2000, second)).toBe(true);
    frame(0);
    expect(animation.rotation).toBe(2400);
    frame(16000);
    vi.advanceTimersByTime(2000);
    expect(animation.rotation).toBe(next);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it.each(['rotation', 'reveal'])('cancels during %s and ignores stale callbacks without a result', (phase) => {
    const done = vi.fn();
    const animation = new WheelAnimation(vi.fn());
    animation.start(2400, 16000, 2000, done);
    frame(phase === 'rotation' ? 500 : 16000);
    const stale = frame;
    animation.cancel();
    stale(20000);
    vi.runAllTimers();
    expect(done).not.toHaveBeenCalled();
    expect(animation.busy).toBe(false);
    expect(animation.start(5000, 16000, 2000, done)).toBe(true);
    stale(20000);
    vi.runAllTimers();
    expect(done).not.toHaveBeenCalled();
  });

  it('skips motion for reduced motion while preserving final angle and reveal ordering', () => {
    const update = vi.fn();
    const done = vi.fn();
    const animation = new WheelAnimation(update);
    animation.start(2452.5, 0, 2000, done);
    expect(update).not.toHaveBeenCalled();
    frame(0);
    expect(update).toHaveBeenCalledExactlyOnceWith(2452.5);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('has zero speed at the ends and a monotonic smooth easing curve', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.001)).toBeLessThan(0.00001);
    expect(1 - easeInOutCubic(0.999)).toBeLessThan(0.00001);
    let previous = 0;
    for (let step = 1; step <= 100; step++) {
      const next = easeInOutCubic(step / 100);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });
});
