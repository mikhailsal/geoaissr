import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

async function submitName(page: Page, name: string): Promise<void> {
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('article', { name, exact: true })).toBeVisible();
}

for (const role of ['host', 'guest'] as const) {
  test(`a ${role} invitation can leave code entry, reload and create a new profile without its code`, async ({
    page,
  }) => {
    const server = await startIsolatedFakeServer();
    const invite = new URL(role === 'host' ? server.hostUrl : server.guestUrl);
    if (role === 'host') invite.searchParams.set('entry', 'owner');
    try {
      await page.goto(server.baseUrl);
      const create = page.getByRole('button', { name: 'Создать новый профиль' });
      const back = page.getByRole('button', { name: 'Назад к созданию профиля' });
      const codeLogin = page.getByRole('button', { name: 'Войти по коду' });
      await expect(page.getByText(/Введите сохранённый код профиля/)).toBeVisible();
      await expect(create).toHaveCount(0);
      await page.goto(invite.href);
      await codeLogin.click();
      await expect(page.getByLabel('Код профиля')).toBeVisible();
      await expect(back).toBeEnabled();
      await page.reload();
      await page.getByLabel('Ваше имя').fill('Черновик');
      const color = page.getByRole('radio').nth(2);
      await color.click();
      await codeLogin.click();
      await page.getByLabel('Код профиля').fill('a'.repeat(32));
      await codeLogin.click();
      await expect(page.getByRole('alert')).toContainText('Неверный код профиля');
      await back.click();
      await expect(page.getByLabel('Ваше имя')).toBeFocused();
      await expect(page.getByLabel('Ваше имя')).toHaveValue('Черновик');
      await expect(color).toBeChecked();
      await submitName(page, 'Новый игрок');
      await page.reload();
      await expect(page.getByRole('article', { name: 'Новый игрок', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Начать', exact: true })).toHaveCount(
        role === 'host' ? 1 : 0,
      );
    } finally {
      await server.stop();
    }
  });
}

test('a claimed legacy profile on an invitation can create a separate guest while the original still works', async ({
  page,
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const invited = await browser.newPage();
  try {
    await page.goto(server.guestUrl);
    await submitName(page, 'Первый гость');
    const original = await page.evaluate(() => {
      const { profileId, nick, color } = JSON.parse(
        localStorage.getItem(`geoaissr:profile:${location.origin}`) ?? 'null',
      ) as { profileId: string; nick: string; color: string };
      return { profileId, nick, color };
    });
    await invited.addInitScript((legacy) => {
      const key = `geoaissr:profile:${location.origin}`;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(legacy));
    }, original);
    await invited.goto(server.guestUrl);
    await expect(invited.getByRole('alert')).toContainText('Этот профиль уже зарегистрирован');
    await invited.getByRole('button', { name: 'Создать новый профиль' }).click();
    await expect(invited.getByLabel('Ваше имя')).toHaveValue('');
    await submitName(invited, 'Другой гость');
    await expect(invited.getByRole('button', { name: 'Начать' })).toHaveCount(0);
    await expect(page.getByText('ИГРОКИ 2 из 8')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('article', { name: 'Первый гость', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Первый гость');
  } finally {
    await invited.close();
    await server.stop();
  }
});
