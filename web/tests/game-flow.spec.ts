import { closeLobbyDialog, expectLobbyPlayers, openLobbyDialog } from './lobby-navigation';
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
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
  const notice = page.getByRole('button', { name: 'Понятно', exact: true });
  if (await notice.isVisible()) await notice.click();
}

async function assertInviteHeader(page: Page): Promise<void> {
  const invite = page.getByRole('button', { name: /^(Скопировать приглашение|Скопировано)$/ });
  await expect(invite).toHaveCount(1);
  await expect(page.locator('.host-menu-bar .copy-btn')).toBeVisible();
  await expect(page.locator('.host-menu-bar .copy-btn')).toHaveCount(1);
}

async function assertInviteViewports(page: Page): Promise<void> {
  await assertInviteBounds(page, 375, 667);
  await assertInviteBounds(page, 1280, 720);
}

async function assertInviteBounds(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await assertInviteHeader(page);
  const box = await page.locator('.host-menu-bar .copy-btn').boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Invite button has no bounding box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
  await assertNoHorizontalOverflow(page);
}

async function assertHostMenu(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Меню хоста' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Завершить партию' })).toBeVisible();
  await menu.click();
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
  await assertInviteHeader(hostPage);
  await assertInviteHeader(guestPage);
  await assertHostMenu(hostPage);
  await assertInviteViewports(hostPage);

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
  await assertInviteHeader(hostPage);
  await assertInviteHeader(guestPage);
  await assertHostMenu(hostPage);
  await assertInviteViewports(hostPage);

  await assertBotCardInteractions(hostPage);
}

async function assertBotCardInteractions(hostPage: Page): Promise<void> {
  const whyBtn = hostPage.getByRole('button', { name: 'почему?' }).first();
  await whyBtn.click();
  await expect(hostPage.locator('.bot-card')).toBeVisible();
  await hostPage.getByRole('button', { name: /Ход за ходом/ }).click();
  // All four start frames (N, E, S, W) are shown, not only the first one.
  expect(await hostPage.locator('.bot-card .frame-btn').count()).toBeGreaterThanOrEqual(4);
  const firstThumb = hostPage.locator('.bot-card .frame-btn').first();
  await firstThumb.click();
  const zoomedImg = hostPage.locator('.zoomed-preview img');
  await expect(zoomedImg).toBeVisible();
  expect(await zoomedImg.getAttribute('src')).toMatch(/^\/thumb\//);
  const preview = hostPage.getByRole('dialog', { name: 'Снимок бота' });
  await expect(preview).toBeVisible();
  const bounds = await preview.boundingBox();
  if (!bounds) throw new Error('Snapshot dialog has no bounds');
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(hostPage.viewportSize()?.height ?? 720);
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
  await hostPage.getByRole('button', { name: 'Закрыть снимок' }).click();
  await expect(zoomedImg).toHaveCount(0);

  const secondThumb = hostPage.locator('.bot-card .frame-btn').nth(1);
  await secondThumb.locator('img').dispatchEvent('error');
  await expect(secondThumb).toHaveText('Кадр недоступен');
  await expect(secondThumb).toBeDisabled();
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
  // The guest has not pressed «Готов»: the host is asked first and may go on anyway.
  await hostPage.getByRole('button', { name: 'К итогам' }).click();
  await hostPage.getByRole('dialog').getByRole('button', { name: 'Запускать' }).click();

  await expect(hostPage.getByRole('button', { name: 'Ещё раз' })).toBeVisible({
    timeout: 10_000,
  });
  await assertAxeClean(hostPage, 'Final');
  await assertNoHorizontalOverflow(hostPage);
  await assertInviteHeader(hostPage);
  await assertInviteHeader(guestPage);
  await expect(hostPage.getByRole('button', { name: 'Меню хоста' })).toHaveCount(0);
  await assertInviteViewports(hostPage);
}

// protects=single header invitation in each phase, host menu actions, clipboard and responsive bounds in each phase; fails_when=duplicates, missing controls, incorrect clipboard or overflow occur; why_new=the match journey did not cover invite behavior across phases or viewport sizes; seam=none; no_claim=does not cover every viewport or operating-system clipboard implementation
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

    await expectLobbyPlayers(hostPage, 1);
    await assertAxeClean(hostPage, 'Lobby');
    await assertNoHorizontalOverflow(hostPage);

    const participants = await openLobbyDialog(hostPage, 'Участники');
    await expect(
      participants.getByText('Пока вы одни. Отправьте друзьям приглашение', { exact: true }),
    ).toBeVisible();
    await expect(participants.getByRole('button', { name: 'Скопировать приглашение' })).toHaveCount(
      0,
    );
    await closeLobbyDialog(participants);
    await expect(hostPage.getByRole('button', { name: 'Меню хоста' })).toHaveCount(0);
    await assertInviteViewports(hostPage);
    await hostPage.getByRole('button', { name: 'Скопировать приглашение' }).click();
    await expect(hostPage.getByText('Скопировано').first()).toBeVisible();
    expect(await hostPage.evaluate(() => navigator.clipboard.readText())).toBe(srv.guestUrl);

    await joinPlayer(guestPage, srv.guestUrl, 'Дима');
    await expectLobbyPlayers(hostPage, 2);
    await assertInviteHeader(guestPage);

    await hostPage.getByRole('button', { name: 'Начать' }).click();
    await playRoundOne(hostPage, guestPage);

    await hostPage.getByRole('button', { name: 'Дальше' }).click();
    await hostPage.getByRole('dialog').getByRole('button', { name: 'Запускать' }).click();
    await playRoundTwoAndFinal(hostPage, guestPage);

    expect(hostMaps.getCount()).toBeLessThanOrEqual(2);
    expect(guestMaps.getCount()).toBeLessThanOrEqual(2);

    await hostPage.getByRole('button', { name: 'Ещё раз' }).click();
    await hostPage.getByRole('dialog').getByRole('button', { name: 'В лобби' }).click();
    await expect(hostPage.getByRole('button', { name: 'Участники', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expectLobbyPlayers(hostPage, 2);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
