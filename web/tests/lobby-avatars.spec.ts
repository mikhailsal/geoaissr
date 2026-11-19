import { expect, test, type Browser, type Page } from '@playwright/test';
import { assertAxeClean, assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

const hostName = 'Полина';
const guestName = 'Саша';
const botName = 'Клод';

function card(page: Page, name: string) {
  return page.getByRole('article', { name, exact: true });
}

function avatar(page: Page, name: string) {
  return card(page, name).locator('[data-avatar-base]');
}

async function join(page: Page, url: string, nick: string): Promise<void> {
  await page.goto(url);
  if ((page.viewportSize()?.width ?? 1280) < 900) {
    await page.getByRole('button', { name: 'Всё равно войти', exact: true }).click();
  }
  await page.getByLabel('Ваше имя').fill(nick);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(card(page, nick)).toBeVisible();
  const notice = page.getByRole('button', { name: 'Понятно', exact: true });
  if (await notice.isVisible()) await notice.click();
}

async function paintedAvatar(page: Page, name: string): Promise<string> {
  const canvas = avatar(page, name).locator('canvas[data-avatar-renderer]');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
}

async function chooseLook(page: Page, name: string, preset: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: `Гардероб: ${name}`, exact: true });
  await dialog.getByRole('button', { name: preset, exact: true }).click();
  await dialog.getByRole('button', { name: 'Сохранить образ', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function profileCode(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Профиль', exact: true }).click();
  const code = await page.getByLabel('Код профиля').inputValue();
  await page.keyboard.press('Escape');
  return code;
}

async function verifyFreshLogin(
  browser: Browser,
  baseUrl: string,
  code: string,
  outfit: string,
): Promise<void> {
  const fresh = await browser.newPage();
  try {
    await fresh.goto(baseUrl);
    await fresh.getByLabel('Код профиля').fill(code);
    await fresh.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expect(avatar(fresh, guestName)).toHaveAttribute('data-avatar-outfit', outfit);
  } finally {
    await fresh.close();
  }
}

test('a guest can select an avatar, share it with the room and restore it by profile code', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const host = await browser.newPage();
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 740 } });
  const guest = await guestContext.newPage();
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    const edit = guest.getByRole('button', {
      name: 'Изменить аватар',
      exact: true,
    });
    await expect(
      card(guest, hostName).getByRole('button', { name: 'Изменить аватар' }),
    ).toHaveCount(0);
    const original = await paintedAvatar(host, guestName);
    const current = await avatar(host, guestName).getAttribute('data-avatar-outfit');
    const [preset, outfit] =
      current === 'spacesuit' ? ['Неоновый гонщик', 'moto'] : ['Лунный пилот', 'spacesuit'];
    await edit.click();
    await assertNoHorizontalOverflow(guest);
    await assertAxeClean(guest, 'Guest wardrobe');
    await chooseLook(guest, guestName, preset);
    for (const page of [guest, host]) {
      await expect(avatar(page, guestName)).toHaveAttribute('data-avatar-outfit', outfit);
    }
    await expect.poll(() => paintedAvatar(host, guestName)).not.toBe(original);
    const code = await profileCode(guest);
    await guest.close();
    await server.restart();
    await verifyFreshLogin(browser, server.baseUrl, code, outfit);
  } finally {
    await guestContext.close();
    await host.close();
    await server.stop();
  }
});

test('a host outfits the robot and guests see it, including after restart', async ({ browser }) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    const editName = `Изменить аватар ${botName}`;
    await expect(guest.getByRole('button', { name: editName, exact: true })).toHaveCount(0);
    await expect(avatar(guest, botName)).toHaveAttribute('data-avatar-base', 'robot');
    await host.getByRole('button', { name: editName, exact: true }).click();
    await chooseLook(host, botName, 'Неоновый гонщик');
    for (const page of [guest, host]) {
      await expect(avatar(page, botName)).toHaveAttribute('data-avatar-outfit', 'moto');
      await expect(avatar(page, botName)).toHaveAttribute('data-avatar-base', 'robot');
    }
    await host.getByLabel('Жесты персонажа').selectOption({ label: `ИИ · ${botName}` });
    await host.getByRole('button', { name: 'Помахать', exact: true }).click();
    await expect(avatar(guest, botName)).toHaveAttribute('data-avatar-gesture', 'wave');
    await guest.getByRole('button', { name: `Настройки ${botName}`, exact: true }).click();
    await expect(guest.getByLabel('Имя бота')).toBeDisabled();
    await guest.keyboard.press('Escape');
    await host.getByRole('button', { name: `Настройки ${botName}`, exact: true }).click();
    await host.getByLabel('Имя бота').fill('Пилот');
    await host.getByLabel('Имя бота').press('Enter');
    await host.keyboard.press('Escape');
    await expect(avatar(guest, 'Пилот')).toHaveAttribute('data-avatar-outfit', 'moto');
    await server.restart();
    await host.goto(server.hostUrl);
    await expect(avatar(host, 'Пилот')).toHaveAttribute('data-avatar-outfit', 'moto');
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

test('a full turn reaches the other participant and clears after playback', async ({ browser }) => {
  const server = await startIsolatedFakeServer();
  const host = await browser.newPage();
  const guest = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    await expect(avatar(host, guestName).locator('canvas[data-avatar-renderer]')).toBeVisible();
    await guest.getByRole('button', { name: 'Помахать', exact: true }).click();
    await expect(avatar(host, guestName)).toHaveAttribute('data-avatar-gesture', 'wave');
    await host.getByRole('button', { name: 'Поворот на 360°', exact: true }).click();
    await expect(card(guest, hostName)).toHaveAttribute('data-gesture', 'spin');
    await expect(card(guest, hostName).getByRole('status')).toContainText('Поворот на 360°');
    await expect(avatar(guest, hostName).locator('canvas')).toHaveCSS('animation-name', 'none');
    await expect(card(guest, guestName)).not.toHaveAttribute('data-gesture', 'spin');
    await expect(card(guest, hostName)).not.toHaveAttribute('data-gesture', 'spin');
    await guest.getByRole('button', { name: 'Поворот на 360°', exact: true }).click();
    await expect(avatar(host, guestName)).toHaveAttribute('data-avatar-gesture', 'spin');
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});
