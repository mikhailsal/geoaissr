import { expect, test, type Page } from '@playwright/test';
import { assertAxeClean, assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

async function openResults(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const map = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(map).toBeVisible({ timeout: 12_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 15_000 });
}

// protects=journal card order, collapsed-by-default steps, shift text labels, pin lines, preview focus restore and 320px layout; fails_when=the journal is expanded by default, a label disappears, Escape loses focus or the card overflows; no_claim=fake bot output, not real model compliance.
test('journal card shows the summary, expands steps and restores focus after preview', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  try {
    await openResults(page, server.hostUrl);
    await page.getByRole('button', { name: 'почему?' }).first().click();
    const card = page.locator('.bot-card');
    await expect(card.getByText('Рассказ бота', { exact: true })).toBeVisible();
    await expect(card.getByText(/^Я увидел/)).toBeVisible();
    const toggle = card.getByRole('button', { name: 'Ход за ходом (3 шага)' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(card.locator('.frame-btn')).toHaveCount(0);
    const text = await card.innerText();
    expect(text.indexOf('Рассказ бота')).toBeLessThan(text.indexOf('Ход за ходом'));

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(card.getByRole('heading', { name: 'Первый взгляд' })).toBeVisible();
    await expect(card.getByText('Вывод:').first()).toBeVisible();
    for (const label of ['Отпало', 'Менее вероятно', 'Более вероятно'])
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    await expect(card.getByText('первая точка')).toBeVisible();
    await expect(card.getByText(/точка сдвинулась на/).first()).toBeVisible();

    const frame = card.getByRole('button', { name: /^Кадр шага 1:/ });
    await frame.click();
    const dialog = page.getByRole('dialog', { name: 'Снимок бота' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(frame).toBeFocused();
    await expect(card).toBeVisible();
    await assertAxeClean(page, 'BotJournal');

    await page.setViewportSize({ width: 320, height: 700 });
    await assertNoHorizontalOverflow(page);
    const box = await card.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(320);
    await expect(page.getByRole('button', { name: 'свернуть' }).first()).toBeVisible();
  } finally {
    await server.stop();
  }
});
