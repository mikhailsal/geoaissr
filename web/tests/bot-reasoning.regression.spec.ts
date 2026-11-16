import { expect, test } from '@playwright/test';
import type { ServerMessage } from '../../shared/protocol';
import { startIsolatedFakeServer } from './helpers';

// Found by /qa on 2026-11-16
// Report: /tmp/geoaissr-qa-20261116/qa-report-geoaissr-2026-11-16.md
// Value: protects=explicitly empty alternatives and absent legacy data render differently; fails_when=honest empty list disappears; why_new=existing snapshot covers populated alternatives only; seam=none; no_claim=real model compliance.
test('shows an honest empty alternatives list but hides absent legacy alternatives', async ({
  page,
}, testInfo) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let sendLegacy: (() => void) | undefined;
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
          for (const entry of parsed.view.results.entries)
            if (entry.isAi) entry.rejectedGuesses = [];
          sendLegacy = () => {
            if (!parsed.view.results) return;
            for (const entry of parsed.view.results.entries)
              if (entry.isAi) delete entry.rejectedGuesses;
            socket.send(JSON.stringify(parsed));
          };
        }
        socket.send(JSON.stringify(parsed));
      });
    });
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Оля');
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.getByRole('button', { name: 'Начать' }).click();
    const map = page.getByTestId('fake-guess-map').locator('canvas');
    await expect(map).toBeVisible({ timeout: 12_000 });
    await map.click({ position: { x: 100, y: 100 } });
    await page.getByRole('button', { name: 'Угадать' }).click();
    await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'почему?' }).first().click();
    const card = page.locator('.bot-card');
    await expect(card.getByText('Нет обоснованных исключённых версий.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('reasoning-after.png') });
    expect(sendLegacy).toBeDefined();
    sendLegacy?.();
    await expect(card.getByText('Исключённые версии')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await server.stop();
  }
});
