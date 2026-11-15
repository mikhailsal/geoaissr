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

test('queue enforces moveLimit, gives first 3 failed calls free, and charges turns on 4th failure', async () => {
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

  // 4th failed call -> charges 1 turn
  const fourth = await q.dispatch('look', { heading: 999 });
  expect(fourth.isError).toBe(true);
  expect(turns).toBe(1);

  // 1 valid move -> hits moveLimit 2
  const mv = await q.dispatch('move', { heading: 90 });
  expect(mv.isError).toBeUndefined();
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
  expect(obs.text).toBe('observe-ok');

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
