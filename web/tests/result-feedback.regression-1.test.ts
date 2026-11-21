import { expect, test, type Page } from '@playwright/test';
import type { ServerMessage } from '../../shared/protocol';
import { assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

async function openBotResults(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
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

// Regression: ISSUE-002 — enlarged bot images used to appear below the timeline.
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Value: protects=visible modal, close paths and restored focus; fails_when=preview is inline or Escape closes the card; why_new=old tests only assert image visibility after autoscroll; seam=none; no_claim=fake images exercise browser behavior, not Google image retrieval.
test('bot snapshots open within the viewport and close back to the thumbnail', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  try {
    await openBotResults(page, server.hostUrl);
    const card = page.locator('.bot-card');
    await card.getByRole('button', { name: /Ход за ходом/ }).click();
    const thumbnail = card.locator('.frame-btn').first();
    const modal = page.getByRole('dialog', { name: 'Снимок бота' });
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 720 });
      await thumbnail.click();
      await expect(modal).toBeVisible();
      await expect(thumbnail).toHaveCSS('cursor', 'pointer');
      await expect(modal.getByRole('img')).toBeVisible();
      const bounds = await modal.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error('Missing preview bounds');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
      await page.screenshot({ path: test.info().outputPath(`snapshot-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
      await expect(thumbnail).toBeFocused();
      await expect(card).toBeVisible();
      await thumbnail.click();
      await modal.getByRole('button', { name: 'Закрыть снимок' }).click();
      await expect(thumbnail).toBeFocused();
      await thumbnail.click();
      await page.mouse.click(2, 2);
      await expect(modal).toHaveCount(0);
      await expect(thumbnail).toBeFocused();
      await assertNoHorizontalOverflow(page);
    }
  } finally {
    await server.stop();
  }
});
