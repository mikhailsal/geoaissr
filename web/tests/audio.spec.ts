import { expect, test, type Page } from '@playwright/test';
import { AUDIO } from '../src/lib/audio-catalog';
import { observeAudio, trace } from './audio-observer';
import { assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

// Value: protects=packaged audio decodes and follows actual game and browser lifecycle; fails_when=files fail to decode or events/mutes/reconnect route incorrect sources; why_new=existing browser tests had no audio assertions; seam=none; no_claim=native headless graphs cannot judge subjective loudness; visibility events are synthetic boundary events.

async function join(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}
async function startRound(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByTestId('fake-guess-map').locator('canvas')).toBeVisible({
    timeout: 12_000,
  });
}
async function started(page: Page, name: string): Promise<void> {
  await expect
    .poll(async () => (await trace(page)).starts.some((s) => s.url.endsWith(`/${name}.ogg`)))
    .toBe(true);
}
async function submit(page: Page): Promise<void> {
  await page
    .getByTestId('fake-guess-map')
    .locator('canvas')
    .click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await expect(page.getByRole('button', { name: 'К итогам' })).toBeVisible({ timeout: 12_000 });
}

test('native audio follows the round and mute controls', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await observeAudio(page);
    await page.goto(server.hostUrl);
    expect((await trace(page)).starts).toEqual([]);
    await page.getByLabel('Ваше имя').fill('Оля');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: 'Звуковые эффекты' }).click();
    await page.getByRole('button', { name: 'Звуковые эффекты' }).click();
    await expect.poll(async () => new Set((await trace(page)).decoded).size).toBe(13);
    expect(new Set((await trace(page)).decoded.map((url) => url.split('/').pop()))).toEqual(
      new Set(Object.values(AUDIO).map(([file]) => `${file}.ogg`)),
    );
    await startRound(page);
    for (const sound of [
      'loading-round',
      'soft-countdown',
      'effect-new-round',
      'round-loop-suspense',
    ]) {
      await started(page, sound);
    }
    const music = (await trace(page)).starts.find((s) =>
      s.url.endsWith('/round-loop-suspense.ogg'),
    );
    expect(music).toMatchObject({ loop: true });
    await page
      .getByTestId('fake-guess-map')
      .locator('canvas')
      .click({ position: { x: 100, y: 100 } });
    await started(page, 'place-guess-land');
    await page.getByRole('button', { name: 'Звуковые эффекты' }).click();
    await expect
      .poll(async () =>
        Object.values((await trace(page)).live).every((url) =>
          url.endsWith('/round-loop-suspense.ogg'),
        ),
      )
      .toBe(true);
    expect(Object.values((await trace(page)).live)).toContainEqual(
      expect.stringContaining('round-loop-suspense'),
    );
    await page.getByRole('button', { name: 'Музыка раунда' }).click();
    await expect.poll(async () => Object.keys((await trace(page)).live).length).toBe(0);
    await page.getByRole('button', { name: 'Звуковые эффекты' }).click();
    await page.getByRole('button', { name: 'Угадать' }).click();
    await expect(page.getByRole('button', { name: 'К итогам' })).toBeVisible({ timeout: 12_000 });
    await started(page, 'effect-guess-locked');
    await started(page, 'round-end');
    await page.getByRole('button', { name: 'К итогам' }).click();
    await started(page, 'game_end');
    await page.waitForTimeout(1_200);
    const events = (await trace(page)).starts;
    for (const name of ['effect-new-round', 'effect-guess-locked', 'round-end', 'game_end']) {
      expect(events.filter((s) => s.url.endsWith(`/${name}.ogg`))).toHaveLength(1);
    }
    expect((await trace(page)).errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

test('mute preferences persist and controls fit the header', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await join(page, server.hostUrl);
    const effects = page.getByRole('button', { name: 'Звуковые эффекты' });
    const music = page.getByRole('button', { name: 'Музыка раунда' });
    await effects.click();
    await music.click();
    await page.reload();
    await expect(effects).toHaveAttribute('aria-pressed', 'false');
    await expect(music).toHaveAttribute('aria-pressed', 'false');
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 720 });
      for (const control of [effects, music]) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        if (!box) throw new Error('Missing sound control bounds');
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await assertNoHorizontalOverflow(page);
    }
  } finally {
    await server.stop();
  }
});

for (const failure of ['404', 'unavailable'] as const) {
  test(`gameplay works with audio ${failure}`, async ({ page }) => {
    const server = await startIsolatedFakeServer({ rounds: 1 });
    try {
      if (failure === '404')
        await page.route('**/audio/*.ogg', (route) => route.fulfill({ status: 404 }));
      else
        await page.addInitScript(() => {
          Object.defineProperty(window, 'AudioContext', { value: undefined });
        });
      const errors: string[] = [];
      await page.addInitScript(() => {
        window.addEventListener('unhandledrejection', (event) => {
          document.documentElement.dataset.audioError = String(event.reason);
        });
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await join(page, server.hostUrl);
      await startRound(page);
      await submit(page);
      expect(errors).toEqual([]);
      expect(await page.locator('html').getAttribute('data-audio-error')).toBeNull();
    } finally {
      await server.stop();
    }
  });
}

async function setVisibility(page: Page, state: 'visible' | 'hidden'): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('hidden and reconnecting games stop audio and resume only current music', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await page.routeWebSocket('**/*', (socket) => {
      socket.connectToServer();
      disconnect = async () => {
        await socket.close({ code: 1012, reason: 'Fixture reconnect' });
      };
    });
    await observeAudio(page);
    await join(page, server.hostUrl);
    await startRound(page);
    await started(page, 'round-loop-suspense');
    await setVisibility(page, 'hidden');
    await expect.poll(async () => Object.keys((await trace(page)).live).length).toBe(0);
    await setVisibility(page, 'visible');
    await expect
      .poll(async () =>
        Object.values((await trace(page)).live).some((u) => u.includes('round-loop')),
      )
      .toBe(true);
    if (!disconnect) throw new Error('Missing fixture socket');
    await disconnect();
    await expect.poll(async () => Object.keys((await trace(page)).live).length).toBe(0);
    await expect
      .poll(async () =>
        Object.values((await trace(page)).live).some((u) => u.includes('round-loop')),
      )
      .toBe(true);
    await submit(page);
    await started(page, 'round-end');
    expect(Object.values((await trace(page)).live).some((u) => u.includes('round-loop'))).toBe(
      false,
    );
    expect(
      (await trace(page)).starts.filter((s) => s.url.includes('effect-new-round')),
    ).toHaveLength(1);
    expect((await trace(page)).errors).toEqual([]);
  } finally {
    await server.stop();
  }
});
