import { expect, test } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

// Found by the /ship design review on 2026-11-20: at phone widths «почему?» sat past the table's
// right edge, so players could miss the bot journal.
// Value: protects=the journal trigger is on screen at 320 px and the results table does not scroll sideways; fails_when=the trigger returns to the last column on narrow tables or the table overflows; why_new=no test opened the card from the trigger at phone width; seam=none; no_claim=other phone heights or browsers than Chromium.
test('the «почему?» trigger stays on screen on a 320 px results table', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  try {
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Оля');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    const map = page.getByTestId('fake-guess-map').locator('canvas');
    await expect(map).toBeVisible({ timeout: 12_000 });
    await map.click({ position: { x: 100, y: 100 } });
    await page.getByRole('button', { name: 'Угадать' }).click();
    await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 320, height: 800 });
    const why = page.getByRole('button', { name: 'почему?' });
    await expect(why).toHaveCount(1);
    const box = await why.boundingBox();
    expect((box?.x ?? 999) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    const table = await page
      .locator('.table-scroll')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(table).toBeLessThanOrEqual(0);
    await why.click();
    await expect(page.locator('.bot-card')).toBeVisible();
  } finally {
    await server.stop();
  }
});
