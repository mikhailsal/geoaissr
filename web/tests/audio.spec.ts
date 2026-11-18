import { expect, test, type Page } from '@playwright/test';
import type { ServerMessage } from '../../shared/protocol';
import { AUDIO, MUSIC_PLAYLIST } from '../src/lib/audio-catalog';
import { observeAudio, trace, type AudioStart, type AudioTrace } from './audio-observer';
import { assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

// Value: protects=packaged audio decodes and follows actual game and browser lifecycle; fails_when=files fail to decode or events/mutes/reconnect route incorrect sources; why_new=existing browser tests had no audio assertions; seam=none; no_claim=native headless graphs cannot judge subjective loudness; visibility events are synthetic boundary events.

async function join(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}
async function startRound(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByTestId('fake-guess-map').locator('canvas')).toBeVisible({
    timeout: 12_000,
  });
}
async function started(page: Page, name: string): Promise<AudioStart> {
  let start: AudioStart | undefined;
  await expect
    .poll(async () => {
      start = audibleStarts(await trace(page)).find((s) => s.url.endsWith(`/${name}.ogg`));
      return start !== undefined;
    })
    .toBe(true);
  if (!start) throw new Error(`No native start for ${name}`);
  return start;
}
function audibleStarts(events: AudioTrace): AudioStart[] {
  return events.starts.filter(
    (source) =>
      source.at <= events.now &&
      !events.stops.some(({ id, when }) => id === source.id && when <= source.at),
  );
}
function matchMusic(starts: AudioStart[]): AudioStart[] {
  const first = starts.findIndex((source) => source.url.endsWith('/round-loop-suspense.ogg'));
  return first === -1 ? [] : starts.slice(first).filter((source) => source.loop);
}
async function waitForDecodedAudio(page: Page): Promise<void> {
  await expect.poll(async () => new Set((await trace(page)).decoded).size).toBe(19);
  expect(new Set((await trace(page)).decoded.map((url) => url.split('/').pop()))).toEqual(
    new Set(Object.values(AUDIO).map(([file]) => `${file}.ogg`)),
  );
}
function expectNoExplicitStop(events: AudioTrace, source: AudioStart): void {
  expect(events.stops.filter(({ id }) => id === source.id)).toEqual([]);
}
async function finishedNaturally(page: Page, source: AudioStart): Promise<void> {
  let endedAt: number | undefined;
  await expect
    .poll(async () => {
      endedAt = (await trace(page)).ended[source.id];
      return endedAt !== undefined;
    })
    .toBe(true);
  if (endedAt === undefined) throw new Error(`No native end for ${source.url}`);
  expect(endedAt - source.at).toBeGreaterThanOrEqual(source.duration - source.offset - 0.1);
  expectNoExplicitStop(await trace(page), source);
}
async function submit(page: Page, resultsButton = 'К итогам'): Promise<void> {
  await page
    .getByTestId('fake-guess-map')
    .locator('canvas')
    .click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
  await expect(page.getByRole('button', { name: resultsButton })).toBeVisible({ timeout: 12_000 });
}

