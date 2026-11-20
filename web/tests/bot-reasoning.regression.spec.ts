import { expect, test } from '@playwright/test';
import type { ServerMessage } from '../../shared/protocol';
import { startIsolatedFakeServer } from './helpers';

const LONG = 'длинноеслово'.repeat(40);

// protects=honest placeholders for a missing summary, unrecorded or unfinished findings and a missing point, plus plain-text rendering of model text; fails_when=a placeholder disappears or model markup is interpreted; no_claim=synthetic journal, not real model compliance.
test('renders honest placeholders and treats model text as plain text', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.routeWebSocket('**/*', (socket) => {
      const upstream = socket.connectToServer();
      upstream.onMessage((message) => {
        if (typeof message !== 'string') {
          socket.send(message);
          return;
        }
        const parsed = JSON.parse(message) as ServerMessage;
        if (parsed.type === 'state' && parsed.view.results) {
          for (const entry of parsed.view.results.entries) {
            if (!entry.isAi || !entry.journal) continue;
            const [first, second, third] = entry.journal.steps;
            if (!first || !second || !third) continue;
            delete entry.journal.summary;
            second.findingState = 'missing';
            delete second.finding;
            second.pointMissing = true;
            third.findingState = 'round-ended';
            delete third.finding;
            third.reason = `<b>жирный</b> ${LONG}`;
          }
        }
        socket.send(JSON.stringify(parsed));
      });
    });
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Оля');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    const map = page.getByTestId('fake-guess-map').locator('canvas');
    await expect(map).toBeVisible({ timeout: 12_000 });
    await map.click({ position: { x: 100, y: 100 } });
    await page.getByRole('button', { name: 'Угадать' }).click();
    await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'почему?' }).first().click();
    const card = page.locator('.bot-card');
    await expect(card.getByText('Итог не записан')).toBeVisible();
    await card.getByRole('button', { name: /Ход за ходом/ }).click();
    await expect(card.getByText('вывод не записан')).toBeVisible();
    await expect(card.getByText('раунд закончился раньше вывода')).toBeVisible();
    await expect(card.getByText('новая точка не записана')).toBeVisible();
    await expect(card).toContainText('<b>жирный</b>');
    await expect(card.locator('b')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await server.stop();
  }
});
