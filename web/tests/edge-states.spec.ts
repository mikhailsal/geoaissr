import { expectLobbyPlayers } from './lobby-navigation';
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

// protects=normal signed-out entry and invalid invitation recovery; fails_when=the bare page demands an invitation or invalid invitations hide code login; why_new=the homepage now permits returning players without invitations; seam=none; no_claim=does not establish server-side authorization
test('homepage and invalid invitations offer personal-code entry', async ({ page }) => {
  const srv = getServer();
  await page.goto(srv.baseUrl);
  await expect(page.getByLabel('Код профиля')).toBeVisible();
  await expect(page.getByLabel('Ваше имя')).toHaveCount(0);
  await expect(page.getByText('Нужна пригласительная ссылка')).toHaveCount(0);
  await page.goto(`${srv.baseUrl}/#t=wrong_token_value`);
  await expect(page.getByText('Ссылка устарела или неверна')).toBeVisible();
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
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expectLobbyPlayers(page, 1);
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
