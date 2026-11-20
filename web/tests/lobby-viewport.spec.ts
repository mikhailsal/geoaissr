import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

async function checkSixAvatars(page: Page): Promise<void> {
  const articles = page.getByRole('article');
  await expect(articles).toHaveCount(6);
  await expect(page.locator('article canvas[data-avatar-renderer]')).toHaveCount(6, {
    timeout: 15_000,
  });
  const targets = await articles.evaluateAll((seats) =>
    seats.map((seat) => {
      const buttons = [...seat.querySelectorAll('button')];
      return buttons.every((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return (
          box.width >= 44 &&
          box.height >= 44 &&
          box.left >= -0.5 &&
          box.right <= window.innerWidth + 0.5 &&
          box.top >= 0 &&
          box.bottom <= window.innerHeight &&
          button.contains(hit)
        );
      });
    }),
  );
  expect(targets).toEqual([true, true, true, true, true, true]);
  const centered = await articles.first().evaluate((seat) => {
    const box = seat.getBoundingClientRect();
    const lineup = seat.parentElement?.getBoundingClientRect();
    if (!lineup) throw new Error('Missing lineup');
    return Math.abs(box.left + box.width / 2 - (lineup.left + lineup.width / 2));
  });
  expect(centered).toBeLessThan(1);
}

async function checkStage(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const stage = page.getByRole('region', { name: 'Сцена лобби' });
  await expect
    .poll(() =>
      stage.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          right: Math.round(box.right - document.documentElement.clientWidth),
          bottom: Math.round(box.bottom - window.innerHeight),
          scrollable: document.documentElement.scrollHeight > window.innerHeight,
        };
      }),
    )
    .toEqual({ left: 0, top: 0, right: 0, bottom: 0, scrollable: false });
  for (const name of [
    'Изменить аватар',
    'Помахать',
    'Поворот на 360°',
    'Участники',
    'Настройки партии',
    'Начать',
  ]) {
    await expect(stage.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expect(stage.getByRole('navigation', { name: 'Страницы сцены' })).toHaveCount(0);
  await checkSixAvatars(page);
  for (const name of ['Участники', 'Настройки партии']) {
    const open = stage.getByRole('button', { name, exact: true });
    await open.click();
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
  }
}

test('the lobby stage fills the viewport and keeps room details reachable', async ({
  page,
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const guests = await Promise.all(
    ['Марс', 'Вега'].map(async (name) => ({
      page: await browser.newPage({ reducedMotion: 'reduce' }),
      name,
    })),
  );
  try {
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Луна');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const notice = page.getByRole('button', { name: 'Понятно' });
    await expect(page.getByRole('article', { name: 'Луна' })).toBeVisible();
    await expect(page.getByText('Профиль создан. Вы уже в игре.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Сцена лобби' })).toBeInViewport({ ratio: 1 });
    if (await notice.isVisible()) await notice.click();
    await page.getByRole('button', { name: 'Участники', exact: true }).click();
    const roster = page.getByRole('dialog', { name: 'Участники', exact: true });
    const add = roster.getByRole('button', { name: '+ Добавить ИИ' });
    await add.click();
    await expect(roster.getByRole('button', { name: /^Настройки /u })).toHaveCount(2);
    await add.click();
    await expect(add).toHaveCount(0);
    await page.keyboard.press('Escape');
    await Promise.all(
      guests.map(async (guest) => {
        await guest.page.goto(server.guestUrl);
        await guest.page.getByLabel('Ваше имя').fill(guest.name);
        await guest.page.getByRole('button', { name: 'Войти', exact: true }).click();
        await expect(guest.page.getByRole('article', { name: guest.name })).toBeVisible();
      }),
    );
    for (const [width, height] of [
      [1440, 900],
      [390, 740],
      [320, 568],
      [568, 320],
      [653, 280],
    ] as const) {
      await test.step(`${width} × ${height}`, () => checkStage(page, width, height));
    }
  } finally {
    await Promise.all(guests.map((guest) => guest.page.close()));
    await server.stop();
  }
});
