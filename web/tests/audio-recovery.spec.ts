import { expectLobbyPlayers } from './lobby-navigation';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { COUNTDOWN_MS, type ClientMessage, type ServerMessage } from '../../shared/protocol';
import { audioUrl } from '../src/lib/audio-catalog';
import { observeAudio, trace } from './audio-observer';
import { startIsolatedFakeServer } from './helpers';

async function join(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
}

function guessMap(page: Page) {
  return page.getByTestId('fake-guess-map').locator('canvas');
}

async function markGuess(page: Page): Promise<void> {
  await guessMap(page).click({ position: { x: 100, y: 100 } });
  await expect(page.getByRole('button', { name: 'Угадать', exact: true })).toBeEnabled();
}

async function holdReconnectAuth(page: Page) {
  let initial: WebSocketRoute | undefined;
  let authHeld = false;
  let release: (() => void) | undefined;
  await page.routeWebSocket('**/ws', (socket) => {
    const upstream = socket.connectToServer();
    if (!initial) {
      initial = socket;
      return;
    }
    let held = true;
    const buffered: (string | Buffer)[] = [];
    socket.onMessage((message) => {
      if (!held) {
        upstream.send(message);
        return;
      }
      buffered.push(message);
      const frame = typeof message === 'string' ? (JSON.parse(message) as ClientMessage) : null;
      if (frame?.type === 'hello' || frame?.type === 'profile_login') authHeld = true;
    });
    release = () => {
      held = false;
      for (const message of buffered) upstream.send(message);
      buffered.length = 0;
    };
  });
  return {
    disconnect: async () => {
      if (!initial) throw new Error('Missing initial game socket');
      await initial.close({ code: 1012, reason: 'Fixture reconnect' });
    },
    authHeld: () => authHeld,
    authenticate: () => {
      if (!release) throw new Error('Missing reconnect route');
      release();
    },
  };
}

// Value: protects=audio stays paused until a fresh authenticated view and resumes the same music position without replaying missed cues; fails_when=opening the transport makes the stale round audible; why_new=the existing reconnect test resumes in the same phase; seam=none; no_claim=native headless playback does not measure perceived loudness.
test('reconnect waits for the fresh phase before resuming music', async ({ browser, page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    const socket = await holdReconnectAuth(page);
    await observeAudio(page);
    await join(page, server.hostUrl, 'Оля');
    await join(guest, server.guestUrl, 'Дима');
    await page.bringToFront();
    await expectLobbyPlayers(page, 2);
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(guessMap(page)).toBeVisible({ timeout: 12_000 });
    await expect(guessMap(guest)).toBeVisible({ timeout: 12_000 });
    await markGuess(guest);
    await markGuess(page);
    await page.getByRole('button', { name: 'Угадать', exact: true }).click();
    await expect(page.getByText(/Ответ принят/)).toBeVisible();
    await expect
      .poll(async () => (await trace(page)).starts.map((s) => new URL(s.url).pathname))
      .toEqual(expect.arrayContaining([audioUrl('locked'), audioUrl('musicExplorer')]));

    const before = await trace(page);
    const music = before.starts.find((s) => s.loop && s.id in before.live);
    if (!music) throw new Error('Missing active music source before disconnect');
    await socket.disconnect();
    await expect.poll(socket.authHeld).toBe(true);
    await guest.getByRole('button', { name: 'Угадать', exact: true }).click();
    await expect(guest.getByText(/Правильный ответ:/)).toBeVisible();
    await page.bringToFront();
    await expect(page.getByText(/Ответ принят/)).toBeVisible();
    const held = await trace(page);
    expect.soft(held.starts).toEqual(before.starts);
    expect.soft(held.live).toEqual({});
    const pause = held.stops.find(({ id, at, when }) => id === music.id && at === when);
    if (!pause) throw new Error('Missing music pause on disconnect');

    socket.authenticate();
    await expect(page.getByText(/Правильный ответ:/)).toBeVisible();
    const resumeMusic = async () => {
      const events = await trace(page);
      return events.starts.slice(before.starts.length).find((s) => s.loop && s.id in events.live);
    };
    await expect.poll(async () => (await resumeMusic())?.url).toBe(music.url);
    expect((await resumeMusic())?.offset).toBeCloseTo(music.offset + pause.at - music.at, 1);
    const resumed = await trace(page);
    expect(resumed.starts.slice(before.starts.length).filter((s) => !s.loop)).toEqual([]);
    expect(resumed.errors).toEqual([]);
  } finally {
    await guestContext.close();
    await server.stop();
  }
});

