import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { ServerMessage } from '../../shared/protocol';
import { startIsolatedFakeServer } from './helpers';

async function holdImageDecoding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeImage = window.Image;
    const releases = new Map<number, (fail: boolean) => void>();
    let sequence = 0;
    const ObservedImage = function (width?: number, height?: number) {
      const image = new NativeImage(width, height);
      const decode = image.decode.bind(image);
      image.addEventListener('load', () => {
        if (image.src.endsWith('/thumb/qa-full')) {
          document.documentElement.dataset.qaFullLoaded = 'true';
        }
      });
      image.decode = async () => {
        if (!new URL(image.src, location.href).pathname.startsWith('/thumb/qa-full')) {
          return decode();
        }
        const id = ++sequence;
        const root = document.documentElement;
        const observer = new MutationObserver(() => {
          if (image.hasAttribute('src')) return;
          root.setAttribute(`data-qa-detached-${id}`, 'true');
          observer.disconnect();
        });
        observer.observe(image, { attributes: true, attributeFilter: ['src'] });
        root.setAttribute(`data-qa-started-${id}`, 'true');
        await decode();
        await new Promise<void>((resolve, reject) => {
          releases.set(id, (fail) => {
            releases.delete(id);
            if (fail) reject(new DOMException('Test decode failure', 'EncodingError'));
            else resolve();
          });
          root.setAttribute(`data-qa-decoded-${id}`, 'true');
        });
      };
      return image;
    };
    ObservedImage.prototype = NativeImage.prototype as HTMLImageElement;
    window.Image = ObservedImage as unknown as typeof Image;
    window.addEventListener('qa:release-decode', (event) => {
      const { id, fail } = (event as CustomEvent<{ id: number; fail: boolean }>).detail;
      releases.get(id)?.(fail);
    });
  });
}

async function releaseDecode(page: Page, id: number, fail = false): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute(`data-qa-decoded-${id}`, 'true');
  await page.evaluate(
    async (detail) => {
      window.dispatchEvent(new CustomEvent('qa:release-decode', { detail }));
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    },
    { id, fail },
  );
}

async function installImages(page: Page, holdFirstRequest = false) {
  const full = await sharp({
    create: { width: 400, height: 400, channels: 3, background: '#c8b080' },
  })
    .jpeg()
    .toBuffer();
  const thumbnail = await sharp(full).resize(160).jpeg().toBuffer();
  let requests = 0;
  let publish = () => {};
  let fullUrl = '/thumb/qa-full';
  let label = '';
  let releaseRequest = () => {};
  const pendingRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await holdImageDecoding(page);
  await page.route('**/thumb/qa-*', async (route) => {
    const isFull = new URL(route.request().url()).pathname.startsWith('/thumb/qa-full');
    if (isFull) requests += 1;
    if (isFull && holdFirstRequest && requests === 1) await pendingRequest;
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
            fullUrl,
            label: label || base.label,
          }));
        }
        publish = () => {
          for (const entry of snapshot.view.results?.entries ?? []) {
            if (!entry.isAi) continue;
            entry.thumbs = entry.thumbs.map((thumb) => ({ ...thumb, fullUrl, label }));
          }
          socket.send(JSON.stringify(snapshot));
        };
      }
      socket.send(JSON.stringify(snapshot));
    });
  });
  return {
    requests: () => requests,
    releaseRequest,
    update: (url: string, nextLabel: string) => {
      fullUrl = url;
      label = nextLabel;
      publish();
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
    await releaseDecode(page, 1);
    await expect(modal.locator('img')).toHaveAttribute('src', '/thumb/qa-full');
    await expect(modal.locator('img')).toHaveJSProperty('complete', true);
    await expect(modal.locator('img')).toHaveJSProperty('naturalWidth', 400);
    images.update('/thumb/qa-full', 'Updated snapshot');
    await expect(thumbnail.locator('img')).toHaveAttribute('alt', 'Ход 1: Updated snapshot');
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('Escape');
      await expect(thumbnail).toBeFocused();
      await thumbnail.click();
      await expect(modal.locator('img')).toHaveAttribute('src', '/thumb/qa-full');
      await expect(modal.locator('img')).toHaveJSProperty('complete', true);
    }
    expect(images.requests()).toBe(1);
  } finally {
    await server.stop();
  }
});

