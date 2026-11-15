// Value: protects=bot card zoom preview loads fullUrl with responsive CSS limits and broken thumb suppresses zoom; fails_when=zoomed preview ignores fullUrl or CSS sizing regresses or broken thumb still renders button; why_new=game-flow verified thumb presence but omitted CSS constraints, full-res naturalWidth, and broken thumb fallback; seam=none; no_claim=does not assert visual image canvas pixels or network disconnection timing
import { expect, test, type Page } from '@playwright/test';
import {
  assertAxeClean,
  assertNoHorizontalOverflow,
  startIsolatedFakeServer,
  trackMapLoadedMessages,
  type StartedFakeApp,
} from './helpers';

let server: StartedFakeApp | undefined;

function getServer(): StartedFakeApp {
  if (!server) throw new Error('E2E server was not initialized');
  return server;
}

test.beforeAll(async () => {
  server = await startIsolatedFakeServer({ seedBot: true, rounds: 2 });
});

test.afterAll(async () => {
  await server?.stop();
});

async function joinPlayer(page: Page, url: string, nick: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByLabel('Ваше имя')).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('#t=');
  await page.getByLabel('Ваше имя').fill(nick);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText(/ИГРОКИ/)).toBeVisible();
}

async function placePinOnFakeMap(page: Page, offsetX: number, offsetY: number): Promise<void> {
  const canvas = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(canvas).toBeVisible();
  // Hover expands the dock with a CSS transition; measure only once its size has settled.
  await canvas.hover();
  let box = await canvas.boundingBox();
  await expect
    .poll(async () => {
      const prev = box;
      box = await canvas.boundingBox();
      return (
        prev !== null && box !== null && prev.width === box.width && prev.height === box.height
      );
    })
    .toBe(true);
  expect(box).toBeTruthy();
  if (box) {
    await page.mouse.click(box.x + offsetX, box.y + offsetY);
  }
  await expect(page.getByRole('button', { name: 'Угадать' })).toBeEnabled();
}

