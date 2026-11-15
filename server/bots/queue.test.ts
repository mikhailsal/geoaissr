import { expect, test } from 'bun:test';
import { createBotToolQueue, type BotSessionHandlers } from './queue.ts';

function makeHandlers(overrides: Partial<BotSessionHandlers> = {}): BotSessionHandlers {
  return {
    waitObserveRelease: () => Promise.resolve(),
    executeObserve: () => Promise.resolve({ text: 'observe-ok' }),
    executeLook: () => Promise.resolve({ text: 'look-ok' }),
    executeMove: () => Promise.resolve({ text: 'move-ok' }),
    onGuess: () => undefined,
    onTurnsChanged: () => undefined,
    getRemainingTimeSec: () => 45,
    ...overrides,
  };
}

test('only successful look and move consume turns', async () => {
  let turns = 0;
  const q = createBotToolQueue({
    moveLimit: 2,
    moveEnabled: true,
    handlers: makeHandlers({
      onTurnsChanged: (t) => {
        turns = t;
      },
    }),
  });

  // 3 invalid look calls -> 0 turns charged
  for (let i = 0; i < 3; i += 1) {
    const bad = await q.dispatch('look', { heading: 999 });
    expect(bad.isError).toBe(true);
    expect(turns).toBe(0);
  }

  // Additional failures remain free.
  const fourth = await q.dispatch('look', { heading: 999 });
  expect(fourth.isError).toBe(true);
  expect(turns).toBe(0);

  // Successful moves and looks consume the budget.
  const mv = await q.dispatch('move', { heading: 90 });
  expect(mv.isError).toBeUndefined();
  expect(turns).toBe(1);
  expect((await q.dispatch('look', { heading: 180 })).isError).toBeUndefined();
  expect(turns).toBe(2);

  // Next look blocked
  const over = await q.dispatch('look', { heading: 180 });
  expect(over.isError).toBe(true);
  expect(over.text).toContain('Лимит ходов');
});

test('observe blocks on waitObserveRelease until released and submit_guess stays free', async () => {
  let released = false;
  let releaseFn: (() => void) | undefined;
  let recordedLat = 0;

  const q = createBotToolQueue({
    moveLimit: 1,
    moveEnabled: false,
    handlers: makeHandlers({
      waitObserveRelease: () =>
        new Promise((resolve) => {
          releaseFn = () => {
            released = true;
            resolve();
          };
        }),
      onGuess: (g) => {
        recordedLat = g.lat;
      },
    }),
  });

  const obsPromise = q.dispatch('observe', {});
  await new Promise((r) => setTimeout(r, 10));
  expect(released).toBe(false);
  releaseFn?.();
  const obs = await obsPromise;
  expect(released).toBe(true);
  expect(obs.text).toContain('observe-ok');

  const mvDisabled = await q.dispatch('move', { heading: 0 });
  expect(mvDisabled.isError).toBe(true);
  expect(q.getTurnsUsed()).toBe(0);

  const g = await q.dispatch('submit_guess', {
    lat: 55.75,
    lng: 190,
    explanation: 'Дорожные знаки',
  });
  expect(g.isError).toBeUndefined();
  expect(recordedLat).toBe(55.75);
  expect(q.getTurnsUsed()).toBe(0);
});

test('look and submit_guess wait for round start release before executing', async () => {
  let released = false;
  let releaseFn: (() => void) | undefined;
  let guessCalls = 0;
  const q = createBotToolQueue({
    moveLimit: 1,
    moveEnabled: false,
    handlers: makeHandlers({
      waitObserveRelease: () =>
        new Promise((resolve) => {
          releaseFn = () => {
            released = true;
            resolve();
          };
        }),
      onGuess: () => {
        guessCalls += 1;
      },
    }),
  });

  const pendingGuess = q.dispatch('submit_guess', { lat: 10, lng: 20, explanation: 'Wait' });
  await new Promise((r) => setTimeout(r, 15));
  expect(released).toBe(false);
  expect(guessCalls).toBe(0);
  releaseFn?.();
  const res = await pendingGuess;
  expect(res.isError).toBeUndefined();
  expect(guessCalls).toBe(1);
});

// protects=draft fallback and final immutability; fails_when=checkpoint terminates or final is overwritten; no_claim=engine scoring.
test('drafts remain free, final is accepted at the limit and closes the queue', async () => {
  const guesses: Array<{ lat: number; finalized: boolean }> = [];
  const q = createBotToolQueue({
    moveLimit: 1,
    moveEnabled: true,
    handlers: makeHandlers({
      onGuess: (g, finalized) => guesses.push({ lat: g.lat, finalized }),
    }),
  });
  expect((await q.dispatch('draft_guess', { lat: 1, lng: 190, facts: 'Дорога' })).text).toContain(
    'Осталось ходов: 1',
  );
  expect((await q.dispatch('look', { heading: 0 })).isError).toBeUndefined();
  expect(
    (await q.dispatch('draft_guess', { lat: 2, lng: 0, facts: 'Дорога' })).isError,
  ).toBeUndefined();
  expect(
    (await q.dispatch('final_guess', { lat: 3, lng: 0, facts: 'Дорога' })).isError,
  ).toBeUndefined();
  expect((await q.dispatch('draft_guess', { lat: 4, lng: 0 })).isError).toBe(true);
  expect(guesses).toEqual([
    { lat: 1, finalized: false },
    { lat: 2, finalized: false },
    { lat: 3, finalized: true },
  ]);
  expect(q.getTurnsUsed()).toBe(1);
});

// protects=zoom precedence and tolerant hypothesis; fails_when=fov is defaulted before zoom or malformed optional text rejects a call; no_claim=image rendering.
test('look resolves zoom and explicit fov and tolerates absent hypothesis', async () => {
  const views: Array<{ fov: number; hypothesis?: string }> = [];
  const q = createBotToolQueue({
    moveLimit: 4,
    moveEnabled: true,
    handlers: makeHandlers({
      executeLook: (args) => {
        views.push(args);
        return Promise.resolve({ text: 'ok' });
      },
    }),
  });
  await q.dispatch('look', { heading: 10, zoom: 3, hypothesis: '  sign  ' });
  await q.dispatch('look', { heading: 10, zoom: 3, fov: 200, hypothesis: '' });
  await q.dispatch('look', { heading: 10, fov: 5 });
  expect(views.map((v) => v.fov)).toEqual([30, 120, 10]);
  expect(views[0]?.hypothesis).toBe('sign');
  expect(views[1]?.hypothesis).toBeUndefined();
});
