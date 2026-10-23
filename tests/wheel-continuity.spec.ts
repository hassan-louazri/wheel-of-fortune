import { expect, test } from '@playwright/test';
import { gameConfig } from '../src/config';
import { rotationForSegment } from '../src/game/geometry';
import { selectSegment } from '../src/game/selection';
import { wheelCases } from './fixtures/wheel';
import { seedOnFirstVisit } from './fixtures/participation';

test.skip(process.env.PLAYWRIGHT_DEV_SERVER !== '1', 'Loads the existing controller module through Vite for a test-owned SVG driver.');

for (const width of [360, 390, 430]) {
  test(`${width}px consecutive controller spins preserve the rendered SVG rotation`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
    await seedOnFirstVisit(page);
    await page.goto('/');
    await page.clock.pauseAt(new Date('2026-10-23T12:01:00Z'));
    const controller = await page.evaluateHandle(async () => {
      const modulePath = '/src/game/animation.ts';
      const { WheelAnimation } = await import(modulePath) as typeof import('../src/game/animation');
      const rotor = document.querySelector('.wheel-rotor')!;
      return new WheelAnimation((angle) => rotor.setAttribute('transform', `rotate(${angle} 180 185)`));
    });
    const measured: { id: string; from: number; to: number }[] = [];
    try {
      for (const entry of [...wheelCases, wheelCases[0]]) {
        const previous = await controller.evaluate((animation) => animation.rotation);
        const index = selectSegment(gameConfig.segments, entry.sample);
        const target = rotationForSegment(index, gameConfig.segments.length, previous, gameConfig.spin.turns);
        expect(await controller.evaluate((animation, spin) => (
          animation.start(spin.target, spin.durationMs, spin.revealDelayMs, () => {})
        ), { target, ...gameConfig.spin })).toBe(true);
        const before = await page.locator('.wheel-rotor').getAttribute('transform');
        expect(before).toBe(`rotate(${previous} 180 185)`);
        await page.clock.runFor(16);
        const firstFrame = await controller.evaluate((animation) => animation.rotation);
        expect(firstFrame).toBeGreaterThanOrEqual(previous);
        expect(firstFrame - previous).toBeLessThan(0.01);
        await page.clock.fastForward(gameConfig.spin.durationMs + 16);
        expect(await controller.evaluate((animation) => animation.rotation)).toBe(target);
        expect(await page.locator('.wheel-rotor').getAttribute('transform')).toBe(`rotate(${target} 180 185)`);
        expect(target - previous).toBeGreaterThanOrEqual(gameConfig.spin.turns * 360);
        expect(target % 360).toBe(entry.rotation % 360);
        await page.clock.fastForward(gameConfig.spin.revealDelayMs);
        measured.push({ id: entry.id, from: previous, to: target });
      }
      await testInfo.attach('continuity', { body: JSON.stringify({ width, spins: measured }), contentType: 'application/json' });
    } finally {
      await controller.evaluate((animation) => animation.cancel());
      await controller.dispose();
    }
  });
}
