import { expect, test } from 'bun:test';
import { formatRoundEndForTerminal } from './start-runtime.ts';

test('round terminal output neutralizes controls from legacy participant and bot names', () => {
  const line = formatRoundEndForTerminal({
    roundNumber: 2,
    totalRounds: 5,
    target: { countryNameRu: 'Турция' },
    answeredNames: ['Лейла 👩‍🚀\u001b[2J\u202e'],
    abortedBots: [{ name: 'Бот\r\n', reason: 'timeout' }],
  });

  expect(line).toBe('Раунд 2/5 (Турция): ответили Лейла 👩‍🚀�[2J� | оборваны: Бот�� (timeout)');
});
