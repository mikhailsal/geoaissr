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
  const host = await browser.newPage({ reducedMotion: 'reduce' });
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
    await card(host, botName)
      .getByRole('button', { name: 'Открыть гардероб: ' + botName })
      .click();
    await chooseLook(host, botName, 'Неоновый гонщик');
    for (const page of [guest, host]) {
      await expect(avatar(page, botName)).toHaveAttribute('data-avatar-outfit', 'moto');
      await expect(avatar(page, botName)).toHaveAttribute('data-avatar-base', 'robot');
    }
    await host.getByLabel('Жесты персонажа').selectOption({ label: `ИИ · ${botName}` });
    await host.getByRole('button', { name: 'Помахать', exact: true }).click();
    await expect(avatar(guest, botName)).toHaveAttribute('data-avatar-gesture', 'wave');
    await guest.getByRole('button', { name: 'Участники', exact: true }).click();
    await guest.getByRole('button', { name: `Настройки ${botName}`, exact: true }).click();
    await expect(guest.getByLabel('Имя бота')).toBeDisabled();
    await guest.keyboard.press('Escape');
    await host.getByRole('button', { name: 'Участники', exact: true }).click();
    await host.getByRole('button', { name: `Настройки ${botName}`, exact: true }).click();
    await host.getByLabel('Имя бота').fill('Пилот');
    await host.getByLabel('Имя бота').press('Enter');
    await host.keyboard.press('Escape');
    await guest.keyboard.press('Escape');
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

