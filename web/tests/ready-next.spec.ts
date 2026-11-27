// Value: protects=the host is asked before leaving a guest who has not pressed «Готов», «Отмена»
// keeps the results on screen, the question goes away by itself when the guest becomes ready, a
// ready guest and a guest who has dropped off are not asked about; fails_when=the host's click
// starts the round over a guest still reading, the guest has no way to say they are ready, the
// question stays after everyone is ready, or the host is asked to wait for a closed tab;
// why_new=the button is new; seam=none; no_claim=«Запускать» (pressed in game-flow.spec.ts) and a
// guest who comes back after dropping off. The second test does the same for «Ещё раз» on the
// final screen.
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

test('the host is asked before starting without a guest who is still reading', async ({
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

    // Escape answers the question like «Отмена».
    await host.getByRole('button', { name: 'Дальше' }).click();
    await expect(question).toBeVisible();
    await host.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(host.getByText(/Правильный ответ:/)).toBeVisible();

    // The guest becomes ready while the host is looking at the question: it closes by itself.
    await host.getByRole('button', { name: 'Дальше' }).click();
    await expect(question).toBeVisible();
    await guest.getByRole('button', { name: 'Готов', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Вы готовы' })).toBeDisabled();
    await expect(question).toHaveCount(0);
    await expect(host.getByText('Готовы: 1 из 1')).toBeVisible();
    // The ready guest is marked in the host's list of the round.
    const guestRow = host.getByRole('row').filter({ hasText: 'Дима' });
    await expect(guestRow.getByText('✓ готов')).toBeVisible();
    await expect(host.getByRole('row').filter({ hasText: 'Оля' }).getByText('✓ готов')).toHaveCount(
      0,
    );
    // The match standings tab marks them too.
    await host.getByRole('tab', { name: 'Рейтинг за игру' }).click();
    const standingsRow = host
      .getByTestId('match-standings-table')
      .getByRole('row')
      .filter({ hasText: 'Дима' });
    await expect(standingsRow.getByText('✓ готов')).toBeVisible();
    await host.getByRole('button', { name: 'Дальше' }).click();
    await expect(host.getByRole('dialog')).toHaveCount(0);
    await expect(host.locator('header').getByText('раунд 2 из 2')).toBeVisible({ timeout: 12_000 });

    // Round 2: the guest closes the tab on the results screen. Nobody is left to wait for.
    await guess(host);
    await guess(guest);
    await expect(host.getByText('Готовы: 0 из 1')).toBeVisible({ timeout: 12_000 });
    await guestCtx.close();
    await expect(host.getByText(/Готовы:/)).toHaveCount(0);
    await host.getByRole('button', { name: 'К итогам' }).click();
    await expect(host.getByRole('dialog')).toHaveCount(0);
    await expect(host.getByRole('button', { name: 'Ещё раз' })).toBeVisible({ timeout: 10_000 });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

test('the host is asked before going back to the lobby without a guest who is still reading', async ({
  browser,
}) => {
  const app = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const guestCtx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  try {
    await join(host, app.hostUrl, 'Оля');
    await join(guest, app.guestUrl, 'Дима');
    await host.getByRole('button', { name: 'Начать' }).click();
    await guess(host);
    await guess(guest);
    await guest.getByRole('button', { name: 'Готов', exact: true }).click();
    await host.getByRole('button', { name: 'К итогам' }).click();
    await expect(host.getByRole('button', { name: 'Ещё раз' })).toBeVisible({ timeout: 10_000 });

    // The ready click of the last round does not carry over to the final screen.
    await expect(host.getByText('Готовы: 0 из 1')).toBeVisible();
    await expect(guest.getByText('Хост вернёт всех в лобби')).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Ещё раз' })).toHaveCount(0);

    await host.getByRole('button', { name: 'Ещё раз' }).click();
    const question = host.getByRole('dialog', { name: 'Не все готовы' });
    await expect(question).toContainText(
      'Дима ещё не нажал(а) «Готов». Точно возвращаемся в лобби?',
    );
    await question.getByRole('button', { name: 'Отмена' }).click();
    await expect(question).toHaveCount(0);
    await expect(host.getByRole('button', { name: 'Ещё раз' })).toBeVisible();

    await guest.getByRole('button', { name: 'Готов', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Вы готовы' })).toBeDisabled();
    await expect(host.getByText('Готовы: 1 из 1')).toBeVisible();
    const guestRow = host.getByRole('row').filter({ hasText: 'Дима' });
    await expect(guestRow.getByText('✓ готов')).toBeVisible();

    await host.getByRole('button', { name: 'Ещё раз' }).click();
    await expect(host.getByRole('dialog')).toHaveCount(0);
    for (const page of [host, guest]) {
      await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }
  } finally {
    await hostCtx.close();
    await guestCtx.close();
    await app.stop();
  }
});
