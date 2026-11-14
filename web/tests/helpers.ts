import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface StartedFakeApp {
  baseUrl: string;
  hostUrl: string;
  guestUrl: string;
  stop: () => Promise<void>;
}

function writeTestSettings(configDir: string, rounds: number, seedBot: boolean): void {
  const settings = {
    version: 1,
    rounds,
    roundDurationSec: 60,
    moveEnabled: true,
    region: 'world',
    aiWaitWindowSec: 5,
    bots: seedBot
      ? [
          {
            id: 'bot-e2e-1',
            name: 'Клод',
            color: 'p-4',
            enabled: true,
            harness: 'claude',
            model: 'haiku',
            effort: 'low',
            moveLimit: 1,
            imageSize: 400,
            budgetSec: 60,
            difficultyPreset: 'amateur',
            personalityPreset: 'braggart',
            personalityText: '',
          },
        ]
      : [],
  };
  writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
}

function waitForUrls(proc: ChildProcess): Promise<{ hostUrl: string; guestUrl: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let hostUrl = '';
    let guestUrl = '';
    const timer = setTimeout(() => {
      reject(new Error(`Server did not print URLs in time. Output:\n${buffer}`));
    }, 35_000);

    const onChunk = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const hostMatch = /Ссылка хоста:\s+(http\S+)/.exec(buffer);
      const guestMatch = /Приглашение гостям:\s+(http\S+)/.exec(buffer);
      if (hostMatch?.[1] && guestMatch?.[1]) {
        hostUrl = hostMatch[1];
        guestUrl = guestMatch[1];
        clearTimeout(timer);
        resolve({ hostUrl, guestUrl });
      }
    };
    proc.stdout?.on('data', onChunk);
    proc.stderr?.on('data', onChunk);
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code ?? -1}:\n${buffer}`));
    });
  });
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

export async function startIsolatedFakeServer(opts?: {
  seedBot?: boolean;
  rounds?: number;
}): Promise<StartedFakeApp> {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-pw-e2e-'));
  const configDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');
  if (opts?.seedBot || opts?.rounds !== undefined) {
    mkdirSync(configDir, { recursive: true });
    writeTestSettings(configDir, opts.rounds ?? 2, Boolean(opts.seedBot));
  }
  const freePort = await findFreePort();
  const proc = spawn(
    'bun',
    [
      'run',
      'server/cli/start.ts',
      '--fake',
      '--no-tunnel',
      '--no-open',
      '--port',
      String(freePort),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GEOAISSR_CONFIG_DIR: configDir,
        GEOAISSR_DATA_DIR: dataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let hostUrl = '';
  let guestUrl = '';
  try {
    ({ hostUrl, guestUrl } = await waitForUrls(proc));
  } catch (err) {
    proc.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
  const parsed = new URL(hostUrl);
  const baseUrl = `${parsed.protocol}//${parsed.host}`;

  return {
    baseUrl,
    hostUrl,
    guestUrl,
    stop: async () => {
      proc.kill('SIGTERM');
      await new Promise<void>((res) => {
        const t = setTimeout(() => {
          proc.kill('SIGKILL');
          res();
        }, 3_000);
        proc.once('exit', () => {
          clearTimeout(t);
          res();
        });
      });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function assertAxeClean(page: Page, screenLabel: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const severe = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(severe, `${screenLabel} axe violations: ${JSON.stringify(severe)}`).toHaveLength(0);
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(ok).toBe(true);
}

export function trackMapLoadedMessages(page: Page): { getCount: () => number } {
  let count = 0;
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      if (typeof frame.payload !== 'string') return;
      try {
        const parsed = JSON.parse(frame.payload) as { type?: string };
        if (parsed.type === 'map_loaded') {
          count += 1;
        }
      } catch {
        // Ignore non-JSON frames
      }
    });
  });
  return { getCount: () => count };
}
