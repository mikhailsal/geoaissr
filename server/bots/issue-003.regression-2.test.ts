import { expect, test } from 'bun:test';
import { createBotToolApiServer } from './api.ts';
import { createBotToolQueue } from './queue.ts';
import type { NormalizedGuessInput } from '../../shared/bot-tools.ts';

// Regression: ISSUE-003
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Protects the HTTP tool boundary: incomplete final keeps a checkpoint and can be corrected, while legacy remains accepted.
test('empty reasoning never locks a modern final and legacy remains compatible', async () => {
  const guesses: Array<{ guess: NormalizedGuessInput; finalized: boolean }> = [];
  const queue = createBotToolQueue({
    moveLimit: 1,
    moveEnabled: true,
    handlers: {
      waitObserveRelease: () => Promise.resolve(),
      executeObserve: () => Promise.resolve({ text: 'view' }),
      executeLook: () => Promise.resolve({ text: 'look' }),
      executeMove: () => Promise.resolve({ text: 'move' }),
      onGuess: (guess, finalized) => {
        guesses.push({ guess, finalized });
      },
      onTurnsChanged: () => {},
      getRemainingTimeSec: () => 40,
    },
  });
  const api = createBotToolApiServer();
  const token = api.registerBot(queue);
  const call = async (name: string, body: unknown) => {
    const response = await fetch(`${api.baseUrl}/tool/${name}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.json()) as { text: string; isError?: boolean };
  };
  try {
    const draft = await call('draft_guess', { lat: 1, lng: 2 });
    expect(draft.text).toContain('facts');
    const incomplete = await call('final_guess', { lat: 3, lng: 4, facts: '  ' });
    expect(incomplete.isError).toBe(true);
    expect(incomplete.text).toContain('conclusion');
    expect(incomplete.text).toContain('1000');
    expect(guesses.map((g) => g.finalized)).toEqual([false, false]);
    const final = await call('final_guess', {
      lat: 3,
      lng: 4,
      conclusion: 'Предварительный вывод',
    });
    expect(final.isError).toBeUndefined();
    expect(guesses.map((g) => g.finalized)).toEqual([false, false, true]);
  } finally {
    api.close();
  }

  const legacy: boolean[] = [];
  const legacyQueue = createBotToolQueue({
    moveLimit: 0,
    moveEnabled: false,
    handlers: {
      waitObserveRelease: () => Promise.resolve(),
      executeObserve: () => Promise.resolve({ text: 'view' }),
      executeLook: () => Promise.resolve({ text: 'look' }),
      executeMove: () => Promise.resolve({ text: 'move' }),
      onGuess: (_guess, finalized) => {
        legacy.push(finalized);
      },
      onTurnsChanged: () => {},
      getRemainingTimeSec: () => 40,
    },
  });
  expect((await legacyQueue.dispatch('submit_guess', { lat: 1, lng: 2 })).isError).toBeUndefined();
  expect(legacy).toEqual([true]);
});
