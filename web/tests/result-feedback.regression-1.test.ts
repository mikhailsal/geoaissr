import { expect, test, type Page } from '@playwright/test';
import type { ServerMessage } from '../../shared/protocol';
import { startIsolatedFakeServer } from './helpers';

async function openBotResults(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const map = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(map).toBeVisible({ timeout: 12_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await page.getByRole('button', { name: 'почему?' }).first().click();
}

// Regression: ISSUE-001 — prices need three decimals and concise reference copy.
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Value: protects=reference price precision and missing-price display; fails_when=precision/copy changes or missing price becomes zero; why_new=existing tests cover tooltip interaction only; seam=none; no_claim=synthetic accounting does not test provider billing.
test('reference API prices round to three decimals with concise copy', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  let price: number | undefined = 0.00065;
  let update: (() => void) | undefined;
  try {
    await page.routeWebSocket('**/*', (socket) => {
      const upstream = socket.connectToServer();
      upstream.onMessage((message) => {
        if (typeof message !== 'string') {
          socket.send(message);
          return;
        }
        const snapshot = JSON.parse(message) as ServerMessage;
        const entry =
          snapshot.type === 'state' && snapshot.view.results?.entries.find((e) => e.isAi);
        if (entry) {
          update = () => {
            entry.costUsd = price;
            socket.send(JSON.stringify(snapshot));
          };
          update();
        } else socket.send(message);
      });
    });
    await openBotResults(page, server.hostUrl);
    const badge = page.getByRole('button', { name: 'Расход токенов и оценка стоимости' });
    for (const [value, expected] of [
      [0.00065, '~$0.001'],
      [0.12345, '~$0.123'],
      [0, '~$0.000'],
      [undefined, 'н/д'],
    ] as const) {
      price = value;
      update?.();
      await expect(badge).toContainText(`· ${expected}`);
    }
    await badge.click();
    const details = page.getByRole('region', { name: 'Расход токенов и оценка стоимости' });
    await expect(details).toContainText('API-цена для справки');
    await expect(details).not.toContainText('не фактическая стоимость подписки');
  } finally {
    await server.stop();
  }
});
