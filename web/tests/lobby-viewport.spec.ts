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
        };
      }),
    )
    .toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  for (const name of ['Изменить аватар', 'Помахать', 'Поворот на 360°', 'Участники и настройки']) {
    await expect(stage.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  const next = stage.getByRole('button', { name: 'Следующие участники' });
  if (width <= 600 || (width < 900 && height <= 480 && width > height)) {
    await expect(next).toBeInViewport({ ratio: 1 });
    await next.click();
    await expect(stage.getByRole('article', { name: 'Луна' })).toBeVisible();
    await stage.getByRole('button', { name: 'Предыдущие участники' }).click();
  }
  await stage.getByRole('button', { name: 'Участники и настройки' }).click();
  await expect(page.getByRole('heading', { name: /ИГРОКИ/u })).toBeInViewport();
}

test('the lobby stage fills the viewport and keeps room details reachable', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  try {
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Луна');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const notice = page.getByRole('button', { name: 'Понятно' });
    await expect(page.getByRole('article', { name: 'Луна' })).toBeVisible();
    if (await notice.isVisible()) await notice.click();
    const add = page.getByRole('button', { name: '+ Добавить ИИ' });
    await add.click();
    await add.click();
    await expect(add).toHaveCount(0);
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
