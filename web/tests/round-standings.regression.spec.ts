import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

type Scores = { name: string; round: number; total: number };

function readNumber(value: string): number {
  const digits = value.replace(/\s/g, '');
  expect(digits).toMatch(/^\d+$/);
  return Number(digits);
}

async function readScores(page: Page): Promise<Scores[]> {
  const table = page.locator('.results-table');
  const headers = await table.locator('thead th').allTextContents();
  const roundColumn = headers.indexOf('За раунд');
  const totalColumn = headers.indexOf('Всего');
  expect(roundColumn).toBeGreaterThan(-1);
  expect(totalColumn).toBeGreaterThan(roundColumn);
  const rows = table.locator('tbody > tr');
  return Promise.all(
    (await rows.all()).map(async (row) => ({
      name: await row.locator('.p-name').innerText(),
      round: readNumber(await row.locator('td').nth(roundColumn).innerText()),
      total: readNumber(await row.locator('td').nth(totalColumn).innerText()),
    })),
  );
}

async function finishRound(page: Page): Promise<void> {
  const map = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(map).toBeVisible({ timeout: 12_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 15_000 });
}

// Value: protects=separate round and match-total standings before final; fails_when=the columns
// merge, cumulative values reset, or the visible leader is inconsistent with the displayed totals;
// why_new=the match flow reaches round two without comparing its standings; seam=fake bot scores.
test('second-round standings keep round scores, totals, and the match leader', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 2 });
  try {
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Оля');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: 'Начать' }).click();

    await finishRound(page);
    const first = await readScores(page);
    expect(first.map((score) => score.name).sort()).toEqual(['Клод', 'Оля']);
    expect(first.some((score) => score.round > 0)).toBe(true);

    await page.getByRole('button', { name: 'Дальше' }).click();
    await finishRound(page);
    await expect(page.getByRole('button', { name: 'К итогам' })).toBeVisible();

    const second = await readScores(page);
    const firstByName = new Map(first.map((score) => [score.name, score.round]));
    for (const score of second) {
      expect(score.total).toBe((firstByName.get(score.name) ?? 0) + score.round);
    }
    const high = Math.max(...second.map((score) => score.total));
    const leaders = second.filter((score) => score.total === high).map((score) => score.name);
    const summary = await page.locator('.match-lead').innerText();
    if (leaders.length === 1) expect(summary).toBe(`Лидер партии: ${leaders[0]}`);
    else expect(leaders.some((name) => summary.includes(name))).toBe(true);
  } finally {
    await server.stop();
  }
});
