// Value: protects=the host is asked before leaving a guest who has not pressed «Готов», «Отмена»
// keeps the results on screen, and once the guest is ready «Дальше» starts the round with no
// question; fails_when=the host's click starts the round over a guest still reading, the guest
// has no way to say they are ready, or the question stays after everyone is ready; why_new=the
// button is new; seam=none; no_claim=a guest who has dropped off is not waited for (rule in
// NextRoundFooter.svelte, no browser check), and «Запускать» (pressed in game-flow.spec.ts).
import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer, type StartedFakeApp } from './helpers';

let server: StartedFakeApp | undefined;

test.beforeAll(async () => {
  server = await startIsolatedFakeServer({ seedBot: true, rounds: 2 });
});

test.afterAll(async () => {
  await server?.stop();
});

async function join(page: Page, url: string, nick: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(nick);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
  const notice = page.getByRole('button', { name: 'Понятно', exact: true });
  if (await notice.isVisible()) await notice.click();
}

async function guess(page: Page): Promise<void> {
  const canvas = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 12_000 });
  // Hover expands the dock with a CSS transition; click only once its size has settled.
  await canvas.hover();
  let box = await canvas.boundingBox();
  await expect
    .poll(async () => {
      const prev = box;
      box = await canvas.boundingBox();
      return prev !== null && box !== null && prev.width === box.width;
    })
    .toBe(true);
  if (!box) throw new Error('the guess map has no box');
  await page.mouse.click(box.x + 140, box.y + 110);
  await page.getByRole('button', { name: 'Угадать' }).click();
}

test('a guest presses «Готов» and the host is asked before starting without them', async ({
  browser,
}) => {
  if (!server) throw new Error('E2E server was not initialized');
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const guestCtx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    await join(host, server.hostUrl, 'Оля');
    await join(guest, server.guestUrl, 'Дима');
    await host.getByRole('button', { name: 'Начать' }).click();
    await guess(host);
    await guess(guest);
    await expect(host.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
    await expect(guest.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });

    // The host has «Дальше» where the guest has «Готов».
    await expect(host.getByRole('button', { name: 'Готов', exact: true })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Дальше' })).toHaveCount(0);
    await expect(host.getByText('Готовы: 0 из 1')).toBeVisible();

    await host.getByRole('button', { name: 'Дальше' }).click();
    const question = host.getByRole('dialog', { name: 'Не все готовы' });
    await expect(question).toContainText('Дима ещё не нажал(а) «Готов». Точно запускаем?');
    await question.getByRole('button', { name: 'Отмена' }).click();
    await expect(question).toHaveCount(0);
    await expect(host.getByText(/Правильный ответ:/)).toBeVisible();
    await expect(guest.getByText(/Правильный ответ:/)).toBeVisible();

    await guest.getByRole('button', { name: 'Готов', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Вы готовы' })).toBeDisabled();
    await expect(host.getByText('Готовы: 1 из 1')).toBeVisible();
    await host.getByRole('button', { name: 'Дальше' }).click();
    await expect(host.getByRole('dialog')).toHaveCount(0);
    await expect(host.locator('header').getByText('раунд 2 из 2')).toBeVisible({ timeout: 12_000 });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
