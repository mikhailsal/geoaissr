import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

async function join(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const acknowledgement = page.getByRole('button', { name: 'Понятно', exact: true });
  if (await acknowledgement.isVisible()) await acknowledgement.click();
}

async function finishRound(page: Page): Promise<void> {
  const map = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(map).toBeVisible({ timeout: 12_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 15_000 });
}

async function expectRoundTab(page: Page): Promise<void> {
  const table = page.locator('#round-results-panel .results-table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText([
    '#',
    'Участник',
    'Дистанция',
    'За раунд',
    '',
  ]);
  await expect(page.getByRole('tab', { name: 'Раунд' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('match-standings-table')).toHaveCount(0);
}

async function expectStandingsTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Рейтинг за игру' }).click();
  const table = page.getByTestId('match-standings-table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['#', 'Участник', 'Всего']);
  await expect(table.locator('tbody > tr')).toHaveCount(2);
}

// protects=each results screen starts on the non-spoiling round tab and exposes the match standings
// only after the optional tab is selected, and the table stays reachable in a short window; the
// totals and their order are checked on the server (view.test.ts); fails_when=totals leak into the
// round table, the active tab persists into the next round, or the standings cannot be scrolled to.
test('round results default to the round tab and reveal the match standings on demand', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 2 });
  try {
    await join(page, server.hostUrl, 'Оля');
    await page.getByRole('button', { name: 'Начать' }).click();

    await finishRound(page);
    await expectRoundTab(page);
    await expect(page.getByRole('tab', { name: 'Рейтинг за игру' })).toBeVisible();
    await expect(page.locator('.match-lead')).toHaveCount(0);
    await expectStandingsTab(page);

    await page.setViewportSize({ width: 653, height: 280 });
    const lastScore = page.getByTestId('match-standings-table').getByRole('row').last();
    await lastScore.scrollIntoViewIfNeeded();
    await expect(lastScore).toBeInViewport({ ratio: 0.9 });

    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await finishRound(page);
    await expectRoundTab(page);
    await expectStandingsTab(page);
  } finally {
    await server.stop();
  }
});