test('native audio follows the round and mute controls', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await observeAudio(page);
    await page.goto(server.hostUrl);
    expect((await trace(page)).starts).toEqual([]);
    await page.getByLabel('Ваше имя').fill('Оля');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: 'Звуковые эффекты' }).click();
    await page.getByRole('button', { name: 'Звуковые эффекты' }).click();
    await waitForDecodedAudio(page);
    await startRound(page);
    for (const sound of [
      'loading-round',
      'soft-countdown',
      'effect-new-round',
      'round-loop-suspense',
    ]) {
      await started(page, sound);
    }
    const music = (await trace(page)).starts.find((s) =>
      s.url.endsWith('/round-loop-suspense.ogg'),
    );
    expect(music).toMatchObject({ loop: true });
    await page
      .getByTestId('fake-guess-map')
      .locator('canvas')
      .click({ position: { x: 100, y: 100 } });
    await started(page, 'place-guess-land');
    await page.getByRole('button', { name: 'Звуковые эффекты' }).click();
    await expect
      .poll(async () =>
        Object.values((await trace(page)).live).every((url) =>
          url.endsWith('/round-loop-suspense.ogg'),
        ),
      )
      .toBe(true);
    expect(Object.values((await trace(page)).live)).toContainEqual(
      expect.stringContaining('round-loop-suspense'),
    );
    await page.getByRole('button', { name: 'Фоновая музыка' }).click();
    await expect.poll(async () => Object.keys((await trace(page)).live).length).toBe(0);
    await page.getByRole('button', { name: 'Звуковые эффекты' }).click();
    await page.getByRole('button', { name: 'Угадать' }).click();
    await expect(page.getByRole('button', { name: 'К итогам' })).toBeVisible({ timeout: 12_000 });
    await started(page, 'effect-guess-locked');
    await started(page, 'round-end');
    await page.getByRole('button', { name: 'К итогам' }).click();
    await started(page, 'game_end');
    await page.waitForTimeout(1_200);
    const events = (await trace(page)).starts;
    for (const name of ['effect-new-round', 'effect-guess-locked', 'round-end', 'game_end']) {
      expect(events.filter((s) => s.url.endsWith(`/${name}.ogg`))).toHaveLength(1);
    }
    expect(events.filter((s) => s.url.endsWith('/swoosh.ogg'))).toHaveLength(3);
    expect((await trace(page)).errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

// Value: protects=full loading phrase before visible countdown and continuous music across round boundaries; fails_when=loading is cut short or a round transition interrupts music; why_new=prior checks observed filenames without tracking source identity or natural completion; seam=none; no_claim=headless native sources do not measure perceived volume.
test('loading finishes before the countdown and music continues into the next active round', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 2 });
  try {
    await observeAudio(page);
    await join(page, server.hostUrl);
    await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect
      .poll(
        async () =>
          (await trace(page)).decoded.filter((url) =>
            /\/(loading-round|soft-countdown)\.ogg$/.test(url),
          ).length,
      )
      .toBe(2);
    const countdownLabel = page.locator('.loading-veil .countdown');
    const guessMap = page.getByTestId('fake-guess-map').locator('canvas');
    expect((await trace(page)).starts.filter((s) => s.url.endsWith('/swoosh.ogg'))).toEqual([]);

    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(page.getByText('Загружаем панораму…')).toBeVisible();
    const loading = await started(page, 'loading-round');
    expect(loading.duration).toBeCloseTo(6.77, 1);
    expect(loading.offset).toBeLessThan(0.25);
    const suspense = await started(page, 'round-loop-suspense');
    expect(suspense.loop).toBe(true);
    await expect(countdownLabel).toHaveCount(0);
    await expect(countdownLabel).toBeVisible({ timeout: 12_000 });
    const countdown = await started(page, 'soft-countdown');
    await finishedNaturally(page, loading);
    expect(countdown.at - loading.at).toBeGreaterThanOrEqual(loading.duration - loading.offset);

    await expect(guessMap).toBeVisible({ timeout: 12_000 });
    expect((await trace(page)).starts.filter((s) => s.url.endsWith('/swoosh.ogg'))).toHaveLength(1);
    expect((await trace(page)).live[suspense.id]).toBe(suspense.url);
    await submit(page, 'Дальше');
    await started(page, 'round-end');
    expect((await trace(page)).starts.filter((s) => s.url.endsWith('/swoosh.ogg'))).toHaveLength(2);
    expect((await trace(page)).live[suspense.id]).toBe(suspense.url);

    await page.getByRole('button', { name: 'Дальше', exact: true }).click();
    await expect(page.locator('.loading-veil')).toContainText('раунд 2 из 2');
    await expect(countdownLabel).toBeVisible({ timeout: 12_000 });
    const nextLoading = await trace(page);
    expect(nextLoading.live[suspense.id]).toBe(suspense.url);
    expect(matchMusic(audibleStarts(nextLoading))).toEqual([suspense]);

    await expect(guessMap).toBeVisible({ timeout: 12_000 });
    const active = await trace(page);
    expect(active.live[suspense.id]).toBe(suspense.url);
    expect(matchMusic(audibleStarts(active))).toEqual([suspense]);
    const explorer = active.starts.find((s) => s.url.endsWith('/round-loop-explorer.ogg'));
    if (!explorer) throw new Error('Missing queued explorer track');
    expect(suspense.duration).toBeCloseTo(43.54, 1);
    expect(explorer.at).toBeGreaterThan(active.now);
    expect(explorer.at).toBeCloseTo(suspense.at + suspense.duration - suspense.offset, 3);
    expect(active.stops.find(({ id }) => id === suspense.id)?.when).toBe(explorer.at);
    expect(active.starts.filter((s) => s.url.endsWith('/swoosh.ogg'))).toHaveLength(3);
    expect(active.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

// Value: protects=a continuous lobby track, sample-aligned music handoffs, all seven tracks, wrap, and queued-source cancellation on mute; fails_when=lobby advances, match music skips a track, or a muted queued source can start; why_new=full-length native assets cannot wrap within one browser test; seam=the native decoder reads each packaged OGG in full and music only plays a copied half-second of its decoded samples; no_claim=this accelerated case does not measure full-length playback or perceived sound quality.
test('native lobby music loops and the match playlist wraps and cancels queued music on mute', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await observeAudio(page, { musicSeconds: 0.5 });
    await join(page, server.hostUrl);
    const start = page.getByRole('button', { name: 'Начать', exact: true });
    await expect(start).toBeVisible();
    await page.keyboard.press('Tab');
    await waitForDecodedAudio(page);
    const order = MUSIC_PLAYLIST.map((id) => `${AUDIO[id][0]}.ogg`);
    expect(order).toHaveLength(7);
    const count = order.length + 1;
    const lobby = await started(page, 'round-loop-horizon');
    await expect.poll(async () => (await trace(page)).now).toBeGreaterThan(lobby.at + 1);
    const lobbyPlayback = await trace(page);
    expect(lobbyPlayback.starts.filter((source) => source.loop)).toEqual([lobby]);
    expect(lobbyPlayback.live[lobby.id]).toBe(lobby.url);
    expectNoExplicitStop(lobbyPlayback, lobby);

    await start.click();
    await expect
      .poll(async () => {
        const events = await trace(page);
        const heard = matchMusic(audibleStarts(events));
        return (
          heard.length >= count && heard.slice(0, count - 1).every((s) => s.id in events.ended)
        );
      })
      .toBe(true);
    await expect(page.getByText('Загружаем панораму…')).toBeVisible();
    const playback = await trace(page);
    expect(playback.live[lobby.id]).toBeUndefined();
    const heard = matchMusic(audibleStarts(playback)).slice(0, count);
    expect(heard.map(({ url }) => url.split('/').pop())).toEqual([...order, order[0]]);
    for (const [index, source] of heard.slice(0, -1).entries()) {
      const next = heard[index + 1];
      if (!next) throw new Error(`Missing successor for ${source.url}`);
      expect(source.duration).toBe(0.5);
      expect(next.at).toBeCloseTo(source.at + source.duration - source.offset, 3);
      expect(playback.stops.find(({ id }) => id === source.id)?.when).toBe(next.at);
      expect(playback.ended[source.id]).toBeGreaterThanOrEqual(next.at);
    }

    await page.getByRole('button', { name: 'Фоновая музыка' }).click();
    const muted = await trace(page);
    const scheduled = matchMusic(muted.starts);
    const cancelled = scheduled.filter((source) =>
      muted.stops.some(({ id, when }) => id === source.id && when < source.at),
    );
    expect(cancelled.length).toBeGreaterThan(0);
    const lastCancelledStart = Math.max(...cancelled.map(({ at }) => at));
    await expect
      .poll(async () => (await trace(page)).now)
      .toBeGreaterThan(lastCancelledStart + 0.1);
    const afterBoundary = await trace(page);
    expect(matchMusic(afterBoundary.starts)).toEqual(scheduled);
    expect(Object.values(afterBoundary.live).some((url) => url.includes('/round-loop-'))).toBe(
      false,
    );
    expect(afterBoundary.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

async function shortenClientDeadline(page: Page): Promise<void> {
  let endsAt: number | undefined;
  await page.routeWebSocket('**/*', (socket) => {
    const upstream = socket.connectToServer();
    upstream.onMessage((message) => {
      if (typeof message !== 'string') {
        socket.send(message);
        return;
      }
      const snapshot = JSON.parse(message) as ServerMessage;
      if (
        snapshot.type === 'state' &&
        snapshot.view.phase === 'ROUND_ACTIVE' &&
        snapshot.view.active
      ) {
        endsAt ??= snapshot.serverNow + 15_400;
        snapshot.view.active.endsAt = endsAt;
        socket.send(JSON.stringify(snapshot));
      } else {
        socket.send(message);
      }
    });
  });
}

// Value: protects=timer finale plays through zero and the results screen, while the same music source remains live; fails_when=the timer cue or music is stopped at zero or results; why_new=prior tests never crossed a clock deadline; seam=only the active deadline displayed to the client is shortened; no_claim=results come from a real answer and do not test server expiry.
test('timer finale and music continue through client zero and round results', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await shortenClientDeadline(page);
    await observeAudio(page);
    await join(page, server.hostUrl);
    await startRound(page);
    const music = await started(page, 'round-loop-suspense');
    const warning = await started(page, 'effect-timer-countdown');
    expect(warning.duration).toBeCloseTo(18, 1);
    expect(warning.offset).toBeLessThan(1);
    await page
      .getByTestId('fake-guess-map')
      .locator('canvas')
      .click({ position: { x: 100, y: 100 } });

    await expect(page.locator('.timer-pill .digits')).toHaveText('0:00', { timeout: 20_000 });
    const atZero = await trace(page);
    expect(atZero.live[warning.id]).toBe(warning.url);
    expect(atZero.live[music.id]).toBe(music.url);
    await page.getByRole('button', { name: 'Угадать' }).click();
    await expect(page.getByRole('button', { name: 'К итогам' })).toBeVisible();
    await started(page, 'round-end');
    const results = await trace(page);
    expect(results.live[warning.id]).toBe(warning.url);
    expectNoExplicitStop(results, warning);
    expect(results.live[music.id]).toBe(music.url);
    await finishedNaturally(page, warning);
    expect((await trace(page)).starts.filter((s) => s.url === warning.url)).toEqual([warning]);
    expect((await trace(page)).errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

test('mute preferences persist and controls fit the header', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await join(page, server.hostUrl);
    const effects = page.getByRole('button', { name: 'Звуковые эффекты' });
    const music = page.getByRole('button', { name: 'Фоновая музыка' });
    await effects.click();
    await music.click();
    await page.reload();
    await expect(effects).toHaveAttribute('aria-pressed', 'false');
    await expect(music).toHaveAttribute('aria-pressed', 'false');
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 720 });
      for (const control of [effects, music]) {
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        if (!box) throw new Error('Missing sound control bounds');
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await assertNoHorizontalOverflow(page);
    }
  } finally {
    await server.stop();
  }
});

for (const failure of ['404', 'unavailable'] as const) {
  test(`gameplay works with audio ${failure}`, async ({ page }) => {
    const server = await startIsolatedFakeServer({ rounds: 1 });
    try {
      if (failure === '404')
        await page.route('**/audio/*.ogg', (route) => route.fulfill({ status: 404 }));
      else
        await page.addInitScript(() => {
          Object.defineProperty(window, 'AudioContext', { value: undefined });
        });
      const errors: string[] = [];
      await page.addInitScript(() => {
        window.addEventListener('unhandledrejection', (event) => {
          document.documentElement.dataset.audioError = String(event.reason);
        });
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await join(page, server.hostUrl);
      await startRound(page);
      await submit(page);
      expect(errors).toEqual([]);
      expect(await page.locator('html').getAttribute('data-audio-error')).toBeNull();
    } finally {
      await server.stop();
    }
  });
}

async function setVisibility(page: Page, state: 'visible' | 'hidden'): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('hidden and reconnecting games stop audio and resume only current music', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await page.routeWebSocket('**/*', (socket) => {
      socket.connectToServer();
      disconnect = async () => {
        await socket.close({ code: 1012, reason: 'Fixture reconnect' });
      };
    });
    await observeAudio(page);
    await join(page, server.hostUrl);
    await startRound(page);
    const music = await started(page, 'round-loop-suspense');
    await setVisibility(page, 'hidden');
    await expect.poll(async () => Object.keys((await trace(page)).live).length).toBe(0);
    const halted = await trace(page);
    const pause = halted.stops.filter(({ id }) => id === music.id).at(-1);
    if (!pause) throw new Error('Missing music stop on hidden page');
    await setVisibility(page, 'visible');
    await expect
      .poll(async () =>
        Object.values((await trace(page)).live).some((u) => u.includes('round-loop')),
      )
      .toBe(true);
    const visible = await trace(page);
    const resumed = matchMusic(audibleStarts(visible)).find((s) => s.id in visible.live);
    expect(resumed?.url).toBe(music.url);
    expect(resumed?.offset).toBeCloseTo(music.offset + pause.at - music.at, 1);
    if (!disconnect) throw new Error('Missing fixture socket');
    await disconnect();
    await expect.poll(async () => Object.keys((await trace(page)).live).length).toBe(0);
    await expect
      .poll(async () =>
        Object.values((await trace(page)).live).some((u) => u.includes('round-loop')),
      )
      .toBe(true);
    await submit(page);
    await started(page, 'round-end');
    expect(Object.values((await trace(page)).live).some((u) => u.includes('round-loop'))).toBe(
      true,
    );
    await page.getByRole('button', { name: 'К итогам' }).click();
    await started(page, 'game_end');
    expect(Object.values((await trace(page)).live).some((u) => u.includes('round-loop'))).toBe(
      false,
    );
    expect(
      (await trace(page)).starts.filter((s) => s.url.includes('effect-new-round')),
    ).toHaveLength(1);
    await page.getByRole('button', { name: 'Ещё раз' }).click();
    await expect
      .poll(async () => Object.values((await trace(page)).live).some((u) => u.includes('horizon')))
      .toBe(true);
    expect((await trace(page)).errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

test('touch gestures unlock native audio on release without a keyboard', async ({ browser }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await observeAudio(page);
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Тап');
    await page.getByRole('button', { name: 'Войти', exact: true }).tap();
    await page.getByRole('button', { name: 'Начать', exact: true }).tap();
    await started(page, 'round-loop-suspense');
    expect(
      (await trace(page)).resumedOn.some((event) => event === 'pointerup' || event === 'touchend'),
    ).toBe(true);
    expect((await trace(page)).errors).toEqual([]);
  } finally {
    await context.close();
    await server.stop();
  }
});