// Value: protects=only the current preload may upgrade or invalidate a preview after URL replacement;
// fails_when=old readiness survives replacement or an obsolete decode upgrades or poisons the current URL;
// why_new=the reuse case keeps the full URL stable; seam=none; no_claim=synthetic snapshots and controlled Chromium decode outcomes.
test('ignores obsolete decode outcomes when a full URL returns to the same card', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  const images = await installImages(page);
  try {
    await openBotResults(page, server.hostUrl);
    const root = page.locator('html');
    const thumbnail = page.locator('.thumb-btn').first();
    const preview = page.getByRole('dialog', { name: 'Снимок бота' }).locator('img');
    await expect(root).toHaveAttribute('data-qa-decoded-1', 'true');
    const replaceSnapshot = async (id: number, url: string): Promise<void> => {
      images.update(url, `Snapshot ${id}`);
      await expect(thumbnail.locator('img')).toHaveAttribute('alt', `Ход 1: Snapshot ${id}`);
      await expect(root).toHaveAttribute(`data-qa-decoded-${id}`, 'true');
    };
    await replaceSnapshot(2, '/thumb/qa-full-other');
    await releaseDecode(page, 2);
    await thumbnail.click();
    await expect(preview).toHaveAttribute('src', '/thumb/qa-full-other');
    await page.keyboard.press('Escape');
    await replaceSnapshot(3, '/thumb/qa-full');
    await replaceSnapshot(4, '/thumb/qa-full-other');
    await thumbnail.click();
    await expect(preview).toHaveAttribute('src', '/thumb/qa-thumb');
    await page.keyboard.press('Escape');
    await replaceSnapshot(5, '/thumb/qa-full');
    await thumbnail.click();
    await expect(preview).toHaveAttribute('src', '/thumb/qa-thumb');
    await releaseDecode(page, 1);
    await expect(preview).toHaveAttribute('src', '/thumb/qa-thumb');
    await releaseDecode(page, 3, true);
    await releaseDecode(page, 5);
    await expect(preview).toHaveAttribute('src', '/thumb/qa-full');
    await expect(preview).toHaveJSProperty('naturalWidth', 400);
  } finally {
    await server.stop();
  }
});

// Value: protects=closing bot details detaches a pending full source and reopening displays the new preload;
// fails_when=the abandoned source remains attached or a reopened card cannot show the full image;
// why_new=other card interactions close after preload settles; seam=none; no_claim=observes source detachment in Chromium with a routed response.
test('releases a pending preview image when closing the bot card', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  const images = await installImages(page, true);
  try {
    await openBotResults(page, server.hostUrl);
    const root = page.locator('html');
    const card = page.locator('.bot-card');
    await expect.poll(images.requests).toBe(1);
    await expect(root).toHaveAttribute('data-qa-started-1', 'true');
    await card.getByRole('button', { name: 'свернуть' }).click();
    await expect(card).toHaveCount(0);
    await expect(root).toHaveAttribute('data-qa-detached-1', 'true');
    images.releaseRequest();
    await page.getByRole('button', { name: 'почему?' }).first().click();
    await releaseDecode(page, 2);
    await card.locator('.thumb-btn').first().click();
    const preview = page.getByRole('dialog', { name: 'Снимок бота' }).locator('img');
    await expect(preview).toHaveAttribute('src', '/thumb/qa-full');
    await expect(preview).toHaveJSProperty('naturalWidth', 400);
  } finally {
    images.releaseRequest();
    await server.stop();
  }
});
