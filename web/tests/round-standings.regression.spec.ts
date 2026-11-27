import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

type RoundScore = { name: string; score: number };
type MatchStanding = { name: string; rank: number; total: number };

function readNumber(value: string): number {
  const digits = value.replace(/\s/g, '');
  expect(digits).toMatch(/^\d+$/);
  return Number(digits);
}

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

async function readRoundScores(page: Page): Promise<RoundScore[]> {
  const table = page.locator('#round-results-panel .results-table');
  await expect(table).toBeVisible();
  expect(await table.locator('thead th').allTextContents()).toEqual([
    '#',
    'Участник',
    'Дистанция',
    'За раунд',
    '',
  ]);
  const rows = table.locator('tbody > tr').filter({ has: page.locator('.p-name') });
  return Promise.all(
    (await rows.all()).map(async (row) => ({
      name: await row.locator('.p-name').innerText(),
      score: readNumber(await row.locator('td.num-col').innerText()),
    })),
  );
}

async function readMatchStandings(page: Page): Promise<MatchStanding[]> {
  const table = page.getByTestId('match-standings-table');
  await expect(table).toBeVisible();
  expect(await table.locator('thead th').allTextContents()).toEqual(['#', 'Участник', 'Всего']);
  return Promise.all(
    (await table.locator('tbody > tr').all()).map(async (row) => ({
      rank: readNumber(await row.locator('.rank-cell').innerText()),
      name: await row.locator('.p-name').innerText(),
      total: readNumber(await row.locator('td.num-col').innerText()),
    })),
  );
}

function expectDescendingRankedTotals(standings: MatchStanding[]): void {
  expect(standings.map((standing) => standing.total)).toEqual(
    [...standings].map((standing) => standing.total).sort((a, b) => b - a),
  );
  expect(standings[0]?.rank).toBe(1);
  for (const [index, standing] of standings.entries()) {
    const previous = standings[index - 1];
    if (!previous) continue;
    if (previous.total > standing.total) expect(standing.rank).toBe(index + 1);
    else expect([previous.rank, index + 1]).toContain(standing.rank);
  }
}

// protects=each results screen starts on the non-spoiling round tab and exposes cumulative scores
// only after the optional tab is selected; fails_when=totals leak into the round table, the active
// tab persists into the next round, or standings no longer aggregate and rank the played rounds.
test('round results default to per-round scores and reveal ordered match standings on demand', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 2 });
  try {
    await join(page, server.hostUrl, 'Оля');
    await page.getByRole('button', { name: 'Начать' }).click();

    await finishRound(page);
    const roundOne = await readRoundScores(page);
    expect(roundOne.map(({ name }) => name).sort()).toEqual(['Клод', 'Оля']);
    expect(roundOne.some(({ score }) => score > 0)).toBe(true);
    await expect(page.getByRole('tab', { name: 'Раунд' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Рейтинг за игру' })).toBeVisible();
    await expect(page.getByTestId('match-standings-table')).toHaveCount(0);
    await expect(page.locator('.match-lead')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Рейтинг за игру' }).click();
    const firstStandings = await readMatchStandings(page);
    expect(firstStandings.map((standing) => standing.name).sort()).toEqual(
      roundOne.map((score) => score.name).sort(),
    );
    for (const standing of firstStandings) {
      expect(standing.total).toBe(roundOne.find((score) => score.name === standing.name)?.score);
    }
    expectDescendingRankedTotals(firstStandings);

    await page.setViewportSize({ width: 653, height: 280 });
    const lastScore = page.getByTestId('match-standings-table').getByRole('row').last();
    await lastScore.scrollIntoViewIfNeeded();
    await expect(lastScore).toBeInViewport({ ratio: 0.9 });

    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await finishRound(page);
    const roundTwo = await readRoundScores(page);
    await expect(page.getByRole('tab', { name: 'Раунд' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('match-standings-table')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Рейтинг за игру' }).click();
    const secondStandings = await readMatchStandings(page);
    expect(secondStandings).toHaveLength(2);
    for (const standing of secondStandings) {
      const first = roundOne.find((score) => score.name === standing.name)?.score ?? 0;
      const second = roundTwo.find((score) => score.name === standing.name)?.score ?? 0;
      expect(standing.total).toBe(first + second);
    }
    expectDescendingRankedTotals(secondStandings);
  } finally {
    await server.stop();
  }
});
