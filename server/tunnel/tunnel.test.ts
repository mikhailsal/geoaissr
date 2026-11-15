import { expect, test } from 'bun:test';
import type { TunnelStatusView } from '../../shared/protocol.ts';
import { GeoError } from '../errors.ts';
import type { ManagedProcess } from '../proc/spawn.ts';
import {
  checkDohAndHealthz,
  createCloudflaredManager,
  extractTryCloudflareUrl,
} from './cloudflared.ts';

test('extractTryCloudflareUrl parses subdomain URL and checkDohAndHealthz falls back to dns.google', async () => {
  const sample = '2026-11-13 INF |  https://warm-sky-cloud-42.trycloudflare.com  |';
  expect(extractTryCloudflareUrl(sample)).toBe('https://warm-sky-cloud-42.trycloudflare.com');

  const urlsCalled: string[] = [];
  const ok = await checkDohAndHealthz('https://warm-sky-cloud-42.trycloudflare.com', (u) => {
    urlsCalled.push(u);
    if (u.startsWith('https://cloudflare-dns.com')) {
      return Promise.resolve(new Response('fail', { status: 503 }));
    }
    if (u.startsWith('https://dns.google')) {
      return Promise.resolve(
        new Response(JSON.stringify({ Answer: [{ data: '198.51.100.1' }] }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });
  expect(ok).toBe(true);
  expect(urlsCalled.length).toBe(3);
});

test('createCloudflaredManager throws GEO_CLOUDFLARED_MISSING when binary is absent', () => {
  let caught: unknown;
  try {
    createCloudflaredManager({
      localPort: 3000,
      guestToken: 'gtok',
      onStatus: () => undefined,
      whichCloudflared: () => null,
    });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(GeoError);
  expect((caught as GeoError).code).toBe('GEO_CLOUDFLARED_MISSING');
});

test('cloudflared manager emits ready with guest token URL upon warmup', async () => {
  const statuses: TunnelStatusView[] = [];
  let resolveExit!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => {
    resolveExit = r;
  });

  const mgr = createCloudflaredManager({
    localPort: 3100,
    guestToken: 'guest-abc',
    whichCloudflared: () => '/usr/bin/cloudflared',
    fetchImpl: (u) => {
      if (u.includes('dns')) {
        return Promise.resolve(
          new Response(JSON.stringify({ Answer: [{ data: '1.2.3.4' }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    },
    spawnFn: (opts) => {
      setTimeout(() => {
        opts.onStderrChunk?.('INF https://fast-cat-99.trycloudflare.com');
      }, 5);
      const fakeProc: ManagedProcess = {
        pid: 99999,
        command: 'cloudflared',
        exited,
        getStdout: () => '',
        getStderr: () => '',
        stop: () => {
          resolveExit({ code: 0, signal: null });
          return Promise.resolve();
        },
      };
      return fakeProc;
    },
    onStatus: (s) => statuses.push(s),
  });

  mgr.start();
  await new Promise((r) => setTimeout(r, 40));
  await mgr.stop();

  const ready = statuses.find((s) => s.status === 'ready');
  expect(ready?.inviteUrl).toBe('https://fast-cat-99.trycloudflare.com/#t=guest-abc');
});