async function playRoundOne(hostPage: Page, guestPage: Page): Promise<void> {
  await expect(hostPage.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
  await expect(guestPage.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
  await assertAxeClean(hostPage, 'Round');
  await assertNoHorizontalOverflow(hostPage);
  await assertNoHorizontalOverflow(guestPage);

  await placePinOnFakeMap(hostPage, 140, 110);
  await hostPage.keyboard.press('Enter');
  await expect(hostPage.getByText(/Ответ принят/)).toBeVisible();

  await placePinOnFakeMap(guestPage, 160, 120);
  await guestPage.getByRole('button', { name: 'Угадать' }).click();

  await expect(hostPage.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
  await expect(guestPage.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
  await hostPage.keyboard.press('Space');
  await assertAxeClean(hostPage, 'RoundResults');
  await assertNoHorizontalOverflow(hostPage);

  await assertBotCardInteractions(hostPage);
}

async function assertBotCardInteractions(hostPage: Page): Promise<void> {
  const whyBtn = hostPage.getByRole('button', { name: 'почему?' }).first();
  await whyBtn.click();
  await expect(hostPage.locator('.bot-card')).toBeVisible();
  // All four start frames (N, E, S, W) are shown, not only the first one.
  expect(await hostPage.locator('.bot-card .thumb-item').count()).toBeGreaterThanOrEqual(4);
  const firstThumb = hostPage.locator('.bot-card .thumb-btn').first();
  await firstThumb.click();
  const zoomedImg = hostPage.locator('.zoomed-preview img');
  await expect(zoomedImg).toBeVisible();
  expect(await zoomedImg.getAttribute('src')).toMatch(/^\/thumb\//);
  await expect(zoomedImg).toHaveCSS('max-height', '640px');
  await expect(zoomedImg).toHaveCSS('max-width', '100%');
  await expect(zoomedImg).toHaveCSS('object-fit', 'contain');
  await expect(async () => {
    const nw = await zoomedImg.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(nw).toBeGreaterThan(160);
  }).toPass();
  // When the full-res zoomed image errors, it falls back to the 160px thumbUrl.
  const fullSrc = await zoomedImg.getAttribute('src');
  const thumbSrc = await firstThumb.locator('img').getAttribute('src');
  expect(fullSrc).not.toBe(thumbSrc);
  await zoomedImg.dispatchEvent('error');
  await expect(zoomedImg).toBeVisible();
  expect(await zoomedImg.getAttribute('src')).toBe(thumbSrc);
  await firstThumb.click();
  await expect(zoomedImg).toHaveCount(0);

  const secondThumb = hostPage.locator('.bot-card .thumb-item').nth(1);
  await secondThumb.locator('img').dispatchEvent('error');
  await expect(secondThumb.locator('.thumb-fallback')).toBeVisible();
  await expect(secondThumb.locator('.thumb-fallback')).toHaveText(
    'Снимки этого раунда уже удалены',
  );
  await expect(secondThumb.locator('.thumb-btn')).toHaveCount(0);
  await expect(hostPage.locator('.zoomed-preview')).toHaveCount(0);

  await hostPage.keyboard.press('Escape');
  await expect(hostPage.locator('.bot-card')).toHaveCount(0);
  await expect(whyBtn).toBeFocused();
}

async function playRoundTwoAndFinal(hostPage: Page, guestPage: Page): Promise<void> {
  await expect(hostPage.locator('header').getByText('раунд 2 из 2')).toBeVisible({
    timeout: 12_000,
  });
  await expect(hostPage.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
  await expect(guestPage.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });

  await hostPage.keyboard.press('KeyM');
  await placePinOnFakeMap(hostPage, 140, 120);
  await hostPage.getByRole('button', { name: 'Угадать' }).click();
  await placePinOnFakeMap(guestPage, 130, 100);
  await guestPage.getByRole('button', { name: 'Угадать' }).click();

  await expect(hostPage.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
  await hostPage.getByRole('button', { name: 'К итогам' }).click();

  await expect(hostPage.getByRole('button', { name: 'Ещё раз' })).toBeVisible({
    timeout: 10_000,
  });
  await assertAxeClean(hostPage, 'Final');
  await assertNoHorizontalOverflow(hostPage);
}

test('full 2-round match satisfies T53 map telemetry, axe WCAG AA, and BotCard/Space/Esc flows', async ({
  browser,
}) => {
  const hostCtx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const guestCtx = await browser.newContext({
    viewport: { width: 1024, height: 640 },
  });
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  const srv = getServer();
  const hostMaps = trackMapLoadedMessages(hostPage);
  const guestMaps = trackMapLoadedMessages(guestPage);

  try {
    await hostPage.goto(srv.hostUrl);
    await expect(hostPage.getByLabel('Ваше имя')).toBeVisible();
    await assertAxeClean(hostPage, 'Join');
    await assertNoHorizontalOverflow(hostPage);
    await joinPlayer(hostPage, srv.hostUrl, 'Оля');

    await expect(hostPage.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    await assertAxeClean(hostPage, 'Lobby');
    await assertNoHorizontalOverflow(hostPage);

    await hostPage.getByRole('button', { name: 'Скопировать приглашение' }).first().click();
    await expect(hostPage.getByText('Скопировано').first()).toBeVisible();

    await joinPlayer(guestPage, srv.guestUrl, 'Дима');
    await expect(hostPage.getByText(/ИГРОКИ 2 из 8/)).toBeVisible();

    await hostPage.getByRole('button', { name: 'Начать' }).click();
    await playRoundOne(hostPage, guestPage);

    await hostPage.getByRole('button', { name: 'Дальше' }).click();
    await playRoundTwoAndFinal(hostPage, guestPage);

    expect(hostMaps.getCount()).toBeLessThanOrEqual(2);
    expect(guestMaps.getCount()).toBeLessThanOrEqual(2);

    await hostPage.getByRole('button', { name: 'Ещё раз' }).click();
    await expect(hostPage.getByText(/ИГРОКИ 2 из 8/)).toBeVisible({ timeout: 10_000 });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
