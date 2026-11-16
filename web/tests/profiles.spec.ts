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
  await expect(page.getByText(/ИГРОКИ/)).toBeVisible();
}

async function guess(page: Page): Promise<void> {
  const notice = page.getByRole('button', { name: 'Понятно', exact: true });
  if (await notice.isVisible()) await notice.click();
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
  await expect(page.getByText(/ИГРОКИ/)).toBeVisible();
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
    await expect(page.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
    await page.goto(server.baseUrl);
    await expect(page.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
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
    await expect(host.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
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
    await expectWins(newHost, 'С победами', 1);
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
    await expect(page.getByText(/ИГРОКИ/)).toHaveCount(0);
    await page.getByLabel('Код профиля').fill(code);
    await page.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expect(page.getByText(/ИГРОКИ 1 из 8/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Код профиля')).toBeVisible();
    expect(registry(server.dataDir)).toHaveLength(1);
  } finally {
    await original.close();
    await privateContext.close();
    await server.stop();
  }
});

// protects=B5: another device resumes the submitted active-round seat and displaces its old connection; fails_when=the guess disappears, another seat is created, or the old page reconnects; why_new=active-seat takeover must preserve submitted input on a different device; seam=none; no_claim=fake maps do not test Google Maps or model quality
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
    await guess(host);
    await expect(replacement.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 12_000 });
    expect(registry(server.dataDir)).toHaveLength(2);
  } finally {
    await hostContext.close();
    await guestContext.close();
    await replacementContext.close();
    await server.stop();
  }
});

// protects=B6/B7: identical display values remain independent seats and explicit logout propagates before switching profiles; fails_when=names reclaim seats or another tab restores logged-out credentials; why_new=old tests rejected duplicates and lacked explicit cross-tab logout; seam=none; no_claim=does not establish cross-origin logout propagation
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
    await expect(second.getByText(/ИГРОКИ 2 из 8/)).toBeVisible();
    const secondCode = await codeOf(second);
    expect(firstCode).not.toBe(secondCode);
    expect(registry(server.dataDir)).toHaveLength(2);
    await expect(first.getByText(/ИГРОКИ 2 из 8/)).toBeVisible();
    await expect(first.getByText('Одинаково', { exact: true })).toHaveCount(2);
    const tab = await firstContext.newPage();
    await tab.goto(server.baseUrl);
    await expect(tab.getByText(/ИГРОКИ 2 из 8/)).toBeVisible();
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

// protects=B7 and phase restrictions: duplicate name/color edits persist without changing code, while the profile remains viewable in a match; fails_when=an occupied value is rejected or midmatch editing mutates identity; why_new=old tests rejected occupied values and lacked all-phase code access; seam=none; no_claim=fake maps do not establish external map or model behavior
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
    await expect(host.getByText('Общее', { exact: true })).toHaveCount(2);
    await host.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(guest.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
    await guest.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Скопировать код', exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
    await expect(guest.getByLabel('Имя', { exact: true })).toHaveCount(0);
    await guest.keyboard.press('Escape');
    await guess(host);
    await guess(guest);
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
    // Both saved personal codes restore their seats after the room invitation changes.
    for (const page of [host, guest]) {
      await expect(page.getByText(/ИГРОКИ 2 из 8/)).toBeVisible();
      await expectWins(page, 'Первый', 0);
      await expectWins(page, 'Второй', 1);
      await expectWins(page, 'С победами', 2);
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
    await expectWins(page, 'История', 0);
  } finally {
    await page.close();
    await server.stop();
  }
});
