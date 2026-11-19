import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

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
  const next = stage.getByRole('button', { name: 'Следующие участники' });
  if (width <= 600 || (width < 900 && height <= 480 && width > height)) {
    await expect(next).toBeInViewport({ ratio: 1 });
    await next.click();
    await expect(stage.getByRole('article', { name: 'Луна' })).toBeVisible();
    await stage.getByRole('button', { name: 'Предыдущие участники' }).click();
  }
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

test('the lobby stage fills the viewport and keeps room details reachable', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
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
    await server.stop();
  }
});
