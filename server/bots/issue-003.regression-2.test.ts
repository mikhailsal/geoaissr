import { expect, test } from 'bun:test';
import { createBotToolApiServer } from './api.ts';
import { createBotToolQueue } from './queue.ts';
import type { NormalizedGuessInput } from '../../shared/bot-tools.ts';

// Regression: ISSUE-003
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Protects the HTTP tool boundary: incomplete final keeps a checkpoint and can be corrected, while legacy remains accepted.
test('an incomplete final saves a checkpoint, is corrected once and never locks the session', async () => {
  const guesses: Array<{ guess: NormalizedGuessInput; finalized: boolean }> = [];
  const queue = createBotToolQueue({
    moveLimit: 1,
    moveEnabled: true,
    requireCompleteReasoning: true,
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
    const unknown = await call('draft_guess', { lat: 1, lng: 2 });
    expect(unknown.isError).toBe(true);
    const incomplete = await call('final_guess', { lat: 3, lng: 4, summary: '  ' });
    expect(incomplete.isError).toBe(true);
    expect(incomplete.text).toContain('summary');
    expect(guesses.map((g) => g.finalized)).toEqual([false]);
    const final = await call('final_guess', { lat: 3, lng: 4, summary: 'Я выбрал север.' });
    expect(final.isError).toBeUndefined();
    expect(guesses.map((g) => g.finalized)).toEqual([false, true]);
  } finally {
    api.close();
  }
});