// Value: protects=the final count stays on screen until the authoritative active state arrives; fails_when=the loading label returns after countdown expiry; why_new=normal server delivery usually hides the gap; seam=none; no_claim=server round timing stays real and unchanged.
test('countdown holds at one until the active phase arrives', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    let revealActive: (() => void) | undefined;
    await page.routeWebSocket('**/ws', (socket) => {
      const upstream = socket.connectToServer();
      upstream.onMessage((message) => {
        const frame = typeof message === 'string' ? (JSON.parse(message) as ServerMessage) : null;
        if (frame?.type === 'state' && frame.view.phase === 'ROUND_ACTIVE') {
          revealActive = () => {
            socket.send(message);
            upstream.onMessage((next) => {
              socket.send(next);
            });
          };
        } else {
          socket.send(message);
        }
      });
    });
    await page.clock.install();
    await join(page, server.hostUrl, 'Оля');
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    const loading = page.getByText('Загружаем панораму…');
    const countdown = page.locator('.loading-veil .countdown');
    await expect(loading).toBeVisible();
    await expect(countdown).toHaveText('1', { timeout: 12_000 });
    await expect.poll(() => Boolean(revealActive)).toBe(true);
    await page.clock.fastForward(COUNTDOWN_MS);
    await expect(countdown).toHaveText('1');
    await expect(loading).toHaveCount(0);

    if (!revealActive) throw new Error('Missing active round frame');
    revealActive();
    await expect(guessMap(page)).toBeVisible();
    await expect(countdown).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

// Value: protects=the mute and reset buttons remain clickable above an expanded round map and reset both audio channels; fails_when=the map canvas intercepts the reset hit or defaults are not restored; why_new=lobby geometry checks never had a competing map layer; seam=none; no_claim=the test uses the local fake map, with no Google APIs.
test('sound controls stay clickable above the pinned round map', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await page.setViewportSize({ width: 1280, height: 600 });
    await join(page, server.hostUrl, 'Оля');
    await page.addStyleTag({ content: '.fake-pill { display: none !important; }' });
    const effectsToggle = page.getByRole('button', { name: 'Звуковые эффекты', exact: true });
    const effects = page.getByRole('region', { name: 'Громкость звуковых эффектов' });
    await effectsToggle.click();
    await effects.getByRole('slider').press('ArrowLeft');
    await expect(effects.getByRole('slider')).toHaveValue('99');
    await effects.getByRole('button', { name: 'Выключить звуковые эффекты' }).click();
    await page
      .getByRole('dialog', { name: 'Настройки звука' })
      .getByRole('button', { name: 'Закрыть' })
      .click();

    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(guessMap(page)).toBeVisible({ timeout: 12_000 });
    const dock = page.getByRole('region', { name: 'Карта догадки' });
    await page.keyboard.press('m');
    await expect(dock).toHaveClass(/\bexpanded\b/);
    await dock.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });

    const musicToggle = page.getByRole('button', { name: 'Фоновая музыка', exact: true });
    const music = page.getByRole('region', { name: 'Громкость музыки' });
    await musicToggle.click();
    const slider = music.getByRole('slider');
    await expect(slider).toBeFocused();
    await slider.press('ArrowLeft');
    await expect(slider).toHaveValue('59');
    const mute = music.getByRole('button', { name: 'Выключить музыку' });
    const reset = mute.locator('..').getByRole('button', { name: 'Сбросить настройки звука' });
    expect(
      await reset.evaluate((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(x + width / 2, y + height / 2));
      }),
    ).toBe(true);
    await mute.click();
    await expect(music.getByRole('button', { name: 'Включить музыку' })).toBeVisible();
    await music.getByRole('button', { name: 'Сбросить настройки звука' }).click();
    await expect(slider).toHaveValue('60');
    await expect(mute).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(musicToggle).toBeFocused();
    await expect(dock).toHaveClass(/\bexpanded\b/);
    await effectsToggle.click();
    await expect(effects.getByRole('slider')).toHaveValue('100');
    await expect(effects.getByRole('button', { name: 'Выключить звуковые эффекты' })).toBeVisible();
  } finally {
    await server.stop();
  }
});
