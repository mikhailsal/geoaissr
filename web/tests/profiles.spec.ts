import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { ParticipantColorId } from '../../shared/colors';
import type { BotSlotConfig, MatchRecord } from '../../shared/storage-schemas';
import { assertAxeClean, assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

const PROFILE_ID = 'a676dfca-4d53-4b64-83c4-aaf373546aa9';
type Profile = { profileId: string; nick: string; color: ParticipantColorId };

async function seedProfile(context: BrowserContext, profile: Profile): Promise<void> {
  await context.addInitScript((value) => {
    localStorage.setItem(`geoaissr:profile:${location.origin}`, JSON.stringify(value));
  }, profile);
}

async function savedProfile(page: Page): Promise<Profile> {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem(`geoaissr:profile:${location.origin}`) ?? 'null') as Profile,
  );
}

async function join(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText(/ИГРОКИ/)).toBeVisible();
}

async function guess(page: Page): Promise<void> {
  const canvas = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 12_000 });
  await canvas.click({ position: { x: 140, y: 110 } });
  await page.getByRole('button', { name: 'Угадать', exact: true }).click();
}

function bot(id: string, name: string, color: ParticipantColorId): BotSlotConfig {
  return {
    id,
    name,
    color,
    enabled: true,
    harness: 'claude',
    model: 'haiku',
    effort: 'low',
    moveLimit: 1,
    imageSize: 400,
    budgetSec: 60,
    difficultyPreset: 'amateur',
    personalityPreset: 'neutral',
    personalityText: '',
  };
}

function win(id: string, winnerId: string, isAi: boolean): MatchRecord {
  const endedAt = new Date(Date.now() - 60_000).toISOString();
  return {
    version: 1,
    matchId: id,
    startedAt: endedAt,
    endedAt,
    region: 'world',
    plannedRounds: 1,
    playedRounds: 1,
    moveEnabled: true,
    participants: [
      {
        id: winnerId,
        ...(isAi ? {} : { profileId: PROFILE_ID }),
        name: 'Old name',
        isAi,
        color: isAi ? 'p-4' : 'p-1',
        totalScore: 5000,
        rank: 1,
        answeredRounds: 1,
        totalDistanceKm: 0,
      },
    ],
    humanVsAi: { visible: false, humansTotal: 0, aiTotal: 0 },
    rounds: [],
  };
}

async function expectWins(page: Page, name: string, count: number): Promise<void> {
  const badges = page.getByLabel(`Побед за 6 часов: ${count} — ${name}`, { exact: true });
  await expect(badges.first()).toBeVisible();
  expect(await badges.count()).toBeGreaterThan(0);
}

