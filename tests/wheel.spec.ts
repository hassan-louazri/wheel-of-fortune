import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gameConfig } from '../src/config';
import { wheelCases } from './fixtures/wheel';
import { seedOnFirstVisit } from './fixtures/participation';

async function prepareWheel(page: Page, randomValue: number) {
  await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
  await seedOnFirstVisit(page);
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-10-23T12:01:00Z'));
  await page.evaluate((value) => { Math.random = () => value; }, randomValue);
}

async function rotation(page: Page): Promise<number> {
  return page.locator('.wheel-rotor').evaluate((node) => {
    return Number(node.getAttribute('transform')!.match(/rotate\(([^ ]+)/)![1]);
  });
}

async function renderedAlignment(page: Page, index: number) {
  return page.locator('.wheel').evaluate((node, selectedIndex) => {
    const svg = node as SVGSVGElement;
    const pointer = svg.querySelector<SVGPathElement>('.wheel-pointer')!;
    const paths = [...svg.querySelectorAll<SVGPathElement>('.wheel-rotor > g > path')];
    const path = paths[selectedIndex]!;
    const pointerBox = pointer.getBBox();
    const tip = new DOMPoint(pointerBox.x + pointerBox.width / 2, pointerBox.y + pointerBox.height)
      .matrixTransform(pointer.getScreenCTM()!);
    const center = path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!);
    const arcMiddle = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()!);
    const wedgeAngle = Math.atan2(arcMiddle.y - center.y, arcMiddle.x - center.x);
    const pointerAngle = Math.atan2(tip.y - center.y, tip.x - center.x);
    const difference = (wedgeAngle - pointerAngle) * 180 / Math.PI;
    const errorDegrees = Math.abs(((difference + 540) % 360) - 180);
    const probe = new DOMPoint(pointerBox.x + pointerBox.width / 2, pointerBox.y + pointerBox.height + 10)
      .matrixTransform(pointer.getScreenCTM()!);
    const hitIndices = paths.flatMap((wedge, wedgeIndex) => (
      wedge.isPointInFill(probe.matrixTransform(wedge.getScreenCTM()!.inverse())) ? [wedgeIndex] : []
    ));
    return { errorDegrees, hitIndices };
  }, index);
}

