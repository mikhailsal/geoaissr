import { expect, spyOn, test } from 'bun:test';
import type { TunnelStatusView } from '../../shared/protocol.ts';
import { printStartupBanner } from './start-banner.ts';

const localHost = 'http://localhost:3050/#t=test-owner';
const publicGuest = 'https://example.test/game/#t=test-guest';

function banner(mode: TunnelStatusView['mode'], status: TunnelStatusView['status']): string[] {
  const output = spyOn(console, 'log').mockImplementation(() => {});
  try {
    printStartupBanner({
      hostUrl: localHost,
      tunnel: { mode, status, inviteUrl: publicGuest, changedSinceStart: false },
      elapsedMs: 1_000,
      quotaLine: '',
      harnesses: [],
      fakeMode: false,
    });
    return output.mock.calls.map(([line]) => String(line));
  } finally {
    output.mockRestore();
  }
}

test('the private launch console prints distinct remote owner and guest links only once ready', () => {
  for (const mode of ['tunnel', 'public_url'] as const) {
    const lines = banner(mode, 'ready');
    expect(lines).toContain(`Ссылка хоста:       ${localHost}`);
    expect(lines).toContain(`Приглашение гостям: ${publicGuest}`);
    expect(lines).toContain(
      'Удалённый вход хоста (только для владельца): https://example.test/game/?entry=owner#t=test-owner',
    );
    expect(banner(mode, 'checking').some((line) => line.includes('entry=owner'))).toBe(false);
    expect(banner(mode, 'error').some((line) => line.includes('entry=owner'))).toBe(false);
  }
  expect(banner('local', 'local').some((line) => line.includes('entry=owner'))).toBe(false);
});
