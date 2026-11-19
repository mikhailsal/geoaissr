import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

test.use({ isMobile: true, hasTouch: true });

async function joinLobby(page: Page, hostUrl: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(hostUrl);
  await page.getByRole('button', { name: 'Всё равно войти' }).tap();
  await page.getByLabel('Ваше имя').fill('Луна');
  await page.getByRole('button', { name: 'Войти', exact: true }).tap();
  await expect(page.getByRole('article', { name: 'Луна' })).toBeVisible();
  const notice = page.getByRole('button', { name: 'Понятно' });
  if (await notice.isVisible()) await notice.tap();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

for (const viewport of [
  { width: 568, height: 320 },
  { width: 653, height: 280 },
]) {
  const size = `${viewport.width}x${viewport.height}`;

  test(`sound actions fit the short landscape viewport at ${size}`, async ({ page }) => {
    const server = await startIsolatedFakeServer({ seedBot: true });
    try {
      await joinLobby(page, server.hostUrl, viewport);
      const trigger = page.getByRole('button', { name: 'Звуковые эффекты', exact: true });
      await trigger.tap();
      const panel = page.getByRole('region', { name: 'Громкость звуковых эффектов' });
      await expect(panel).toBeInViewport({ ratio: 1 });
      const mute = panel.getByRole('button', { name: 'Выключить звуковые эффекты' });
      await expect(mute).toBeInViewport({ ratio: 1 });
      await mute.tap();
      await expect(panel.getByRole('button', { name: 'Включить звуковые эффекты' })).toBeVisible();
      await panel.getByRole('button', { name: 'Сбросить настройки звука' }).tap();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    } finally {
      await server.stop();
    }
  });

  test(`a whole outfit and wardrobe footer fit together at ${size}`, async ({ page }) => {
    const server = await startIsolatedFakeServer({ seedBot: true });
    try {
      await joinLobby(page, server.hostUrl, viewport);
      const open = page.getByRole('button', { name: 'Изменить аватар', exact: true });
      await open.tap();
      const wardrobe = page.getByRole('dialog', { name: 'Гардероб: Луна' });
      const save = wardrobe.getByRole('button', { name: 'Сохранить образ' });
      await expect(save).toBeInViewport({ ratio: 1 });
      const outfit = wardrobe.getByRole('button', { name: 'Лунный пилот' });
      await outfit.scrollIntoViewIfNeeded();
      await expect(outfit).toBeInViewport({ ratio: 1 });
      await expect(wardrobe.getByRole('button', { name: 'Отмена' })).toBeInViewport({ ratio: 1 });
      await outfit.tap();
      await save.tap();
      await expect(wardrobe).toBeHidden();
      await expect(open).toBeFocused();
      await expect(page.getByRole('img', { name: 'Аватар Луна' })).toHaveAttribute(
        'data-avatar-outfit',
        'spacesuit',
      );
    } finally {
      await server.stop();
    }
  });
}
