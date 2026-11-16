import { expect, test } from 'bun:test';
import { createBotToolQueue } from './queue.ts';

function queueAt(remaining: number) {
  const guesses: boolean[] = [];
  const queue = createBotToolQueue({
    moveLimit: 1,
    moveEnabled: true,
    handlers: {
      waitObserveRelease: async () => {},
      executeObserve: () => Promise.resolve({ text: 'frames' }),
      executeLook: () => Promise.resolve({ text: 'look' }),
      executeMove: () => Promise.resolve({ text: 'move' }),
      onGuess: (_guess, finalized) => guesses.push(finalized),
      onTurnsChanged: () => {},
      getRemainingTimeSec: () => remaining,
    },
  });
  return { queue, guesses };
}

// Protect consistent deadline advice at the explore/finalize boundary.
test.each([
  { remaining: 16.8, seconds: 16, urgent: false },
  { remaining: 16, seconds: 16, urgent: false },
  { remaining: 15.7, seconds: 15, urgent: true },
  { remaining: 15.1, seconds: 15, urgent: true },
  { remaining: 15, seconds: 15, urgent: true },
  { remaining: -0.1, seconds: 0, urgent: true },
])('draft advice agrees at $remaining seconds', async ({ remaining, seconds, urgent }) => {
  const { queue, guesses } = queueAt(remaining);
  try {
    const result = await queue.dispatch('draft_guess', { lat: 10, lng: 20, facts: 'Road' });
    expect(guesses).toEqual([false]);
    expect(result.text).toContain(`Черновик сохранён. Осталось ходов: 1, времени: ${seconds} с.`);
    expect(result.text).toContain(`Осталось времени: ${seconds} с.`);
    expect(result.text.includes('Продолжай исследование')).toBe(!urgent);
    expect(result.text.includes('Немедленно отправь')).toBe(urgent);
  } finally {
    queue.abort('test cleanup');
  }
});

test.each(['final', 'abort'] as const)('no urgent advice after %s', async (state) => {
  const { queue, guesses } = queueAt(5);
  try {
    if (state === 'abort') queue.abort('test cancellation');
    const result = await queue.dispatch('final_guess', { lat: 10, lng: 20, facts: 'Road' });
    expect(guesses).toEqual(state === 'final' ? [true] : []);
    expect(result.text).not.toContain('Немедленно отправь');
    expect(result.text).not.toContain('Продолжай исследование');
    expect(result.isError).toBe(state === 'abort' ? true : undefined);
  } finally {
    queue.abort('test cleanup');
  }
});
