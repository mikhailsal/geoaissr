import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import type { ServerMessage } from '../../shared/protocol';
import {
  AUDIO,
  MUSIC_PLAYLIST,
  type AudioKind,
  type AudioPreferences,
} from '../src/lib/audio-catalog';
import { observeAudio, trace, type AudioStart, type AudioTrace } from './audio-observer';
import { assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

// Value: protects=packaged audio decodes and follows actual game and browser lifecycle; fails_when=files fail to decode or events/mutes/reconnect route incorrect sources; why_new=existing browser tests had no audio assertions; seam=none; no_claim=native headless graphs cannot judge subjective loudness; visibility events are synthetic boundary events.

function audioControls(page: Page, kind: AudioKind) {
  const title = kind === 'music' ? 'Фоновая музыка' : 'Звуковые эффекты';
  const channel = kind === 'music' ? 'музыки' : 'звуковых эффектов';
  const action = kind === 'music' ? 'музыку' : 'звуковые эффекты';
  const panel = page.getByRole('region', { name: `Громкость ${channel}` });
  const trigger = page.getByTitle(`Громкость ${channel}`, { exact: true });
  const modalChannel = page
    .getByRole('group', { name: 'Каналы звука', exact: true })
    .getByRole('button', { name: title, exact: true });
  return {
    trigger,
    async toggle() {
      await ((await modalChannel.isVisible()) ? modalChannel : trigger).click();
    },
    panel,
    slider: panel.getByRole('slider', { name: `Громкость ${channel}` }),
    decrease: panel.getByRole('button', { name: `Уменьшить громкость ${channel}` }),
    increase: panel.getByRole('button', { name: `Увеличить громкость ${channel}` }),
    mute: panel.getByRole('button', { name: `Выключить ${action}` }),
    unmute: panel.getByRole('button', { name: `Включить ${action}` }),
    reset: panel.getByRole('button', { name: 'Сбросить настройки звука', exact: true }),
  };
}

async function openAudioControls(page: Page, kind: AudioKind) {
  const controls = audioControls(page, kind);
  await controls.toggle();
  await expect(controls.trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(controls.slider).toBeVisible();
  return controls;
}

async function setMuted(page: Page, kind: AudioKind, muted: boolean): Promise<void> {
  const controls = await openAudioControls(page, kind);
  await (muted ? controls.mute : controls.unmute).click();
  await expect(muted ? controls.unmute : controls.mute).toBeVisible();
  await controls.toggle();
}

async function join(page: Page, url: string, name = 'Оля'): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}
async function startRound(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByTestId('fake-guess-map').locator('canvas')).toBeVisible({
    timeout: 12_000,
  });
}
async function started(page: Page, name: string, afterId = 0): Promise<AudioStart> {
  let start: AudioStart | undefined;
  await expect
    .poll(async () => {
      start = audibleStarts(await trace(page)).find(
        (s) => s.id > afterId && s.url.endsWith(`/${name}.ogg`),
      );
      return start !== undefined;
    })
    .toBe(true);
  if (!start) throw new Error(`No native start for ${name}`);
  return start;
}
async function matchSuspense(page: Page, lobby: AudioStart): Promise<AudioStart> {
  const suspense = await started(page, 'round-loop-suspense', lobby.id);
  expect((await trace(page)).live[lobby.id]).toBeUndefined();
  return suspense;
}
function audibleStarts(events: AudioTrace): AudioStart[] {
  return events.starts.filter(
    (source) =>
      source.at <= events.now &&
      !events.stops.some(({ id, when }) => id === source.id && when <= source.at),
  );
}
function matchMusic(starts: AudioStart[], lobby: AudioStart): AudioStart[] {
  return starts.filter((source) => source.id > lobby.id && source.loop);
}
async function verifyPackagedAudio(page: Page): Promise<void> {
  const assets = Object.values(AUDIO).map(([file]) => `/audio/${file}.ogg`);
  const durations = await page.evaluate(async (urls) => {
    const context = new OfflineAudioContext(1, 1, 44_100);
    const durations: number[] = [];
    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio HTTP ${response.status} for ${url}`);
      if (response.headers.get('content-type') !== 'audio/ogg')
        throw new Error(`Audio MIME for ${url}`);
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      durations.push(decoded.duration);
    }
    return durations;
  }, assets);
  expect(new Set(assets).size).toBe(19);
  expect(durations).toHaveLength(19);
  expect(durations.every((duration) => duration > 0)).toBe(true);
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
    await setMuted(page, 'effects', true);
    await setMuted(page, 'effects', false);
    const lobby = await started(page, 'round-loop-suspense');
    await startRound(page);
    for (const sound of ['loading-round', 'soft-countdown', 'effect-new-round']) {
      await started(page, sound);
    }
    const music = await matchSuspense(page, lobby);
    expect(music).toMatchObject({ loop: true });
    await page
      .getByTestId('fake-guess-map')
      .locator('canvas')
      .click({ position: { x: 100, y: 100 } });
    await started(page, 'place-guess-land');
    await setMuted(page, 'effects', true);
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
    await setMuted(page, 'music', true);
    await expect.poll(async () => Object.keys((await trace(page)).live).length).toBe(0);
    await setMuted(page, 'effects', false);
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
    await verifyPackagedAudio(page);
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
    const lobby = await started(page, 'round-loop-suspense');
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
    const suspense = await matchSuspense(page, lobby);
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
    expect(matchMusic(audibleStarts(nextLoading), lobby)).toEqual([suspense]);

    await expect(guessMap).toBeVisible({ timeout: 12_000 });
    const active = await trace(page);
    expect(active.live[suspense.id]).toBe(suspense.url);
    expect(matchMusic(audibleStarts(active), lobby)).toEqual([suspense]);
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

function observeMusicRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/audio/round-loop-')) requests.push(pathname);
  });
  return requests;
}

async function expectColdLobbyMusic(page: Page, requests: string[]): Promise<AudioStart> {
  const lobby = await started(page, 'round-loop-suspense');
  await expect.poll(async () => (await trace(page)).now).toBeGreaterThan(lobby.at + 1);
  const events = await trace(page);
  expect(events.starts.filter((source) => source.loop)).toEqual([lobby]);
  expect(events.live[lobby.id]).toBe(lobby.url);
  expect(lobby.gain).toBeCloseTo(AUDIO.music[1] * 0.65 * 0.6, 4);
  expectNoExplicitStop(events, lobby);
  expect(requests).toEqual(['/audio/round-loop-suspense.ogg']);
  return lobby;
}

// Value: protects=a single quiet lobby track without prefetching alternate music, sample-aligned music handoffs, all seven tracks, wrap, and queued-source cancellation on mute; fails_when=lobby downloads or plays more music, the match skips a track, or a muted queued source can start; why_new=full-length native assets cannot wrap within one browser test; seam=the native decoder reads each packaged OGG in full and music only plays a copied half-second of its decoded samples; no_claim=this accelerated case does not measure full-length playback or perceived sound quality.
test('native lobby music loops and the match playlist wraps and cancels queued music on mute', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    const requests = observeMusicRequests(page);
    await observeAudio(page, { musicSeconds: 0.5 });
    await join(page, server.hostUrl);
    const start = page.getByRole('button', { name: 'Начать', exact: true });
    await expect(start).toBeVisible();
    await page.keyboard.press('Tab');
    const order = MUSIC_PLAYLIST.map((id) => `${AUDIO[id][0]}.ogg`);
    expect(order).toHaveLength(7);
    const count = order.length + 1;
    const lobby = await expectColdLobbyMusic(page, requests);

    await start.click();
    await expect(page.getByText('Загружаем панораму…')).toBeVisible();
    const musicControls = await openAudioControls(page, 'music');
    await expect
      .poll(async () => {
        const events = await trace(page);
        const heard = matchMusic(audibleStarts(events), lobby);
        return (
          heard.length >= count && heard.slice(0, count - 1).every((s) => s.id in events.ended)
        );
      })
      .toBe(true);
    await expect(page.getByText('Загружаем панораму…')).toBeVisible();
    const playback = await trace(page);
    expect(playback.live[lobby.id]).toBeUndefined();
    const heard = matchMusic(audibleStarts(playback), lobby).slice(0, count);
    expect(heard.map(({ url }) => url.split('/').pop())).toEqual([...order, order[0]]);
    expect(heard[0]?.gain).toBeCloseTo(AUDIO.music[1] * 0.6, 4);
    for (const [index, source] of heard.slice(0, -1).entries()) {
      const next = heard[index + 1];
      if (!next) throw new Error(`Missing successor for ${source.url}`);
      expect(source.duration).toBe(0.5);
      expect(next.at).toBeCloseTo(source.at + source.duration - source.offset, 3);
      expect(playback.stops.find(({ id }) => id === source.id)?.when).toBe(next.at);
      expect(playback.ended[source.id]).toBeGreaterThanOrEqual(next.at);
    }

    await musicControls.mute.click();
    const muted = await trace(page);
    const scheduled = matchMusic(muted.starts, lobby);
    const cancelled = scheduled.filter((source) =>
      muted.stops.some(({ id, when }) => id === source.id && when < source.at),
    );
    expect(cancelled.length).toBeGreaterThan(0);
    const lastCancelledStart = Math.max(...cancelled.map(({ at }) => at));
    await expect
      .poll(async () => (await trace(page)).now)
      .toBeGreaterThan(lastCancelledStart + 0.1);
    const afterBoundary = await trace(page);
    expect(matchMusic(afterBoundary.starts, lobby)).toEqual(scheduled);
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
    const lobby = await started(page, 'round-loop-suspense');
    await startRound(page);
    const music = await matchSuspense(page, lobby);
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

async function expectGain(page: Page, source: AudioStart, gain: number): Promise<void> {
  await expect.poll(async () => (await trace(page)).gains[source.id]).toBeCloseTo(gain, 4);
}

// Value: protects=per-channel live gain changes including scheduled music, with source identity preserved; fails_when=volume is delayed until playback restarts, queued music keeps old gain, or a control changes the other channel; why_new=earlier tests covered mute only; seam=none; no_claim=headless checks measure native graph gain rather than perceived loudness.
test('volume controls update current and queued Web Audio sources without restarting', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await observeAudio(page);
    await join(page, server.hostUrl);
    const lobby = await started(page, 'round-loop-suspense');
    expect(lobby.gain).toBeCloseTo(0.117 * 0.6, 4);
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await expect(page.getByText('Загружаем панораму…')).toBeVisible();
    const loading = await started(page, 'loading-round');
    const music = await matchSuspense(page, lobby);
    let queued: AudioStart | undefined;
    await expect
      .poll(async () => {
        const events = await trace(page);
        queued = events.starts.find(
          (source) => source.url.endsWith('/round-loop-explorer.ogg') && source.at > events.now,
        );
        return queued !== undefined;
      })
      .toBe(true);
    if (!queued) throw new Error('Missing scheduled music source');
    for (const source of [music, queued]) expect(source.gain).toBeCloseTo(0.18 * 0.6, 4);

    const musicControls = await openAudioControls(page, 'music');
    await expect(musicControls.slider).toHaveValue('60');
    await musicControls.decrease.click();
    await expect(musicControls.slider).toHaveValue('55');
    await expect(musicControls.panel.getByText('55%', { exact: true })).toBeVisible();
    for (const source of [music, queued]) await expectGain(page, source, 0.18 * 0.55);
    await expectGain(page, loading, AUDIO.loading[1]);

    await musicControls.slider.press('End');
    await expect(musicControls.slider).toHaveValue('100');
    for (const source of [music, queued]) await expectGain(page, source, 0.18);
    await musicControls.toggle();

    const effects = await openAudioControls(page, 'effects');
    await expect(effects.slider).toHaveValue('100');
    await effects.decrease.click();
    await expect(effects.slider).toHaveValue('95');
    await expectGain(page, loading, AUDIO.loading[1] * 0.95);
    for (const source of [music, queued]) await expectGain(page, source, 0.18);
    const result = await trace(page);
    expect(result.live[loading.id]).toBe(loading.url);
    expect(result.live[music.id]).toBe(music.url);
    expect(matchMusic(result.starts, lobby)).toEqual([music, queued]);
    expect(result.starts.filter((source) => source.url === loading.url)).toEqual([loading]);
    expect(result.errors).toEqual([]);
  } finally {
    await server.stop();
  }
});

async function expectFitsHorizontally(control: Locator, width: number): Promise<void> {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  if (!box) throw new Error('Missing sound control bounds');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}

async function expectAdjacentButtons(first: Locator, second: Locator): Promise<void> {
  await expect(second).toBeVisible();
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  if (!firstBox || !secondBox) throw new Error('Missing mute or reset button bounds');
  const [left, right] = firstBox.x < secondBox.x ? [firstBox, secondBox] : [secondBox, firstBox];
  const gap = right.x - (left.x + left.width);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(16);
  expect(Math.abs(left.y + left.height / 2 - (right.y + right.height / 2))).toBeLessThan(2);
}

test('mute and volume preferences persist and popovers fit the header', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await join(page, server.hostUrl);
    const effects = await openAudioControls(page, 'effects');
    await effects.decrease.click();
    await effects.mute.click();
    await expect(effects.slider).toHaveValue('95');
    await effects.toggle();
    const music = await openAudioControls(page, 'music');
    await music.decrease.click();
    await music.mute.click();
    await expect(music.slider).toHaveValue('55');
    await page.reload();
    await expect(effects.trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(music.trigger).toHaveAttribute('aria-expanded', 'false');
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 720 });
      for (const [kind, value] of [
        ['effects', '95'],
        ['music', '55'],
      ] as const) {
        const control = await openAudioControls(page, kind);
        await expectFitsHorizontally(control.trigger, width);
        await expectFitsHorizontally(control.panel, width);
        await expect(control.slider).toHaveValue(value);
        await expect(control.slider).toBeFocused();
        await expect(control.unmute).toBeVisible();
        await expectFitsHorizontally(control.reset, width);
        await expectAdjacentButtons(control.unmute, control.reset);
        if (kind === 'music') {
          await page.screenshot({ path: test.info().outputPath(`music-popover-${width}.png`) });
        }
        await page.keyboard.press('Escape');
        await expect(control.trigger).toBeFocused();
        await expect(control.trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(control.panel).toHaveCount(0);
      }
      await assertNoHorizontalOverflow(page);
    }
    await openAudioControls(page, 'music');
    await page.mouse.click(1, 1);
    await expect(music.trigger).toHaveAttribute('aria-expanded', 'false');
    await openAudioControls(page, 'music');
    await music.increase.click();
    await expect(music.slider).toHaveValue('60');
    await expect(music.mute).toBeVisible();
    await music.slider.press('Home');
    await expect(music.slider).toHaveValue('0');
    await music.unmute.click();
    await expect(music.slider).toHaveValue('60');
    await expect(music.mute).toBeVisible();
  } finally {
    await server.stop();
  }
});

async function profileCode(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Профиль', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByLabel('Код профиля');
  await expect(input).toHaveValue(/^[0-9a-f-]+$/);
  const code = (await input.inputValue()).replaceAll('-', '');
  expect(code).toMatch(/^[0-9a-f]{32}$/);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  return code;
}

async function loginByCode(page: Page, url: string, code: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Код профиля').fill(code);
  await page.getByRole('button', { name: 'Войти по коду', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Участники', exact: true })).toBeVisible();
}

function persistedAudio(dataDir: string, code: string): AudioPreferences | undefined {
  const registry = JSON.parse(readFileSync(joinPath(dataDir, 'profiles.json'), 'utf8')) as {
    profiles: { profileToken: string; audioPreferences?: AudioPreferences }[];
  };
  return registry.profiles.find(({ profileToken }) => profileToken === code)?.audioPreferences;
}

async function expectProfileAudio(page: Page, preferences: AudioPreferences): Promise<void> {
  for (const [kind, volume] of [
    ['music', preferences.musicVolume],
    ['effects', preferences.effectsVolume],
  ] as const) {
    const control = await openAudioControls(page, kind);
    await expect(control.slider).toHaveValue(String(Math.round(volume * 100)));
    await expect(preferences[kind] ? control.mute : control.unmute).toBeVisible();
    await control.toggle();
  }
}

// Value: protects=durable per-profile volume and mute recovery across origins, with a reset that stays saved after restart; fails_when=browser cache overrides the permanent profile or resetting one profile changes another; why_new=existing storage checks use the same browser and origin; seam=conflicting audio cache is seeded in the second browser context; no_claim=the alternate localhost origin does not test a real tunnel.
test('profile code restores audio across origins and reset persists after restart', async ({
  page,
  browser,
}) => {
  const server = await startIsolatedFakeServer();
  const alternate = await browser.newPage();
  const other = await browser.newPage();
  const restarted = await browser.newPage();
  const defaults: AudioPreferences = {
    music: true,
    musicVolume: 0.6,
    effects: true,
    effectsVolume: 1,
  };
  const changed: AudioPreferences = {
    music: false,
    musicVolume: 0.59,
    effects: false,
    effectsVolume: 0.99,
  };
  const otherPrefs = { ...defaults, musicVolume: 0.61 };
  try {
    expect(new URL(server.alternateBaseUrl).origin).not.toBe(new URL(server.baseUrl).origin);
    await page.addInitScript((origin) => {
      if (location.origin !== origin || localStorage.getItem('geoaissr.audio.v1') !== null) return;
      localStorage.setItem(
        'geoaissr.audio.v1',
        JSON.stringify({ music: true, musicVolume: 0.6, effects: true, effectsVolume: 0.98 }),
      );
    }, new URL(server.baseUrl).origin);
    await join(page, server.hostUrl);
    const code = await profileCode(page);
    const music = await openAudioControls(page, 'music');
    await music.slider.press('ArrowLeft');
    await music.mute.click();
    await music.toggle();
    const effects = await openAudioControls(page, 'effects');
    await expect(effects.slider).toHaveValue('98');
    await effects.slider.press('ArrowRight');
    await effects.mute.click();
    await effects.toggle();
    await expect.poll(() => persistedAudio(server.dataDir, code)).toEqual(changed);

    await join(other, server.guestUrl, 'Лена');
    const otherCode = await profileCode(other);
    expect(otherCode).not.toBe(code);
    await expectProfileAudio(other, defaults);
    const otherMusic = await openAudioControls(other, 'music');
    await otherMusic.slider.press('ArrowRight');
    await otherMusic.toggle();
    await expect.poll(() => persistedAudio(server.dataDir, otherCode)).toEqual(otherPrefs);

    await page.goto('about:blank');
    await alternate.addInitScript(() => {
      localStorage.setItem(
        'geoaissr.audio.v1',
        JSON.stringify({ music: true, musicVolume: 0.9, effects: true, effectsVolume: 0.2 }),
      );
    });
    await loginByCode(alternate, server.alternateBaseUrl, code);
    await expectProfileAudio(alternate, changed);
    const restored = await openAudioControls(alternate, 'music');
    await restored.reset.click();
    await expect(restored.slider).toHaveValue('60');
    await restored.toggle();
    await expectProfileAudio(alternate, defaults);
    await expect.poll(() => persistedAudio(server.dataDir, code)).toEqual(defaults);
    expect(persistedAudio(server.dataDir, otherCode)).toEqual(otherPrefs);

    await alternate.close();
    await other.close();
    await server.restart();
    await loginByCode(restarted, server.baseUrl, code);
    await expectProfileAudio(restarted, defaults);
    expect(persistedAudio(server.dataDir, otherCode)).toEqual(otherPrefs);
  } finally {
    await Promise.all([alternate.close(), other.close(), restarted.close()]);
    await server.stop();
  }
});

// Value: protects=legacy mute flag migration and unattenuated explicit saved music volume; fails_when=legacy settings reset a mute or a saved 100% still gets the 40% default reduction; why_new=existing persistence checks exercised only values saved by the current UI; seam=seeded legacy local storage; no_claim=headless checks measure native graph gain rather than perceived loudness.
test('legacy preferences default music to 60% and saved 100% restores original gain', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await page.addInitScript(() => {
      const key = 'geoaissr.audio.v1';
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify({ music: true, effects: false }));
      }
    });
    await observeAudio(page);
    await join(page, server.hostUrl);
    const effects = await openAudioControls(page, 'effects');
    await expect(effects.slider).toHaveValue('100');
    await expect(effects.unmute).toBeVisible();
    await effects.toggle();
    const music = await openAudioControls(page, 'music');
    await expect(music.slider).toHaveValue('60');
    await expect(music.mute).toBeVisible();
    await music.slider.press('End');
    await expect(music.slider).toHaveValue('100');
    await page.reload();
    await openAudioControls(page, 'music');
    await expect(music.slider).toHaveValue('100');
    const lobby = await started(page, 'round-loop-suspense');
    expect(lobby.gain).toBeCloseTo(0.117, 4);
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
    const lobby = await started(page, 'round-loop-suspense');
    await startRound(page);
    const music = await matchSuspense(page, lobby);
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
    const resumed = matchMusic(audibleStarts(visible), lobby).find((s) => s.id in visible.live);
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
    const lastMatchSourceId = (await trace(page)).starts.at(-1)?.id ?? music.id;
    await page.getByRole('button', { name: 'Ещё раз' }).click();
    const returnLobby = await started(page, 'round-loop-suspense', lastMatchSourceId);
    expect((await trace(page)).live[returnLobby.id]).toBe(returnLobby.url);
    expect(returnLobby.gain).toBeCloseTo(AUDIO.music[1] * 0.65 * 0.6, 4);
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
    const lobby = await started(page, 'round-loop-suspense');
    await page.getByRole('button', { name: 'Начать', exact: true }).tap();
    await matchSuspense(page, lobby);
    expect(
      (await trace(page)).resumedOn.some((event) => event === 'pointerup' || event === 'touchend'),
    ).toBe(true);
    expect((await trace(page)).errors).toEqual([]);
  } finally {
    await context.close();
    await server.stop();
  }
});
