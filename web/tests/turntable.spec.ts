import { expect, test, type Locator, type Page } from '@playwright/test';
import { spinMotion } from '../src/lib/orbit/spin';
import type { StageMessage, StageState } from '../src/lib/orbit/types';
import { startIsolatedFakeServer } from './helpers';

declare global {
  interface Window {
    turntableFrames: Map<number, StageState>;
  }
}

async function join(page: Page, url: string, phone = false): Promise<void> {
  await page.addInitScript(() => {
    window.turntableFrames = new Map();
    window.Worker = class extends Worker {
      override postMessage(message: StageMessage): void {
        if (message.state) window.turntableFrames.set(message.id, message.state);
        else window.turntableFrames.delete(message.id);
        super.postMessage(message);
      }
    };
  });
  await page.goto(url);
  if (phone) await page.getByRole('button', { name: 'Всё равно войти' }).tap();
  await page.getByLabel('Ваше имя').fill('Полина');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
  await expect(page.locator('article canvas[data-avatar-renderer]').first()).toBeVisible();
}

async function preview(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Открыть гардероб: Полина' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('canvas[data-avatar-renderer]')).toBeVisible();
  return dialog.getByRole('button', { name: 'Повернуть на 360°: Полина' });
}

function latest(page: Page): Promise<StageState> {
  return page.evaluate(() => Array.from(window.turntableFrames.values()).at(-1) as StageState);
}

async function center(button: Locator) {
  return button.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x: x + width * 0.5, y: y + height * 0.5, scale: Math.PI / Math.max(96, width * 0.75) };
  });
}

test('a wardrobe drag changes the rendered view, preserves precise keyboard control and leaves the stage alone', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await join(page, server.hostUrl);
    const button = await preview(page);
    const canvas = page.getByRole('dialog').locator('canvas[data-avatar-renderer]');
    const pixels = () => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    const before = await pixels();
    const { x, y, scale } = await center(button);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y + 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await latest(page)).yaw).toBeCloseTo(45 * scale, 2);
    await expect.poll(pixels).not.toBe(before);
    expect((await latest(page)).gesture).toBeNull();
    await button.press('Shift+ArrowLeft');
    await expect
      .poll(async () => (await latest(page)).yaw)
      .toBeCloseTo(45 * scale - Math.PI / 180, 2);
    await button.press('Enter');
    await expect(
      page.getByRole('dialog').getByRole('img', { name: 'Предпросмотр: Полина' }),
    ).toHaveAttribute('data-avatar-gesture', 'spin');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await latest(page)).yaw).toBe(0);
  } finally {
    await server.stop();
  }
});

test('the local rig tracks cursor direction and dragging interrupts an in-flight preview spin at its current angle', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  try {
    await join(page, server.hostUrl);
    const actor = (base: string) =>
      page.evaluate(
        (base) =>
          Array.from(window.turntableFrames.values()).find(
            (state) => state.appearance.base === base,
          ),
        base,
      );
    await page.mouse.move(3, 140);
    await expect.poll(async () => (await actor('human'))?.gazeX).toBeLessThan(-0.4);
    await page.mouse.move(1260, 140);
    await expect.poll(async () => (await actor('human'))?.gazeX).toBeGreaterThan(0.4);
    expect((await actor('human'))?.yaw).toBe(0);
    expect((await actor('robot'))?.gazeX).toBe(0);
    expect((await actor('robot'))?.yaw).toBeLessThan(0);
    const button = await preview(page);
    await page.clock.setFixedTime(Date.now());
    await button.click();
    await expect.poll(async () => (await latest(page)).gesture?.kind).toBe('spin');
    const spin = (await latest(page)).gesture;
    if (!spin) throw new Error('Preview spin did not start');
    const { x, y, scale } = await center(button);
    await page.mouse.move(x, y);
    await page.mouse.down();
    const catchTime = spin.at + 230;
    await page.clock.setFixedTime(catchTime);
    await page.mouse.move(x + 12, y);
    await page.mouse.up();
    const expected = spinMotion(spin, catchTime).angle + 12 * scale;
    await expect.poll(async () => (await latest(page)).yaw).toBeCloseTo(expected, 2);
    expect((await latest(page)).gesture).toBeNull();
  } finally {
    await server.stop();
  }
});

test('a cancelled touch drag keeps the chosen view and the next tap still spins', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const page = await browser.newPage({ hasTouch: true, viewport: { width: 450, height: 800 } });
  try {
    await join(page, server.hostUrl, true);
    const button = await preview(page);
    const { x, y, scale } = await center(button);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + 40, y }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(async () => (await latest(page)).yaw).toBeCloseTo(40 * scale, 2);
    expect((await latest(page)).gesture).toBeNull();
    await button.tap();
    await expect.poll(async () => (await latest(page)).gesture?.kind).toBe('spin');
  } finally {
    await page.close();
    await server.stop();
  }
});