test('host and guest can retry their open personal wardrobe after the server restarts', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const players = [
    { page: host, name: hostName, preset: 'Лунный пилот', outfit: 'spacesuit' },
    { page: guest, name: guestName, preset: 'Неоновый гонщик', outfit: 'moto' },
  ];
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    for (const { page, preset } of players) {
      await page.getByRole('button', { name: 'Изменить аватар', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: preset, exact: true }).click();
      await page.context().setOffline(true);
    }
    await server.restart();
    for (const { page } of players) {
      await expect(page.getByText(/Связь потеряна/)).toBeVisible();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Сохранить образ' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Сервер не отвечает');
      await page.context().setOffline(false);
      await expect(page.getByText('Снова на связи', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Сохранить образ' }).click();
      await expect(dialog).toBeHidden();
    }
    for (const { page } of players) {
      for (const { name, outfit } of players) {
        await expect(avatar(page, name)).toHaveAttribute('data-avatar-outfit', outfit);
      }
    }
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

test('mobile stage paging keeps the right-hand gesture visible and the viewer on stage', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage({ viewport: { width: 390, height: 740 } });
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    await host.getByRole('button', { name: 'Участники', exact: true }).click();
    await host.getByRole('button', { name: '+ Добавить ИИ', exact: true }).click();
    await host.keyboard.press('Escape');
    const pager = guest.getByRole('navigation', { name: 'Страницы сцены' });
    await expect(pager).toBeVisible();
    await host.getByLabel('Жесты персонажа').selectOption({ label: `ИИ · ${botName}` });
    await host.getByRole('button', { name: 'Помахать', exact: true }).click();
    const cue = card(guest, botName).getByRole('status');
    await expect(cue).toContainText('Помахать');
    const controls = await pager.boundingBox();
    const badge = await cue.boundingBox();
    if (!controls || !badge) throw new Error('Missing pager or gesture badge');
    const overlap =
      controls.x < badge.x + badge.width &&
      badge.x < controls.x + controls.width &&
      controls.y < badge.y + badge.height &&
      badge.y < controls.y + controls.height;
    expect(overlap, 'The stage pager covers the gesture badge').toBe(false);
    await pager.getByRole('button', { name: 'Следующие участники' }).click();
    await expect(card(guest, guestName)).toBeVisible();
    await expect(card(guest, botName)).toHaveCount(0);
    await pager.getByRole('button', { name: 'Предыдущие участники' }).click();
    await expect(card(guest, botName)).toBeVisible();
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

test('bots with the same name have matching slot labels in the gesture picker and on stage', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 2 });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    const addBot = host.getByRole('button', { name: '+ Добавить ИИ', exact: true });
    await host.getByRole('button', { name: 'Участники', exact: true }).click();
    await addBot.click();
    await host.keyboard.press('Escape');
    const picker = host.getByLabel('Жесты персонажа');
    const firstBot = picker.getByRole('option').nth(1);
    await expect(firstBot).toHaveText(/^ИИ · .+/);
    const name = (await firstBot.innerText()).replace('ИИ · ', '');
    await host.getByRole('button', { name: 'Участники', exact: true }).click();
    await addBot.click();
    await addBot.click();
    await host.keyboard.press('Escape');
    const slotLabel = (slot: number) => `ИИ №${slot} · ${name}`;
    const labels = [1, 2, 3].map(slotLabel);
    await expect(picker.getByRole('option')).toHaveText(['Мои жесты', ...labels]);
    for (const label of labels) {
      await expect(card(guest, label)).toContainText(label);
    }
    await picker.selectOption({ label: slotLabel(2) });
    await host.getByRole('button', { name: 'Помахать', exact: true }).click();
    await expect(card(guest, slotLabel(2))).toHaveAttribute('data-gesture', 'wave');
    await expect(card(guest, slotLabel(1))).not.toHaveAttribute('data-gesture', 'wave');
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

test('clicking a stage avatar turns the same person or bot for both players', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    const turn = (page: Page, name: string) =>
      card(page, name).getByRole('button', { name: `Повернуть на 360°: ${name}`, exact: true });
    await turn(guest, hostName).click();
    await expect(avatar(guest, hostName)).toHaveAttribute('data-avatar-gesture', 'spin');
    await expect(avatar(host, hostName)).toHaveAttribute('data-avatar-gesture', 'spin');
    await turn(guest, guestName).press('Enter');
    await expect(avatar(host, guestName)).toHaveAttribute('data-avatar-gesture', 'spin');
    await turn(guest, botName).click();
    await expect(avatar(host, botName)).toHaveAttribute('data-avatar-gesture', 'spin');
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

test('a host opens the robot wardrobe from its stage button and the selected actor', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    const wardrobe = `Открыть гардероб: ${botName}`;
    const edit = card(host, botName).getByRole('button', { name: wardrobe });
    await card(guest, botName).getByRole('button', { name: wardrobe }).click();
    await expect(guest.getByRole('heading', { name: 'Образ персонажа' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Сохранить образ' })).toHaveCount(0);
    await guest.keyboard.press('Escape');
    await edit.click();
    const dialog = host.getByRole('dialog', { name: `Гардероб: ${botName}` });
    await dialog.getByRole('button', { name: `Повернуть на 360°: ${botName}` }).click();
    await expect(dialog.getByRole('img', { name: `Предпросмотр: ${botName}` })).toHaveAttribute(
      'data-avatar-gesture',
      'spin',
    );
    await dialog.getByRole('button', { name: 'Человек', exact: true }).click();
    await chooseLook(host, botName, 'Лунный пилот');
    await expect(avatar(guest, botName)).toHaveAttribute('data-avatar-base', 'human');
    await expect(avatar(guest, botName)).toHaveAttribute('data-avatar-outfit', 'spacesuit');
    await expect(edit).toBeFocused();
    await host.getByLabel('Жесты персонажа').selectOption({ label: `ИИ · ${botName}` });
    await host.getByRole('button', { name: 'Гардероб ИИ', exact: true }).click();
    await dialog.getByRole('button', { name: 'Робот', exact: true }).click();
    await chooseLook(host, botName, 'Неоновый гонщик');
    await expect(avatar(guest, botName)).toHaveAttribute('data-avatar-base', 'robot');
    await expect(avatar(guest, botName)).toHaveAttribute('data-avatar-outfit', 'moto');
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

async function checkGestureSequence(sender: Page, observer: Page, actor: string): Promise<void> {
  const emotes = [
    ['Отличная игра', 'gg'],
    ['Смеяться', 'laugh'],
    ['Праздновать', 'cheer'],
    ['Помахать', 'wave'],
    ['Задуматься', 'think'],
    ['Слёзы радости', 'joy'],
    ['Показать класс', 'cool'],
    ['Поворот на 360°', 'spin'],
  ] as const;
  const observed = await card(observer, actor).evaluateHandle((element) => {
    const received: string[] = [];
    const watcher = new MutationObserver(() => {
      const kind = element.getAttribute('data-gesture');
      if (kind) received.push(kind);
    });
    watcher.observe(element, { attributes: true, attributeFilter: ['data-gesture'] });
    return { received, watcher };
  });
  try {
    const buttons = sender.getByRole('group', { name: 'Жесты', exact: true });
    for (const [label] of emotes) {
      await buttons.getByRole('button', { name: label, exact: true }).click();
    }
    await expect
      .poll(() => observed.evaluate((r) => r.received), { timeout: 10_000 })
      .toEqual(emotes.map(([, gesture]) => gesture));
  } finally {
    await observed.evaluate((r) => {
      r.watcher.disconnect();
    });
    await observed.dispose();
  }
}

test('quick successive clicks on all eight gestures reach the other player in order', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await join(host, server.hostUrl, hostName);
    await join(guest, server.guestUrl, guestName);
    await checkGestureSequence(host, guest, hostName);
    await checkGestureSequence(guest, host, guestName);
    await host.getByLabel('Жесты персонажа').selectOption({ label: `ИИ · ${botName}` });
    await checkGestureSequence(host, guest, botName);
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});