// protects=browser profile survives restore/restart and autojoins without a manual form even without randomUUID; fails_when=identity changes, stale session blocks entry, or Join flashes; no_claim=does not cover another browser or unavailable browser storage
test('saved profile autojoins after a server restart with a fresh session', async ({ browser }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  const context = await browser.newContext();
  // HTTP origins can expose getRandomValues while omitting randomUUID.
  await context.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  try {
    await join(page, server.hostUrl, 'Возвращаюсь');
    const profile = await savedProfile(page);
    expect(profile).toMatchObject({ nick: 'Возвращаюсь', color: 'p-1' });
    expect(profile.profileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await page.evaluate(() => {
      localStorage.removeItem(`geoaissr:profile:${location.origin}`);
    });
    await page.reload();
    await expect(page.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    await expect.poll(() => savedProfile(page)).toEqual(profile);
    const oldSession = await page.evaluate(() =>
      localStorage.getItem(`geoaissr:player:${location.origin}`),
    );
    await page.addInitScript(() => {
      const state = window as Window & { joinFormSeen?: boolean };
      state.joinFormSeen = false;
      new MutationObserver(() => {
        if (document.querySelector('.join-form')) state.joinFormSeen = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await server.restart();
    await page.goto('about:blank');
    await page.goto(server.hostUrl);
    await expect(page.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    expect(await savedProfile(page)).toEqual(profile);
    expect(
      await page.evaluate(() => localStorage.getItem(`geoaissr:player:${location.origin}`)),
    ).not.toBe(oldSession);
    expect(
      await page.evaluate(() => (window as Window & { joinFormSeen?: boolean }).joinFormSeen),
    ).toBe(false);
    await expect(page.getByLabel('Ваше имя')).toHaveCount(0);
  } finally {
    await context.close();
    await server.stop();
  }
});

// protects=automatic name/color conflicts return to a prefilled form without replacing the saved profile or stealing a seat; fails_when=conflicts silently pick another color/name or erase stored values; no_claim=does not prove session-secret cryptography
test('saved name and color conflicts retain the rejected profile for correction', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const host = await browser.newPage();
  const contexts: BrowserContext[] = [];
  try {
    await join(host, server.hostUrl, 'Занято');
    for (const profile of [
      { profileId: PROFILE_ID, nick: 'Занято', color: 'p-2' },
      { profileId: 'd22113bd-604b-4fae-bc6e-a02fc288ea2b', nick: 'Новичок', color: 'p-1' },
    ] satisfies Profile[]) {
      const context = await browser.newContext();
      contexts.push(context);
      await seedProfile(context, profile);
      const page = await context.newPage();
      await page.goto(server.guestUrl);
      await expect(page.getByRole('alert')).toContainText(
        profile.color === 'p-1' ? 'Цвет уже занят' : 'Ник занят',
      );
      await expect(page.getByLabel('Ваше имя')).toHaveValue(profile.nick);
      await expect(
        page.getByRole('radio', {
          name: profile.color === 'p-1' ? 'оранжевый' : 'малиновый',
          exact: true,
        }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(await savedProfile(page)).toEqual(profile);
    }
    await expect(host.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    const recovery = contexts[1];
    if (!recovery) throw new Error('Missing conflict context');
    const page = recovery.pages()[0];
    if (!page) throw new Error('Missing conflict page');
    await page.getByRole('radio', { name: 'сиреневый', exact: true }).click();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(host.getByText(/ИГРОКИ 2 из 8/)).toBeVisible();
    await expect
      .poll(() => savedProfile(page))
      .toMatchObject({
        nick: 'Новичок',
        color: 'p-3',
        profileId: 'd22113bd-604b-4fae-bc6e-a02fc288ea2b',
      });
  } finally {
    for (const context of contexts) await context.close();
    await host.close();
    await server.stop();
  }
});

// protects=successful Lobby/FINAL edits broadcast and persist while rejected edits do not persist and active phases hide editing; fails_when=another client stays stale, identity changes, or midmatch editing appears; no_claim=does not cover every concurrent edit ordering
test('profile modal edits in Lobby and Final and preserves rejected values', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await join(host, server.hostUrl, 'abcdefghijklmnopqrst');
    await join(guest, server.guestUrl, 'Сосед');
    await host.setViewportSize({ width: 375, height: 667 });
    const editBounds = await host
      .getByRole('button', { name: 'Изменить профиль', exact: true })
      .boundingBox();
    expect(editBounds).not.toBeNull();
    if (editBounds) expect(editBounds.x + editBounds.width).toBeLessThanOrEqual(375);
    await assertNoHorizontalOverflow(host);
    await host.setViewportSize({ width: 1280, height: 720 });
    const original = await savedProfile(host);
    await host.getByRole('button', { name: 'Изменить профиль', exact: true }).click();
    const dialog = host.getByRole('dialog', { name: 'Редактирование профиля' });
    await expect(dialog.getByLabel('Имя', { exact: true })).toBeFocused();
    await dialog.getByLabel('Имя', { exact: true }).fill('Сосед');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(await savedProfile(host)).toEqual(original);
    await dialog.getByLabel('Имя', { exact: true }).fill('Новое имя');
    await dialog.getByRole('radio', { name: 'синий', exact: true }).click();
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(guest.getByText('Новое имя', { exact: true })).toBeVisible();
    expect(await savedProfile(host)).toEqual({ ...original, nick: 'Новое имя', color: 'p-5' });
    await expect(host.getByRole('button', { name: 'Изменить профиль', exact: true })).toBeFocused();

    await guest.getByRole('button', { name: 'Изменить профиль', exact: true }).click();
    const guestDialog = guest.getByRole('dialog', { name: 'Редактирование профиля' });
    await guestDialog.getByLabel('Имя', { exact: true }).fill('Не сохранять');
    await host.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(guestDialog).toHaveCount(0);
    await guess(host);
    await expect(host.getByRole('button', { name: 'Изменить профиль', exact: true })).toHaveCount(
      0,
    );
    await guess(guest);
    await expect(host.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
    await expect(host.getByRole('button', { name: 'Изменить профиль', exact: true })).toHaveCount(
      0,
    );
    await host.getByRole('button', { name: 'К итогам', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Ещё раз', exact: true })).toBeVisible();
    await expect(guestDialog).toHaveCount(0);
    expect(await savedProfile(guest)).toMatchObject({ nick: 'Сосед' });
    await host.getByRole('button', { name: 'Изменить профиль', exact: true }).click();
    await host.setViewportSize({ width: 375, height: 667 });
    await expect(dialog.getByLabel('Имя', { exact: true })).toHaveValue('Новое имя');
    await expect(dialog.getByRole('radio', { name: 'синий', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await assertAxeClean(host, 'ProfileModal');
    await assertNoHorizontalOverflow(host);
    await dialog.getByLabel('Имя', { exact: true }).fill('Финальное имя');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(guest.getByText('Финальное имя', { exact: true }).first()).toBeVisible();
    expect(await savedProfile(host)).toEqual({ ...original, nick: 'Финальное имя', color: 'p-5' });
  } finally {
    await hostContext.close();
    await guestContext.close();
    await server.stop();
  }
});

// protects=history-backed avatar counts in all phases and perbot host reset broadcasts/persists without clearing another identity; fails_when=one screen omits wins, a partial match adds a win, or reset leaks across participants/restart; no_claim=does not wait six real hours or use paid model providers
test('six-hour badges span every phase and individual bot resets survive restart', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({
    rounds: 2,
    bots: [bot('bot-e2e-1', 'Первый', 'p-4'), bot('bot-e2e-2', 'Второй', 'p-6')],
    initialMatches: [
      win('h1', 'old-session', false),
      win('h2', 'another-session', false),
      win('b1', 'bot-e2e-1', true),
      win('b2', 'bot-e2e-1', true),
      win('b3', 'bot-e2e-2', true),
    ],
  });
  const context = await browser.newContext();
  await seedProfile(context, { profileId: PROFILE_ID, nick: 'С победами', color: 'p-1' });
  const host = await context.newPage();
  const guest = await browser.newPage();
  try {
    await host.goto(server.hostUrl);
    await expect(host.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    await join(guest, server.guestUrl, 'Наблюдатель');
    for (const page of [host, guest]) {
      await expectWins(page, 'С победами', 2);
      await expectWins(page, 'Первый', 2);
      await expectWins(page, 'Второй', 1);
    }
    await expect(guest.getByRole('button', { name: /^Сбросить победы/ })).toHaveCount(0);
    await host.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(host.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
    await expectWins(host, 'С победами', 2);
    await expectWins(host, 'Первый', 2);
    await expect(host.getByRole('button', { name: /^Сбросить победы/ })).toHaveCount(0);
    await guess(host);
    await guess(guest);
    await expect(host.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
    await expectWins(host, 'С победами', 2);
    await expectWins(host, 'Первый', 2);
    await host.getByRole('button', { name: 'Меню хоста', exact: true }).click();
    await host.getByRole('menuitem', { name: 'Завершить партию', exact: true }).click();
    await host.getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Ещё раз', exact: true })).toBeVisible();
    await expectWins(host, 'С победами', 2);
    await expectWins(host, 'Первый', 2);
    await host.getByRole('button', { name: 'Сбросить победы Первый', exact: true }).click();
    for (const page of [host, guest]) {
      await expectWins(page, 'Первый', 0);
      await expectWins(page, 'Второй', 1);
      await expectWins(page, 'С победами', 2);
    }
    await server.restart();
    await host.goto(server.hostUrl);
    await expect(host.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    await expectWins(host, 'Первый', 0);
    await expectWins(host, 'Второй', 1);
    await expectWins(host, 'С победами', 2);
  } finally {
    await context.close();
    await guest.close();
    await server.stop();
  }
});

// protects=an unreadable optional win history does not block joining and visibly reports unavailable statistics; fails_when=startup crashes or history failure looks like healthy zero wins; no_claim=does not repair files or simulate every filesystem error
test('unreadable match history warns the room while play remains available', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1, unreadableHistory: true });
  const page = await browser.newPage();
  try {
    await join(page, server.hostUrl, 'История');
    await expect(page.getByRole('alert')).toContainText(/побед|истори/i);
    await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeEnabled();
    await expectWins(page, 'История', 0);
  } finally {
    await page.close();
    await server.stop();
  }
});
