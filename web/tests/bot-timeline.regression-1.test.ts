import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { ServerMessage } from '../../shared/protocol';
import { startIsolatedFakeServer } from './helpers';

async function holdImageDecoding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeImage = window.Image;
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ObservedImage = function (width?: number, height?: number) {
      const image = new NativeImage(width, height);
      const decode = image.decode.bind(image);
      image.addEventListener('load', () => {
        if (image.src.endsWith('/thumb/qa-full')) {
          document.documentElement.dataset.qaFullLoaded = 'true';
        }
      });
      image.decode = async () => {
        await decode();
        if (image.src.endsWith('/thumb/qa-full')) await pending;
      };
      return image;
    };
    ObservedImage.prototype = NativeImage.prototype as HTMLImageElement;
    window.Image = ObservedImage as unknown as typeof Image;
    window.addEventListener('qa:release-decode', () => {
      release();
    });
  });
}

async function installImages(page: Page) {
  const full = await sharp({
    create: { width: 400, height: 400, channels: 3, background: '#c8b080' },
  })
    .jpeg()
    .toBuffer();
  const thumbnail = await sharp(full).resize(160).jpeg().toBuffer();
  let requests = 0;
  let update = () => {};
  await holdImageDecoding(page);
  await page.route('**/thumb/qa-*', async (route) => {
    const isFull = route.request().url().endsWith('/qa-full');
    if (isFull) requests += 1;
    await route.fulfill({
      contentType: 'image/jpeg',
      headers: { 'cache-control': 'no-store' },
      body: isFull ? full : thumbnail,
    });
  });
  await page.routeWebSocket('**/*', (socket) => {
    const upstream = socket.connectToServer();
    upstream.onMessage((message) => {
      if (typeof message !== 'string') {
        socket.send(message);
        return;
      }
      const snapshot = JSON.parse(message) as ServerMessage;
      if (snapshot.type === 'state' && snapshot.view.results) {
        for (const entry of snapshot.view.results.entries) {
          const base = entry.isAi && entry.thumbs[0];
          if (!base) continue;
          entry.thumbs = [1, 2].map((turn) => ({
            ...base,
            turn,
            thumbUrl: '/thumb/qa-thumb',
            fullUrl: '/thumb/qa-full',
          }));
        }
        update = () => {
          socket.send(JSON.stringify(snapshot));
        };
      }
      socket.send(JSON.stringify(snapshot));
    });
  });
  return {
    requests: () => requests,
    update: () => {
      update();
    },
  };
}

async function openBotResults(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const map = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(map).toBeVisible({ timeout: 12_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await page.getByRole('button', { name: 'почему?' }).first().click();
}

// Regression: full snapshots must be decoded before replacing the loaded thumbnail.
// Found by /qa on 2026-11-17; narrowed against current main during /ship on 2026-11-19.
// Value: protects=decode readiness and retained no-store image reuse; fails_when=onload selects full before decode or updates/reopening refetch; why_new=base tests delay HTTP only; seam=none; no_claim=synthetic JPEG and decode gate, Chromium only.
test('waits for decoded preloads and reuses them across snapshots and reopening', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  const images = await installImages(page);
  try {
    await openBotResults(page, server.hostUrl);
    await expect(page.locator('html')).toHaveAttribute('data-qa-full-loaded', 'true');
    expect(images.requests()).toBe(1);
    const thumbnail = page.locator('.thumb-btn').first();
    const modal = page.getByRole('dialog', { name: 'Снимок бота' });
    await expect(modal).toHaveCount(0);
    await thumbnail.click();
    await expect(modal).toBeVisible();
    await expect(modal.locator('img')).toHaveAttribute('src', '/thumb/qa-thumb');
    await expect(modal.locator('img')).toHaveJSProperty('naturalWidth', 160);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('qa:release-decode'));
    });
    await expect(modal.locator('img')).toHaveAttribute('src', '/thumb/qa-full');
    await expect(modal.locator('img')).toHaveJSProperty('complete', true);
    await expect(modal.locator('img')).toHaveJSProperty('naturalWidth', 400);
    images.update();
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('Escape');
      await expect(thumbnail).toBeFocused();
      await thumbnail.click();
      await expect(modal.locator('img')).toHaveAttribute('src', '/thumb/qa-full');
      await expect(modal.locator('img')).toHaveJSProperty('complete', true);
    }
    expect(images.requests()).toBe(1);
  } finally {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('qa:release-decode'));
    });
    await server.stop();
  }
});
