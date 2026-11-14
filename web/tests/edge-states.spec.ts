import { expect, test } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  startIsolatedFakeServer,
  type StartedFakeApp,
} from './helpers';

let server: StartedFakeApp | undefined;

function getServer(): StartedFakeApp {
  if (!server) throw new Error('E2E server was not initialized');
  return server;
}

test.beforeEach(async () => {
  server = await startIsolatedFakeServer({ seedBot: false, rounds: 3 });
});

test.afterEach(async () => {
  await server?.stop();
  server = undefined;
});

test('join error states cover missing link, bad token, and duplicate nick', async ({ browser }) => {
  const srv = getServer();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await pageA.goto(srv.baseUrl);
    await expect(pageA.getByText('Нужна пригласительная ссылка')).toBeVisible();

    await pageA.goto(`${srv.baseUrl}/#t=wrong_token_value`);
    await expect(pageA.getByText('Ссылка устарела или неверна')).toBeVisible();

    await pageA.goto(srv.hostUrl);
    await pageA.getByLabel('Ваше имя').fill('Ведущий');
    await pageA.getByRole('button', { name: 'Войти' }).click();
    await expect(pageA.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();

    await pageB.goto(srv.guestUrl);
    await pageB.getByLabel('Ваше имя').fill('ведущий');
    await pageB.getByRole('button', { name: 'Войти' }).click();
    await expect(pageB.getByText('Ник занят')).toBeVisible();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('mobile viewport, reconnect banner, and early end match work cleanly', async ({ browser }) => {
  const srv = getServer();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  try {
    await page.goto(srv.hostUrl);
    await expect(page.getByText('На телефоне играть неудобно')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Всё равно войти' }).click();

    await page.getByLabel('Ваше имя').fill('Саша');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await ctx.setOffline(true);
    await expect(page.getByText(/Связь потеряна/)).toBeVisible({ timeout: 6_000 });
    await ctx.setOffline(false);
    await expect(page.getByText(/Снова на связи/)).toBeVisible({ timeout: 8_000 });

    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.getByRole('button', { name: 'Карта' })).toBeVisible({ timeout: 12_000 });
    await page.getByRole('button', { name: 'Карта' }).click();
    await expect(page.getByTestId('fake-guess-map')).toBeVisible();
    await page.getByRole('button', { name: 'Скрыть карту' }).click();

    await page.getByRole('button', { name: 'Меню хоста' }).click();
    await page.getByRole('menuitem', { name: 'Завершить партию' }).click();
    await expect(page.getByText(/Завершить\? Сыграно 0 из 3 раундов/)).toBeVisible();
    await page.getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect(page.getByText('Партия завершена до первого результата')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