test('rotates only the disc, blocks extra spins and waits for animation plus the reveal delay', async ({ page }) => {
  await prepareWheel(page, 0.3);
  const spin = page.getByRole('button', { name: 'Tourner la roue 🎯' });
  const pointer = await page.locator('.wheel-pointer').getAttribute('d');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await spin.click();
  await expect(spin).toBeDisabled();
  await expect(spin).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => { Math.random = () => { throw new Error('Outcome was sampled again'); }; });
  await spin.dispatchEvent('click');
  await page.clock.fastForward(1000);
  const initialRotation = await rotation(page);
  expect(initialRotation).toBeGreaterThan(0);
  expect(initialRotation).toBeLessThan(360);
  await expect(page.locator('.wheel-pointer')).not.toHaveAttribute('transform');
  expect(await page.locator('.wheel-pointer').getAttribute('d')).toBe(pointer);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(gameConfig.spin.durationMs - 1001);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(spin).toBeDisabled();
  await page.clock.fastForward(17);
  const finalRotation = await rotation(page);
  expect(finalRotation).toBeGreaterThanOrEqual(gameConfig.spin.turns * 360);
  expect((((-finalRotation % 360) + 360) % 360) / 45).toBeCloseTo(1.5);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await spin.dispatchEvent('click');
  await page.clock.fastForward(gameConfig.spin.revealDelayMs - 17);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await rotation(page)).toBe(finalRotation);
  await page.clock.fastForward(17);
  await expect(page.getByRole('dialog', { name: /Félicitations/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
});

for (const width of [360, 390, 430]) {
  for (const [index, entry] of wheelCases.entries()) {
    const segment = gameConfig.segments[index]!;
    test(`${width}px selected segment ${entry.id} aligns with the pointer and reveals its own result`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await prepareWheel(page, entry.sample);
      await page.getByRole('button', { name: 'Tourner la roue 🎯' }).click();
      await page.clock.fastForward(gameConfig.spin.durationMs + 16);
      const angle = await rotation(page);
      const measured = await renderedAlignment(page, index);
      await testInfo.attach('alignment', {
        body: JSON.stringify({ id: entry.id, width, sample: entry.sample, rotation: angle, expectedRotation: entry.rotation, ...measured }),
        contentType: 'application/json',
      });
      expect(angle).toBe(entry.rotation);
      expect(measured.hitIndices).toEqual([index]);
      expect(measured.errorDegrees).toBeLessThan(0.001);
      const pointerAngle = ((-angle % 360) + 360) % 360;
      const size = 360 / gameConfig.segments.length;
      expect(Math.floor(pointerAngle / size)).toBe(index);
      expect(pointerAngle - index * size).toBeCloseTo(size / 2);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.clock.fastForward(gameConfig.spin.revealDelayMs);
      if (segment.kind === 'prize') {
        await expect(page.getByRole('dialog', { name: /Félicitations/ })).toBeVisible();
        await expect(page.getByRole('heading', { name: segment.label.fr, exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { name: 'Pas cette fois, Courage !' })).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
    });
  }
}

for (const [index, entry] of wheelCases.slice(0, -1).entries()) {
  const expected = gameConfig.segments[index + 1]!;
  test(`decimal threshold ${entry.upper} selects and renders ${expected.id}`, async ({ page }, testInfo) => {
    await prepareWheel(page, entry.upper);
    await page.getByRole('button', { name: 'Tourner la roue 🎯' }).click();
    await page.clock.fastForward(gameConfig.spin.durationMs + 16);
    const angle = await rotation(page);
    const pointerOffset = ((-angle % 360) + 360) % 360;
    const actualIndex = Math.floor(pointerOffset / (360 / gameConfig.segments.length));
    const actual = gameConfig.segments[actualIndex]!;
    await page.clock.fastForward(gameConfig.spin.revealDelayMs);
    const displayed = actual.kind === 'prize' ? actual.label.fr : 'Pas cette fois, Courage !';
    await expect(page.getByRole('heading', { name: displayed, exact: true })).toBeVisible();
    await testInfo.attach('boundary', {
      body: JSON.stringify({ threshold: entry.upper, expected: expected.id, actual: actual.id, displayed, rotation: angle }),
      contentType: 'application/json',
    });
    expect(actualIndex).toBe(index + 1);
  });
}

test('resizing and language changes preserve the selection, timeline and rotation across the viewport gate', async ({ page }) => {
  await prepareWheel(page, 0.6);
  await page.getByRole('button', { name: 'Tourner la roue 🎯' }).click();
  await page.evaluate(() => { Math.random = () => { throw new Error('Outcome was sampled again'); }; });
  await page.clock.fastForward(1000);
  const beforeResize = await rotation(page);
  await page.setViewportSize({ width: 360, height: 844 });
  await page.getByLabel('Langue').selectOption('en');
  expect(await rotation(page)).toBe(beforeResize);
  await expect(page.getByRole('button', { name: 'Spin the wheel 🎯' })).toBeDisabled();
  await page.setViewportSize({ width: 600, height: 400 });
  await expect(page.getByRole('heading', { name: 'Rotate your screen' })).toBeVisible();
  await expect(page.locator('.wheel-rotor')).toHaveCount(0);
  await page.clock.fastForward(1000);
  await page.setViewportSize({ width: 430, height: 844 });
  expect(await rotation(page)).toBeGreaterThan(beforeResize);
  await expect(page.getByRole('button', { name: 'Spin the wheel 🎯' })).toBeDisabled();
  await page.setViewportSize({ width: 769, height: 1024 });
  await expect(page.getByRole('heading', { name: 'Our game works only on phones and tablets.' })).toBeVisible();
  await page.clock.fastForward(gameConfig.spin.durationMs - 2000 + 16);
  await page.clock.fastForward(gameConfig.spin.revealDelayMs);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog', { name: /Congratulations/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A free coffee', exact: true })).toBeVisible();
  expect((((-await rotation(page) % 360) + 360) % 360) / 45).toBeCloseTo(3.5);
});

test('reduced motion skips intermediate rotation and preserves the selected outcome and delayed reveal', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepareWheel(page, 0.8);
  await page.getByRole('button', { name: 'Tourner la roue 🎯' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(16);
  const finalRotation = await rotation(page);
  expect((((-finalRotation % 360) + 360) % 360) / 45).toBeCloseTo(5.5);
  await page.clock.fastForward(gameConfig.spin.revealDelayMs - 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await rotation(page)).toBe(finalRotation);
  await page.clock.fastForward(1);
  await expect(page.getByRole('heading', { name: 'Une portion de frites', exact: true })).toBeVisible();
});

test('reload recovers the committed winning outcome immediately without replaying animation', async ({ page }) => {
  await prepareWheel(page, 0.3);
  await page.getByRole('button', { name: 'Tourner la roue 🎯' }).click();
  await page.clock.fastForward(1000);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Un dessert offert', exact: true })).toBeVisible();
  expect(await rotation(page)).toBe(2452.5);
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vous avez déjà joué' })).toBeDisabled();
});
