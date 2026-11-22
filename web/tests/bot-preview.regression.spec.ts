import { expect, test, type Page } from '@playwright/test';
import type { ServerMessage } from '../../shared/protocol';
import { startIsolatedFakeServer } from './helpers';

async function openBotCard(page: Page, url: string, journal = false): Promise<void> {
  await page.routeWebSocket('**/*', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (typeof message !== 'string') {
        socket.send(message);
        return;
      }
      const state = JSON.parse(message) as ServerMessage;
      if (state.type === 'state' && state.view.results) {
        for (const entry of state.view.results.entries) {
          if (!entry.isAi || !entry.thumbs[0]) continue;
          const paidFrame = entry.journal?.steps.find((s) => s.kind !== 'observe')?.frames[0];
          if (journal && paidFrame) paidFrame.fullUrl = '/slow-full';
          if (journal) continue;
          delete entry.journal;
          entry.thumbs[0].fullUrl = '/slow-full';
        }
      }
      socket.send(JSON.stringify(state));
    });
  });
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const map = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(map).toBeVisible({ timeout: 12_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'почему?' }).first().click();
}

// QA attribution: /tmp/geoaissr-qa-20261116/qa-report-geoaissr-2026-11-16.md
// protects=immediate snapshot display with slow or failing full image; fails_when=full image starts only on click or blank preview replaces cached thumbnail; why_new=existing tests only inspect the preview after opening; seam=none; no_claim=provider latency.
for (const fail of [false, true]) {
  test(`prefetches full image and keeps preview visible while ${fail ? 'failing' : 'loading'}`, async ({
    page,
  }, testInfo) => {
    const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    try {
      await page.route('**/slow-full', async (route) => {
        requested = true;
        await pending;
        if (fail) await route.abort();
        else
          await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"/>',
          });
      });
      await openBotCard(page, server.hostUrl);
      await expect.poll(() => requested).toBe(true);
      const first = page.locator('.bot-card .thumb-btn').first();
      const thumbnail = first.locator('img');
      const thumb = await thumbnail.getAttribute('src');
      await expect
        .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
      await first.click();
      const image = page.locator('.zoomed-preview img');
      await expect(image).toHaveAttribute('src', thumb ?? '');
      await expect(image).toBeVisible();
      expect(
        await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      ).toBeGreaterThan(0);
      if (!fail)
        await testInfo.attach('slow-preview', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      const failedRequest = fail
        ? page.waitForEvent('requestfailed', (request) => request.url().endsWith('/slow-full'))
        : null;
      release();
      if (failedRequest) {
        await failedRequest;
        await expect(image).toHaveAttribute('src', thumb ?? '');
        await expect(image).toBeVisible();
        expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(
          0,
        );
      } else await expect(image).toHaveAttribute('src', '/slow-full');
      await page.keyboard.press('Escape');
      await expect(image).toHaveCount(0);
    } finally {
      release();
      await server.stop();
    }
  });
}

// Value: protects=the journal preview shows the step's loaded thumbnail at once and switches to the full frame when it is ready; fails_when=the dialog stays blank while the full frame loads or the thumbnail is replaced by nothing; why_new=the slow-full test only covered the legacy timeline; seam=none; no_claim=provider latency.
test('journal preview shows the thumbnail while the full frame loads', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.route('**/slow-full', async (route) => {
      await pending;
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"/>',
      });
    });
    await openBotCard(page, server.hostUrl, true);
    const card = page.locator('.bot-card');
    await card.getByRole('button', { name: /^Ход за ходом/ }).click();
    const frame = card.getByRole('button', { name: /^Кадр шага 1:/ });
    const thumb = await frame.locator('img').getAttribute('src');
    await expect
      .poll(() => frame.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await frame.click();
    const image = page.locator('.zoomed-preview img');
    await expect(image).toHaveAttribute('src', thumb ?? '');
    await expect(image).toBeVisible();
    release();
    await expect(image).toHaveAttribute('src', '/slow-full');
    await page.keyboard.press('Escape');
    await expect(image).toHaveCount(0);
  } finally {
    release();
    await server.stop();
  }
});
