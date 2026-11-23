import { expect, test, type Page } from '@playwright/test';
import type { BotSlotConfig } from '../../shared/storage-schemas';
import { assertAxeClean, assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';
import { closeLobbyDialog, openLobbyDialog } from './lobby-navigation';

const DETECTIVE_BOT: BotSlotConfig = {
  id: 'bot-e2e-detective',
  name: 'Шерлок',
  color: 'p-4',
  enabled: true,
  harness: 'claude',
  model: 'haiku',
  effort: 'low',
  moveLimit: 4,
  imageSize: 400,
  budgetSec: 120,
  difficultyPreset: 'custom',
  personalityPreset: 'neutral',
  personalityText: '',
  playStyle: 'detective',
};

const SHORT_ROUND_NOTE =
  'Раунд длится 60 с, а Детективу нужно не меньше 90 с: в этой партии бот сыграет как Интуит';

async function enterLobby(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}

async function openBotSettings(page: Page, botName: string): Promise<void> {
  const roster = await openLobbyDialog(page, 'Участники');
  await roster.getByRole('button', { name: `Настройки ${botName}`, exact: true }).click();
  await expect(page.getByLabel('Имя бота')).toBeVisible();
}

// protects=the play style control in the bot settings, the 90 s budget floor of a Detective and the lobby note that a short round makes it play Intuit; fails_when=the control or the note disappears, a Detective keeps a budget under 90 s, or the note stays after the round is long enough; no_claim=what a real model does with either style.
test('the host sets a bot to Detective and the lobby says when it will play Intuit', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  try {
    await enterLobby(page, server.hostUrl);
    await openBotSettings(page, 'Клод');
    const style = page.getByRole('group', { name: 'Стиль игры' });
    await expect(style.getByRole('button', { name: 'Интуит', pressed: true })).toBeVisible();
    await expect(style.getByRole('note')).toHaveCount(0);

    await style.getByRole('button', { name: 'Детектив' }).click();
    await expect(style.getByRole('button', { name: 'Детектив', pressed: true })).toBeVisible();
    await expect(
      style.getByText(/^Два процесса: .* Детективу нужно не меньше 90 с$/),
    ).toBeVisible();
    await expect(style.getByRole('note')).toHaveText(SHORT_ROUND_NOTE);

    // The seeded bot had 60 s; a Detective keeps at least 90 s, also after a lower value is typed.
    await page.getByText('Дополнительно', { exact: true }).click();
    const budget = page.getByLabel('Бюджет раунда (с)');
    await expect(budget).toHaveValue('90');
    await budget.fill('60');
    await budget.press('Tab');
    await expect(budget).toHaveValue('90');
    await assertAxeClean(page, 'BotPlayStyle');
    await page.keyboard.press('Escape');

    const roster = page.getByRole('dialog', { name: 'Участники', exact: true });
    await expect(roster.getByText(SHORT_ROUND_NOTE)).toBeVisible();
    await expect(roster.getByText(/· Детектив/)).toHaveCount(0);
    await closeLobbyDialog(roster);

    const settings = await openLobbyDialog(page, 'Настройки партии');
    const duration = settings.getByLabel('Время раунда (с)');
    await duration.fill('120');
    await duration.press('Tab');
    await closeLobbyDialog(settings);

    const updated = await openLobbyDialog(page, 'Участники');
    await expect(updated.getByText(/· Детектив/)).toBeVisible();
    await expect(updated.getByText(SHORT_ROUND_NOTE)).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

async function playRoundToResults(page: Page, hostUrl: string): Promise<void> {
  await enterLobby(page, hostUrl);
  await page.getByRole('button', { name: 'Начать' }).click();
  const map = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(map).toBeVisible({ timeout: 12_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 20_000 });
}

// protects=the result card of a Detective round: style tag, final confidence and clue, the eyes' report by section, the numbered exchanges with their statuses, numbered frames and the token split by process; fails_when=one of these is missing, the card needs colour to tell a status, or it overflows at 320 px; no_claim=the scripted fake pair, not a real model.
test('the result card of a Detective shows the report, the exchanges and both processes', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({
    rounds: 1,
    roundDurationSec: 120,
    bots: [DETECTIVE_BOT],
  });
  try {
    await playRoundToResults(page, server.hostUrl);
    await page.getByRole('button', { name: 'почему?' }).first().click();
    const card = page.locator('.bot-card');
    await expect(card.getByRole('heading', { name: /Шерлок/ })).toContainText('Детектив');
    await expect(card.getByText(/^Я не видел кадров/)).toBeVisible();
    await expect(card.getByText('Уверенность: уверен в стране')).toBeVisible();
    await expect(card.getByText(/^Решающий признак: Разметка и столбы/)).toBeVisible();

    await card.getByRole('button', { name: 'Ход за ходом (4 шага)' }).click();
    const report = card.getByRole('region', { name: 'Отчёт глаз' });
    await expect(report.getByRole('heading', { name: 'Текст дословно' })).toBeVisible();
    await expect(report.getByText(/«MAGAZIN 24».*\(кадр 2\)/)).toBeVisible();
    await expect(report.getByText(/Сторона движения: правая.*\(кадр 1\)/)).toBeVisible();
    await expect(report.getByRole('heading', { name: 'Необычное' })).toHaveCount(0);

    await expect(card.getByRole('heading', { name: 'Запрос 1', exact: true })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Запрос 2', exact: true })).toBeVisible();
    await expect(
      card.getByRole('heading', { name: 'Запрос 3 · контрольная проверка' }),
    ).toBeVisible();
    await expect(card.getByText('МОЗГ Прочитать: вывеска над входом, кадр 2')).toBeVisible();
    await expect(card.getByText(/МОЗГ Проехать 400 м на 0° и описать: указатели/)).toBeVisible();
    await expect(
      card.getByText(/ГЛАЗА MAGAZIN 24 \| \+00 555 0100 \(уверенно · кадр 2\)/),
    ).toBeVisible();
    await expect(card.getByText('ГЛАЗА неразборчиво', { exact: true })).toBeVisible();
    await expect(
      card.getByText(/ГЛАЗА Обочина из светлого гравия\. \(неуверенно · кадр \d+\)/),
    ).toBeVisible();

    // Frames carry the number the report and the answers cite; the drive made frame 6.
    await expect(card.getByRole('button', { name: /^Кадр 1(:|$)/ })).toBeVisible();
    const driveFrame = card.getByRole('button', { name: /^Кадр 6: .*\d+ м от старта$/ });
    await driveFrame.click();
    const dialog = page.getByRole('dialog', { name: 'Снимок бота' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(driveFrame).toBeFocused();

    await card.getByRole('button', { name: 'Расход токенов и оценка стоимости' }).click();
    await expect(
      card.getByRole('region', { name: 'Расход токенов и оценка стоимости' }),
    ).toContainText(/Мозг: 3\s140 · Глаза: 4\s580/);
    await assertAxeClean(page, 'Detective card');

    await page.setViewportSize({ width: 320, height: 700 });
    await assertNoHorizontalOverflow(page);
    expect((await card.boundingBox())?.width ?? 0).toBeLessThanOrEqual(320);
  } finally {
    await server.stop();
  }
});
