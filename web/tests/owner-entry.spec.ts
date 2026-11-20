import { expectLobbyPlayers } from './lobby-navigation';
import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

function ownerEntry(invite: string, origin: string): string {
  const url = new URL(origin);
  url.searchParams.set('entry', 'owner');
  url.hash = new URL(invite).hash;
  return url.href;
}

async function register(page: Page, name: string): Promise<void> {
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
}

async function profileCode(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Профиль', exact: true }).click();
  const code = await page.getByLabel('Код профиля').inputValue();
  await page.keyboard.press('Escape');
  return code;
}

test('a signed-in guest opens the owner invitation on the same origin and keeps both identities', async ({
  context,
  page,
}) => {
  const server = await startIsolatedFakeServer();
  const waiting = page.getByText('Хост ещё не вошёл в игру. Ждём его подключения.');
  const offline = page.getByText('Хост отключился. Ждём его возвращения');
  const start = page.getByRole('button', { name: 'Начать', exact: true });
  try {
    await page.goto(server.guestUrl);
    await register(page, 'Гость');
    await expect(waiting).toBeVisible();
    await expect(offline).toHaveCount(0);
    const guestCode = await profileCode(page);
    const remoteOwner = ownerEntry(server.hostUrl, server.baseUrl);
    const ownerTab = await context.newPage();
    await ownerTab.goto(remoteOwner);
    await ownerTab.getByRole('button', { name: 'Войти по коду' }).click();
    await ownerTab.getByLabel('Код профиля').fill(guestCode);
    await ownerTab.getByRole('button', { name: 'Войти по коду' }).click();
    await expect(ownerTab.getByRole('alert')).toContainText('нужен код профиля хоста');
    await expectLobbyPlayers(page, 1);
    await ownerTab.close();
    await page.goto(remoteOwner);
    await expect(page.getByRole('heading', { name: 'Вход для хоста' })).toBeVisible();
    await expect(page.getByLabel('Ваше имя')).toHaveValue('');
    await register(page, 'Владелец');
    await expect(start).toBeVisible();
    expect((await profileCode(page)) === guestCode).toBe(false);
    await page.reload();
    await expect(start).toBeVisible();
    const guest = await context.newPage();
    await guest.goto(server.baseUrl);
    await expect(guest.getByRole('article', { name: 'Владелец', exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Начать', exact: true })).toHaveCount(0);
    expect((await profileCode(guest)) === guestCode).toBe(true);
    await page.close();
    await expect(guest.getByText('Хост отключился. Ждём его возвращения')).toBeVisible();
    await expect(guest.getByText('Хост ещё не вошёл в игру. Ждём его подключения.')).toHaveCount(0);
    await guest.close();
  } finally {
    await server.stop();
  }
});

test('remote entry accepts the existing local owner profile code and identifies a guest invitation', async ({
  page,
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const remote = await browser.newPage();
  try {
    await page.goto(server.hostUrl);
    await register(page, 'Владелец');
    const code = await profileCode(page);
    await page.close();
    await remote.goto(ownerEntry(server.guestUrl, server.alternateBaseUrl));
    await expect(remote.getByRole('alert')).toContainText(
      'Для входа хоста нужен код профиля хоста',
    );
    await expect(remote.getByLabel('Ваше имя')).toHaveCount(0);
    await remote.goto(ownerEntry(server.hostUrl, server.alternateBaseUrl));
    await expect(remote.getByRole('heading', { name: 'Вход для хоста' })).toBeVisible();
    await remote.getByRole('button', { name: 'Войти по коду' }).click();
    await remote.getByLabel('Код профиля').fill(code);
    await remote.getByRole('button', { name: 'Войти по коду' }).click();
    await expect(remote.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
    await expectLobbyPlayers(remote, 1);
    expect((await profileCode(remote)) === code).toBe(true);
  } finally {
    await remote.close();
    await server.stop();
  }
});
