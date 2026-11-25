import { expect, test } from 'bun:test';
import { botSlotPatchSchema } from './bot-messages.ts';
import { sanitizeTerminalName } from './display-name.ts';
import { joinMessageSchema } from './profile-messages.ts';

test('name schemas reject terminal controls and preserve Unicode names', () => {
  const participant = {
    type: 'join',
    seq: 1,
    nick: 'Лейла 👩‍🚀',
    color: 'p-1',
  };
  expect(joinMessageSchema.safeParse(participant).success).toBe(true);
  expect(joinMessageSchema.safeParse({ ...participant, nick: 'דוד' }).success).toBe(true);
  expect(botSlotPatchSchema.safeParse({ name: 'Бот 🤖' }).success).toBe(true);

  for (const control of ['\u001b', '\r', '\n', '\u009b', '\u2028', '\u202e', '\u2067']) {
    expect(joinMessageSchema.safeParse({ ...participant, nick: `A${control}B` }).success).toBe(
      false,
    );
    expect(botSlotPatchSchema.safeParse({ name: `A${control}B` }).success).toBe(false);
  }
});

test('legacy names render terminal and bidi controls visibly without changing Unicode text', () => {
  expect(sanitizeTerminalName('Лейла 👩‍🚀')).toBe('Лейла 👩‍🚀');
  expect(sanitizeTerminalName('Лейла 👩‍🚀\u001b[2J\u202e\n')).toBe('Лейла 👩‍🚀�[2J��');
});
