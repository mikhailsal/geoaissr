import { closeLobbyDialog, expectLobbyPlayers, openLobbyDialog } from './lobby-navigation';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ParticipantColorId } from '../../shared/colors';
import type { BotSlotConfig, MatchRecord } from '../../shared/storage-schemas';
import { assertAxeClean, startIsolatedFakeServer } from './helpers';

const PROFILE_ID = 'a676dfca-4d53-4b64-83c4-aaf373546aa9';
type Profile = {
  profileId: string;
  nick: string;
  color: ParticipantColorId;
  profileToken?: string;
  version?: number;
};

async function seedProfile(context: BrowserContext, profile: Profile): Promise<void> {
  await context.addInitScript((value) => {
    const key = `geoaissr:profile:${location.origin}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
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
  await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
}

async function guess(page: Page): Promise<void> {
  const notice = page.getByRole('button', { name: 'Понятно', exact: true });
  if (await notice.isVisible()) await notice.click();
  const canvas = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 12_000 });
  await canvas.click({ position: { x: 140, y: 110 } });
  await page.getByRole('button', { name: 'Угадать', exact: true }).click();
}

async function assertGuessHitTargets(page: Page): Promise<void> {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 720 });
    if (width < 900) await page.getByRole('button', { name: 'Карта', exact: true }).click();
    const canvas = page.getByTestId('fake-guess-map').locator('canvas');
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 140, y: 110 } });
    const submit = page.getByRole('button', { name: 'Угадать', exact: true });
    await expect(submit).toBeEnabled();
    const profileRect = await page
      .getByRole('button', { name: 'Профиль', exact: true })
      .boundingBox();
    const submitRect = await submit.boundingBox();
    expect(profileRect).not.toBeNull();
    expect(submitRect).not.toBeNull();
    if (!profileRect || !submitRect) throw new Error('Missing profile or guess hit target');
    expect(
      profileRect.x < submitRect.x + submitRect.width &&
        profileRect.x + profileRect.width > submitRect.x &&
        profileRect.y < submitRect.y + submitRect.height &&
        profileRect.y + profileRect.height > submitRect.y,
    ).toBe(false);
    await submit.click({ trial: true });
  }
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

function registry(dataDir: string): Array<Profile & { role: string }> {
  const data = JSON.parse(readFileSync(path.join(dataDir, 'profiles.json'), 'utf8')) as {
    profiles: Array<Profile & { role: string }>;
  };
  return data.profiles;
}

async function login(page: Page, baseUrl: string, code: string): Promise<void> {
  await page.goto(baseUrl);
  await page.getByLabel('Код профиля').fill(code);
  await page.getByRole('button', { name: 'Войти по коду', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
}

async function codeOf(page: Page): Promise<string> {
  await expect.poll(async () => (await savedProfile(page)).profileToken).toMatch(/^[0-9a-f]{32}$/);
  const code = (await savedProfile(page)).profileToken;
  if (!code) throw new Error('Registration did not cache a profile code');
  return code;
}

// protects=B1/B2: invited registration issues one durable code and same-origin reload uses it without invitation or seat secret; fails_when=homepage demands an invite or reload creates a new identity; why_new=cached credential precedence and owner clipboard were previously untested; seam=none; no_claim=fake maps and bots do not establish model or Cloudflare quality
test('registration, code display and cached reload', async ({ browser }) => {
  const server = await startIsolatedFakeServer();
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  try {
    await page.goto(server.baseUrl);
    await expect(page.getByLabel('Код профиля')).toBeVisible();
    await expect(page.getByLabel('Ваше имя')).toHaveCount(0);
    await assertAxeClean(page, 'Code login');
    await join(page, server.hostUrl, 'Возвращаюсь');
    const code = await codeOf(page);
    await expect(page.getByText(/Сохраните код профиля/)).toBeVisible();
    const saved = await savedProfile(page);
    expect(registry(server.dataDir)).toMatchObject([
      {
        profileId: saved.profileId,
        profileToken: code,
        nick: saved.nick,
        color: saved.color,
        role: 'host',
      },
    ]);
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await page.getByRole('button', { name: 'Скопировать код', exact: true }).click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/[-\s]/g, '')).toBe(
      code,
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      localStorage.removeItem(`geoaissr:player:${location.origin}`);
    });
    await page.goto(server.guestUrl);
    await expectLobbyPlayers(page, 1);
    await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
    await page.goto(server.baseUrl);
    await expectLobbyPlayers(page, 1);
    expect(await savedProfile(page)).toEqual(saved);
    await expect(page.getByLabel('Ваше имя')).toHaveCount(0);
  } finally {
    await context.close();
    await server.stop();
  }
});

// protects=B3/B4: a new origin and restarted server recover both roles and legacy six-hour wins using the original codes; fails_when=login requires an invite or loses identity, wins, or authority; why_new=recovery across origin and restart previously depended on invitations; seam=none; no_claim=fake server does not test a real tunnel
test('codes restore both roles across origins and restart', async ({ browser }) => {
  const server = await startIsolatedFakeServer({
    initialMatches: [win('h1', 'old-session', false)],
  });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await seedProfile(hostContext, { profileId: PROFILE_ID, nick: 'С победами', color: 'p-1' });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const restoredHostContext = await browser.newContext();
  const restoredGuestContext = await browser.newContext();
  try {
    await host.goto(server.hostUrl);
    await expectLobbyPlayers(host, 1);
    const hostCode = await codeOf(host);
    await join(guest, server.guestUrl, 'Гость');
    const guestCode = await codeOf(guest);
    const before = registry(server.dataDir);
    const oldHostUrl = server.hostUrl;
    await host.close();
    await guest.close();
    await server.restart();
    expect(server.hostUrl).not.toBe(oldHostUrl);
    expect(new URL(server.baseUrl).origin).not.toBe(new URL(server.alternateBaseUrl).origin);
    const newHost = await restoredHostContext.newPage();
    const newGuest = await restoredGuestContext.newPage();
    const formatted = hostCode.toUpperCase().match(/.{4}/g)?.join('-') ?? hostCode;
    await login(newHost, server.alternateBaseUrl, `  ${formatted}  `);
    const roster = await openLobbyDialog(newHost, 'Участники');
    await expectWins(newHost, 'С победами', 1);
    await closeLobbyDialog(roster);
    await expect(newHost.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
    await login(newGuest, server.alternateBaseUrl, guestCode);
    await expect(newGuest.getByRole('button', { name: 'Начать', exact: true })).toHaveCount(0);
    expect(await savedProfile(newHost)).toMatchObject({
      profileId: PROFILE_ID,
      profileToken: hostCode,
    });
    expect(registry(server.dataDir)).toEqual(before);
  } finally {
    await hostContext.close();
    await guestContext.close();
    await restoredHostContext.close();
    await restoredGuestContext.close();
    await server.stop();
  }
});

// protects=manual authentication when browser storage is unavailable and invalid code rejection; fails_when=storage exceptions prevent login or malformed input acquires a seat; why_new=storage errors and the raw 64-character limit were untested; seam=none; no_claim=does not simulate every browser privacy mode
test('manual login works without storage and rejects malformed codes', async ({ browser }) => {
  const server = await startIsolatedFakeServer();
  const original = await browser.newContext();
  const privateContext = await browser.newContext();
  const host = await original.newPage();
  try {
    await join(host, server.hostUrl, 'Без хранилища');
    const code = await codeOf(host);
    await privateContext.addInitScript(() => {
      for (const name of ['getItem', 'setItem', 'removeItem'] as const) {
        Object.defineProperty(Storage.prototype, name, {
          value: () => {
            throw new Error('storage disabled');
          },
        });
      }
    });
    const page = await privateContext.newPage();
    await page.goto(server.alternateBaseUrl);
    const tooLong = `${' '.repeat(33)}${code}`;
    await page.getByLabel('Код профиля').fill(tooLong);
    await expect(page.getByLabel('Код профиля')).toHaveValue(tooLong);
    await expect(page.getByRole('button', { name: 'Войти по коду', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Участники', exact: true })).toHaveCount(0);
    await page.getByLabel('Код профиля').fill(code);
    await page.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expectLobbyPlayers(page, 1);
    await page.reload();
    await expect(page.getByLabel('Код профиля')).toBeVisible();
    expect(registry(server.dataDir)).toHaveLength(1);
  } finally {
    await original.close();
    await privateContext.close();
    await server.stop();
  }
});

// Value: protects=B5 and displaced-page controls/credential isolation: another device resumes the submitted active-round seat and displaces its old connection; fails_when=the guess disappears, another seat is created, or the old page reconnects; why_new=active-seat takeover must preserve submitted input on a different device; seam=none; no_claim=fake maps do not test Google Maps or model quality
test('code takeover retains an active submitted guess', async ({ browser }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const replacementContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await join(host, server.hostUrl, 'Хост');
    await join(guest, server.guestUrl, 'Игрок');
    const code = await codeOf(guest);
    await host.getByRole('button', { name: 'Начать', exact: true }).click();
    await guess(guest);
    await expect(guest.getByText(/Ответ принят/)).toBeVisible();
    const replacement = await replacementContext.newPage();
    await replacement.goto(server.alternateBaseUrl);
    await replacement.getByLabel('Код профиля').fill(code);
    await replacement.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expect(replacement.getByText(/Ответ принят/)).toBeVisible();
    await expect(guest.getByText(/другой вкладке|другом устройстве|новая вкладка/i)).toBeVisible();
    await expect(guest.getByTestId('fake-guess-map')).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Угадать', exact: true })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Меню хоста', exact: true })).toHaveCount(0);
    await guest.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(guest.getByLabel('Имя', { exact: true })).toHaveCount(0);
    await guest.keyboard.press('Escape');
    expect((await savedProfile(guest)).profileToken).toBe(code);
    await guess(host);
    await expect(replacement.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
    const sharedReplacement = await guestContext.newPage();
    await sharedReplacement.goto(server.baseUrl);
    await expect(sharedReplacement.getByText(/Правильный ответ:/)).toBeVisible();
    expect((await savedProfile(sharedReplacement)).profileToken).toBe(code);
    await sharedReplacement.reload();
    await expect(sharedReplacement.getByText(/Правильный ответ:/)).toBeVisible();
    expect(registry(server.dataDir)).toHaveLength(2);
  } finally {
    await hostContext.close();
    await guestContext.close();
    await replacementContext.close();
    await server.stop();
  }
});

// Value: protects=B6/B7 and logout without crypto.randomUUID: identical display values remain independent seats and explicit logout propagates before switching profiles; fails_when=names reclaim seats or another tab restores logged-out credentials; why_new=old tests rejected duplicates and lacked explicit cross-tab logout; seam=none; no_claim=does not establish cross-origin logout propagation
test('duplicate display values and same-origin logout stay isolated', async ({ browser }) => {
  const server = await startIsolatedFakeServer();
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await join(first, server.hostUrl, 'Одинаково');
    const firstCode = await codeOf(first);
    await second.goto(server.guestUrl);
    await second.getByLabel('Ваше имя').fill('Одинаково');
    await second.getByRole('radio', { name: 'оранжевый', exact: true }).click();
    await second.getByRole('button', { name: 'Войти', exact: true }).click();
    await expectLobbyPlayers(second, 2);
    const secondCode = await codeOf(second);
    expect(firstCode).not.toBe(secondCode);
    expect(registry(server.dataDir)).toHaveLength(2);
    await expectLobbyPlayers(first, 2);
    await expect(first.getByRole('article', { name: 'Одинаково', exact: true })).toHaveCount(2);
    const tab = await firstContext.newPage();
    await tab.goto(server.baseUrl);
    await expectLobbyPlayers(tab, 2);
    await tab.evaluate(() => {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    });
    await tab.getByRole('button', { name: 'Профиль', exact: true }).click();
    await tab.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(tab.getByLabel('Код профиля')).toBeVisible();
    await expect(first.getByLabel('Код профиля')).toBeVisible();
    await tab.reload();
    await expect(tab.getByLabel('Код профиля')).toBeVisible();
    await login(tab, server.baseUrl, secondCode);
    expect((await savedProfile(tab)).profileToken).toBe(secondCode);
    expect(registry(server.dataDir).map((p) => p.profileToken)).toEqual(
      expect.arrayContaining([firstCode, secondCode]),
    );
  } finally {
    await firstContext.close();
    await secondContext.close();
    await server.stop();
  }
});

// Value: protects=B7, phase restrictions, loading-phase Profile hit target and desktop/narrow guess hit targets: duplicate name/color edits persist without changing code, while the profile remains viewable in a match; fails_when=an occupied value is rejected or midmatch editing mutates identity; why_new=old tests rejected occupied values and lacked all-phase code access; seam=none; no_claim=fake maps do not establish external map or model behavior
test('profile edits accept occupied values and code remains visible during a match', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await join(host, server.hostUrl, 'Общее');
    await join(guest, server.guestUrl, 'Другое');
    const code = await codeOf(guest);
    await guest.getByRole('button', { name: 'Профиль', exact: true }).click();
    const dialog = guest.getByRole('dialog');
    await dialog.getByLabel('Имя', { exact: true }).fill('Общее');
    await dialog.getByRole('radio', { name: 'оранжевый', exact: true }).click();
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => savedProfile(guest))
      .toMatchObject({ nick: 'Общее', color: 'p-1', profileToken: code });
    await expect(host.getByRole('article', { name: 'Общее', exact: true })).toHaveCount(2);
    await host.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(guest.locator('.loading-veil')).toBeVisible();
    const loadingHit = await guest
      .getByRole('button', { name: 'Профиль', exact: true })
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          duringLoading: !!document.querySelector('.loading-veil'),
          profileReceivesPointer: el.contains(hit),
        };
      });
    expect(loadingHit).toEqual({ duringLoading: true, profileReceivesPointer: true });
    await guest.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(guest.getByRole('dialog').getByLabel('Код профиля')).toHaveValue(
      Array.from({ length: 8 }, (_, i) => code.slice(i * 4, i * 4 + 4)).join('-'),
    );
    await expect(guest.getByRole('button', { name: 'Скопировать код', exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
    await expect(guest.getByLabel('Имя', { exact: true })).toHaveCount(0);
    await guest.keyboard.press('Escape');
    await expect(guest.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
    await guest.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Скопировать код', exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
    await expect(guest.getByLabel('Имя', { exact: true })).toHaveCount(0);
    await guest.keyboard.press('Escape');
    const notice = guest.getByRole('button', { name: 'Понятно', exact: true });
    if (await notice.isVisible()) await notice.click();
    await assertGuessHitTargets(guest);
    await guess(host);
    await guest.getByRole('button', { name: 'Угадать', exact: true }).click();
    await expect(host.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
    await host.getByRole('button', { name: 'К итогам', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Профиль', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(guest.getByLabel('Имя', { exact: true })).toHaveValue('Общее');
    expect((await savedProfile(guest)).profileToken).toBe(code);
  } finally {
    await hostContext.close();
    await guestContext.close();
    await server.stop();
  }
});

// Value: protects=history-backed avatar counts and bot resets persist for both code-restored clients; fails_when=counts change or only one saved profile returns after restart; why_new=code login restores the guest as well as the host after invitations change; seam=none; no_claim=does not wait six real hours or use paid model providers
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
    await expectLobbyPlayers(host, 1);
    await join(guest, server.guestUrl, 'Наблюдатель');
    for (const page of [host, guest]) {
      const roster = await openLobbyDialog(page, 'Участники');
      await expectWins(page, 'С победами', 2);
      await expectWins(page, 'Первый', 2);
      await expectWins(page, 'Второй', 1);
      await closeLobbyDialog(roster);
    }
    const guestRoster = await openLobbyDialog(guest, 'Участники');
    await guestRoster.getByRole('button', { name: 'Настройки Первый', exact: true }).click();
    await expect(guest.getByLabel('Имя бота')).toBeDisabled();
    await expect(guest.getByRole('button', { name: /^Сбросить победы/ })).toHaveCount(0);
    await guest.keyboard.press('Escape');
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
    // Both saved personal codes restore their seats after the room invitation changes.
    for (const page of [host, guest]) {
      await expectLobbyPlayers(page, 2);
      const roster = await openLobbyDialog(page, 'Участники');
      await expectWins(page, 'Первый', 0);
      await expectWins(page, 'Второй', 1);
      await expectWins(page, 'С победами', 2);
      await closeLobbyDialog(roster);
    }
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
    await openLobbyDialog(page, 'Участники');
    await expectWins(page, 'История', 0);
  } finally {
    await page.close();
    await server.stop();
  }
});

// Value: protects=fresh invitation fragments after code selection/logout and explicit recovery from rejected cached credentials; fails_when=a stale cache traps registration or changing the hash needs a reload; why_new=same-document authentication transitions had no browser acceptance coverage; seam=none; no_claim=does not establish cross-origin storage propagation
test('fresh invitation fragments recover code selection, logout and rejected caches', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(server.guestUrl);
    const documentStarted = await page.evaluate(() => performance.timeOrigin);
    await page.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expect(page.getByLabel('Код профиля')).toBeVisible();
    const inviteHash = new URL(server.guestUrl).hash;
    await page.evaluate(() => {
      location.hash = '';
    });
    await page.evaluate((hash) => {
      location.hash = hash;
    }, inviteHash);
    await expect(page.getByLabel('Ваше имя')).toBeVisible();
    await page.getByLabel('Ваше имя').fill('Первый фрагмент');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
    const original = await savedProfile(page);
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page.getByLabel('Код профиля')).toBeVisible();
    expect(await savedProfile(page)).toBeNull();
    await page.evaluate((hash) => {
      location.hash = hash;
    }, inviteHash);
    await expect(page.getByLabel('Ваше имя')).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStarted);
    // A well-formed but unknown code and an already claimed legacy ID both need an explicit escape.
    for (const { cached, error } of [
      {
        cached: { ...original, profileToken: '0'.repeat(32) },
        error: 'Неверный код профиля.',
      },
      {
        cached: { profileId: original.profileId, nick: original.nick, color: original.color },
        error: 'Этот профиль уже зарегистрирован. Войдите по коду профиля на главной странице.',
      },
    ]) {
      await page.evaluate((value) => {
        localStorage.setItem(`geoaissr:profile:${location.origin}`, JSON.stringify(value));
      }, cached);
      await page.reload();
      await expect(page.getByLabel('Код профиля')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveText(error);
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      expect(await savedProfile(page)).toBeNull();
      await page.evaluate((hash) => {
        location.hash = hash;
      }, inviteHash);
      await expect(page.getByLabel('Ваше имя')).toBeVisible();
    }
    await page.getByLabel('Ваше имя').fill('Свежий профиль');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
    expect((await savedProfile(page)).profileId).not.toBe(original.profileId);
    expect(registry(server.dataDir)).toHaveLength(2);
  } finally {
    await context.close();
    await server.stop();
  }
});

// Value: protects=initial code notice for a midmatch spectator and read-only Enter without a profile update; fails_when=late registration hides its recovery code or Enter emits update_profile/shows an update error; why_new=all-phase registration and read-only form submission lacked browser acceptance; seam=none; no_claim=fake maps do not establish external map behavior
test('midmatch spectators see their initial code and read-only Enter sends no update', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  const host = await browser.newPage();
  const spectator = await browser.newPage();
  const updates: string[] = [];
  spectator.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (String(payload).includes('update_profile')) updates.push(String(payload));
    });
  });
  try {
    await join(host, server.hostUrl, 'Ведущий');
    await host.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(host.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
    await spectator.goto(server.guestUrl);
    await spectator.getByLabel('Ваше имя').fill('Поздний наблюдатель');
    await spectator.getByRole('button', { name: 'Смотреть раунд', exact: true }).click();
    await expect(spectator.getByText(/Сохраните код профиля/)).toBeVisible();
    const code = await codeOf(spectator);
    await spectator.getByRole('button', { name: 'Показать код', exact: true }).click();
    const dialog = spectator.getByRole('dialog');
    await expect(dialog.getByLabel('Код профиля')).toHaveValue(
      Array.from({ length: 8 }, (_, i) => code.slice(i * 4, i * 4 + 4)).join('-'),
    );
    await expect(dialog.getByLabel('Имя', { exact: true })).toHaveCount(0);
    await dialog.getByLabel('Код профиля').press('Enter');
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await spectator.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(spectator.getByRole('dialog').getByRole('alert')).toHaveCount(0);
    expect(updates).toEqual([]);
    expect((await savedProfile(spectator)).profileToken).toBe(code);
  } finally {
    await host.close();
    await spectator.close();
    await server.stop();
  }
});

// Value: protects=manual code recovery after an unjoined invitation expires during reconnect; fails_when=an earlier hello_ok leaves code login checking forever or requests a new name; why_new=existing restart coverage only reconnects registered profiles; seam=none; no_claim=fake server does not establish real tunnel behavior
test('expired unjoined invitation reconnect accepts an existing profile code', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const existingContext = await browser.newContext();
  const newcomerContext = await browser.newContext();
  const existing = await existingContext.newPage();
  const newcomer = await newcomerContext.newPage();
  try {
    await join(existing, server.hostUrl, 'Профиль Б');
    const code = await codeOf(existing);
    const before = await savedProfile(existing);
    const invitation = server.guestUrl;
    await newcomer.goto(invitation);
    // This form is shown only after hello_ok; the invited visitor has no registered seat yet.
    await expect(newcomer.getByLabel('Ваше имя')).toBeVisible();
    expect(await savedProfile(newcomer)).toBeNull();
    await existing.close();
    await server.restart();
    expect(server.guestUrl === invitation).toBe(false);
    await expect(newcomer.getByLabel('Код профиля')).toBeVisible();
    await newcomer.getByLabel('Код профиля').fill(code);
    await newcomer.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expectLobbyPlayers(newcomer, 1);
    await expect(newcomer.getByLabel('Ваше имя')).toHaveCount(0);
    expect((await savedProfile(newcomer)).profileId === before.profileId).toBe(true);
    expect((await savedProfile(newcomer)).profileToken === code).toBe(true);
    await expect(newcomer.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
    expect(registry(server.dataDir)).toHaveLength(1);
  } finally {
    await existingContext.close();
    await newcomerContext.close();
    await server.stop();
  }
});

async function holdLogoutEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      heldLogout?: StorageEvent;
      holdLogout?: (event: StorageEvent) => void;
    };
    state.holdLogout = (event: StorageEvent) => {
      if (event.key !== `geoaissr:logout:${location.origin}`) return;
      event.stopImmediatePropagation();
      state.heldLogout = event;
    };
    window.addEventListener('storage', state.holdLogout, true);
  });
}

async function releaseLogoutEvent(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & {
      heldLogout?: StorageEvent;
      holdLogout?: (event: StorageEvent) => void;
    };
    if (!state.heldLogout || !state.holdLogout) throw new Error('Missing held logout event');
    window.removeEventListener('storage', state.holdLogout, true);
    const event = state.heldLogout;
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: event.key,
        oldValue: event.oldValue,
        newValue: event.newValue,
        url: event.url,
        storageArea: event.storageArea,
      }),
    );
  });
}

async function assertOtherProfileIgnoresLogout(target: Page, source: Page): Promise<void> {
  const notice = await source.evaluate(() => {
    const event = (window as typeof window & { heldLogout?: StorageEvent }).heldLogout;
    if (!event) throw new Error('Missing held logout event');
    return { key: event.key, newValue: event.newValue, url: event.url };
  });
  await target.evaluate((notice) => {
    window.dispatchEvent(new StorageEvent('storage', { ...notice, storageArea: localStorage }));
  }, notice);
  await expectLobbyPlayers(target, 2);
  await expect(target.getByLabel('Код профиля')).toHaveCount(0);
}

// Value: protects=newly saved profile and seat credentials plus a newer active profile when a real same-origin logout event arrives late; fails_when=the delayed event signs out or erases profile B or a reload cannot restore its seat; why_new=ordinary cross-tab logout coverage delivers the event before a subsequent login; seam=none; no_claim=browser-event scheduling fixture does not establish cross-origin logout propagation
test('delayed same-origin logout preserves a newer profile and seat credentials', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const sharedContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const first = await sharedContext.newPage();
  const other = await otherContext.newPage();
  const oldTab = await sharedContext.newPage();
  try {
    await join(first, server.hostUrl, 'Профиль А');
    await join(other, server.guestUrl, 'Профиль Б');
    const otherCode = await codeOf(other);
    const otherProfile = await savedProfile(other);
    await holdLogoutEvents(oldTab);
    await oldTab.goto(server.baseUrl);
    await expectLobbyPlayers(oldTab, 2);
    await first.getByRole('button', { name: 'Профиль', exact: true }).click();
    await first.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(first.getByLabel('Код профиля')).toBeVisible();
    await expect
      .poll(() =>
        oldTab.evaluate(() =>
          Boolean((window as typeof window & { heldLogout?: StorageEvent }).heldLogout),
        ),
      )
      .toBe(true);
    await first.getByLabel('Код профиля').fill(otherCode);
    await first.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expectLobbyPlayers(first, 2);
    expect((await savedProfile(first)).profileId === otherProfile.profileId).toBe(true);
    const current = await sharedContext.newPage();
    await current.goto(server.baseUrl);
    await expectLobbyPlayers(current, 2);
    await assertOtherProfileIgnoresLogout(current, oldTab);
    const saved = await first.evaluate(() => ({
      profile: localStorage.getItem(`geoaissr:profile:${location.origin}`),
      player: localStorage.getItem(`geoaissr:player:${location.origin}`),
    }));
    expect(Boolean(saved.profile && saved.player)).toBe(true);
    await releaseLogoutEvent(oldTab);
    await expect(oldTab.getByLabel('Код профиля')).toBeVisible();
    expect(
      await first.evaluate(
        (before) => ({
          profileUnchanged:
            localStorage.getItem(`geoaissr:profile:${location.origin}`) === before.profile,
          playerUnchanged:
            localStorage.getItem(`geoaissr:player:${location.origin}`) === before.player,
        }),
        saved,
      ),
    ).toEqual({ profileUnchanged: true, playerUnchanged: true });
    await first.reload();
    await expectLobbyPlayers(first, 2);
    await expect(first.getByLabel('Ваше имя')).toHaveCount(0);
    expect((await savedProfile(first)).profileId === otherProfile.profileId).toBe(true);
    expect((await savedProfile(first)).profileToken === otherCode).toBe(true);
    expect(registry(server.dataDir)).toHaveLength(2);
  } finally {
    await sharedContext.close();
    await otherContext.close();
    await server.stop();
  }
});

// Value: protects=explicit logout when a delayed tab reconnects with its old in-memory code before receiving the logout; fails_when=reconnected credentials survive logout and reload restores the signed-out profile; why_new=preserving a newer profile must still remove credentials re-saved by the logged-out profile; seam=none; no_claim=browser-event scheduling does not establish real tunnel behavior
test('delayed logout clears credentials re-saved by the logged-out profile reconnect', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const context = await browser.newContext();
  const first = await context.newPage();
  const oldTab = await context.newPage();
  try {
    await join(first, server.hostUrl, 'Профиль А');
    const original = await savedProfile(first);
    await holdLogoutEvents(oldTab);
    await oldTab.goto(server.baseUrl);
    await expectLobbyPlayers(oldTab, 1);
    await oldTab.evaluate(() => window.dispatchEvent(new Event('offline')));
    await first.getByRole('button', { name: 'Профиль', exact: true }).click();
    await first.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(first.getByLabel('Код профиля')).toBeVisible();
    await expect
      .poll(() =>
        oldTab.evaluate(() =>
          Boolean((window as typeof window & { heldLogout?: StorageEvent }).heldLogout),
        ),
      )
      .toBe(true);
    expect(await savedProfile(first)).toBeNull();
    await oldTab.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect
      .poll(() =>
        oldTab.evaluate(() =>
          Boolean(
            localStorage.getItem(`geoaissr:profile:${location.origin}`) &&
            localStorage.getItem(`geoaissr:player:${location.origin}`),
          ),
        ),
      )
      .toBe(true);
    expect((await savedProfile(oldTab)).profileId === original.profileId).toBe(true);
    await releaseLogoutEvent(oldTab);
    await expect(oldTab.getByLabel('Код профиля')).toBeVisible();
    expect(
      await first.evaluate(() => ({
        profileCleared: localStorage.getItem(`geoaissr:profile:${location.origin}`) === null,
        playerCleared: localStorage.getItem(`geoaissr:player:${location.origin}`) === null,
      })),
    ).toEqual({ profileCleared: true, playerCleared: true });
    await first.reload();
    await expect(first.getByLabel('Код профиля')).toBeVisible();
    await expect(first.getByLabel('Ваше имя')).toHaveCount(0);
    await expect(first.getByRole('button', { name: 'Участники', exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    await server.stop();
  }
});
