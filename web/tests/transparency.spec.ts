import { expect, test, type Page } from '@playwright/test';
import type { ServerMessage } from '../../shared/protocol';
import { assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

async function injectSnapshot(
  page: Page,
  legacy = false,
  replacement?: { send?: () => void; partial?: boolean },
): Promise<void> {
  await page.routeWebSocket('**/*', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (typeof message !== 'string') {
        socket.send(message);
        return;
      }
      const parsed = JSON.parse(message) as ServerMessage;
      if (parsed.type === 'state' && parsed.view.results) {
        for (const entry of parsed.view.results.entries) {
          if (!entry.isAi || !entry.thumbs[0]) continue;
          if (legacy) {
            delete entry.journal;
            delete entry.tokenUsage;
            delete entry.costUsd;
            entry.explanation = 'Старая версия объяснения';
            if (replacement?.partial) entry.conclusion = 'Частичный вывод';
            continue;
          }
          Object.assign(entry, {
            explanation: 'Дублирующее старое объяснение',
            usedDraft: true,
            tokenUsage: {
              inputTokens: 1000,
              outputTokens: 200,
              cachedInputTokens: 300,
              totalTokens: 1200,
            },
            costUsd: 0.014,
            matchedModelId: 'provider/model',
            isApproximateMatch: true,
          });
        }
      }
      if (replacement && parsed.type === 'state' && parsed.view.results) {
        replacement.send = () => {
          const entry = parsed.view.results?.entries.find((item) => item.isAi);
          if (entry) {
            entry.costUsd = 0.1234;
            if (replacement.partial) entry.conclusion = 'Частичный вывод';
          }
          socket.send(JSON.stringify(parsed));
        };
      }
      socket.send(JSON.stringify(parsed));
    });
  });
}

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
  await page.getByRole('button', { name: 'почему?' }).first().click();
}

// protects=reasoning order, grouped observations, zoom, hypotheses, preview and accessible accounting dismissal at mobile width; fails_when=the snapshot renders out of order, overflows, loses metadata or Escape closes the card first; no_claim=synthetic snapshot verifies rendering, not provider parsing or real billing.
test('renders transparent bot snapshot and supports accounting interactions', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  try {
    await injectSnapshot(page);
    await openResults(page, server.hostUrl);
    await page.setViewportSize({ width: 375, height: 800 });
    const card = page.locator('.bot-card');
    const text = await card.innerText();
    expect(text.indexOf('Рассказ бота')).toBeLessThan(text.indexOf('Ход за ходом'));
    const toggleBox = await card.getByRole('button', { name: /Ход за ходом/ }).boundingBox();
    const accountingBox = await card.getByRole('group', { name: 'Расход бота' }).boundingBox();
    expect(toggleBox?.y ?? 0).toBeLessThan(accountingBox?.y ?? 0);
    await expect(card.getByText('Черновик')).toBeVisible();
    await expect(card).not.toContainText('Дублирующее старое объяснение');
    await card.getByRole('button', { name: /Ход за ходом/ }).click();
    await expect(card.getByRole('heading', { name: 'Первый взгляд' })).toBeVisible();
    await card.locator('.frame-btn').first().click();
    await expect(card.locator('.zoomed-preview img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.locator('.zoomed-preview')).toHaveCount(0);
    const badge = card.getByRole('button', { name: 'Расход токенов и оценка стоимости' });
    await badge.click();
    const details = card.getByRole('region', { name: 'Расход токенов и оценка стоимости' });
    await expect(details).toContainText('Input: 1');
    await expect(details).toContainText('provider/model (приблизительное совпадение)');
    await expect(details).toContainText('API-цена для справки');
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await expect(card).toBeVisible();
    await badge.click();
    await expect(details).toBeVisible();
    await card.locator('h3').click();
    await expect(details).toHaveCount(0);
    await badge.focus();
    await expect(details).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

// protects=legacy and partial structured reasoning with missing usage when coordinates exist; fails_when=valid fallback explanation disappears, missing reasoning is treated as no guess or unavailable accounting is invented; no_claim=synthetic snapshot does not test storage migration.
test('renders legacy reasoning and unavailable accounting', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  const replacement: { send?: () => void; partial?: boolean } = {};
  try {
    await injectSnapshot(page, true, replacement);
    await openResults(page, server.hostUrl);
    const card = page.locator('.bot-card');
    await expect(card).toContainText('Старая версия объяснения');
    await expect(card.getByRole('button', { name: /Ход за ходом/ })).toHaveCount(0);
    await expect(card).not.toContainText('нет догадки');
    const badge = card.getByRole('button', { name: 'Расход токенов и оценка стоимости' });
    await expect(badge).toContainText('н/д · н/д');
    await badge.click();
    await expect(
      card.getByRole('region', { name: 'Расход токенов и оценка стоимости' }),
    ).toContainText('Input: н/д');
    replacement.partial = true;
    expect(replacement.send).toBeDefined();
    replacement.send?.();
    await expect(card).toContainText('Частичный вывод');
    await expect(card).not.toContainText('Старая версия объяснения');
  } finally {
    await server.stop();
  }
});

// protects=mouse hover dismissal and same-card snapshot continuity; fails_when=hover sticks or a price update resets preview, details or focus; why_new=existing interactions only use click/focus and one snapshot; seam=none; no_claim=synthetic snapshot timing does not prove server delivery timing.
test('hover details dismiss and a same-card update preserves open state', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  const replacement: { send?: () => void } = {};
  try {
    await injectSnapshot(page, false, replacement);
    await openResults(page, server.hostUrl);
    const card = page.locator('.bot-card');
    const badge = card.getByRole('button', { name: 'Расход токенов и оценка стоимости' });
    const details = card.getByRole('region', { name: 'Расход токенов и оценка стоимости' });
    await badge.hover();
    await expect(details).toBeVisible();
    await card.locator('h3').hover();
    await expect(details).toHaveCount(0);
    await card.getByRole('button', { name: /Ход за ходом/ }).click();
    await card.locator('.frame-btn').first().click();
    await expect(card.locator('.zoomed-preview')).toBeVisible();
    const closeImage = page.getByRole('button', { name: 'Закрыть снимок' });
    await expect(closeImage).toBeFocused();
    expect(replacement.send).toBeDefined();
    replacement.send?.();
    await expect(badge).toContainText('~$0.123');
    await expect(card.locator('.zoomed-preview')).toBeVisible();
    await expect(closeImage).toBeFocused();
    await closeImage.click();
    await badge.click();
    await expect(details).toBeVisible();
    // Keep the pointer away so this checks pinned state without a fresh hover.
    await card.locator('h3').hover();
    await expect(details).toBeVisible();
    await badge.focus();
    await expect(badge).toBeFocused();
    expect(replacement.send).toBeDefined();
    replacement.send?.();
    await expect(badge).toContainText('~$0.123');
    await expect(details).toBeVisible();
    await expect(badge).toBeFocused();
  } finally {
    await server.stop();
  }
});
