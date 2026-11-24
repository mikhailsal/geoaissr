import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BotSlotConfig, MatchRecord } from '../../shared/storage-schemas';

export interface StartedFakeApp {
  baseUrl: string;
  alternateBaseUrl: string;
  dataDir: string;
  hostUrl: string;
  guestUrl: string;
  restart: () => Promise<void>;
  stop: () => Promise<void>;
}

type QuotaCounts = { staticRequests: number; panoLoads: number; mapLoads: number };

function writeTestSettings(
  configDir: string,
  rounds: number,
  seedBot: boolean,
  quotaCeilings?: Partial<QuotaCounts>,
  bots?: BotSlotConfig[],
  roundDurationSec = 60,
): void {
  const settings = {
    version: 1,
    rounds,
    roundDurationSec,
    moveEnabled: true,
    region: 'world',
    aiWaitWindowSec: 5,
    ...(quotaCeilings ? { quotaCeilings } : {}),
    bots:
      bots ??
      (seedBot
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
        : []),
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

function launchFakeProcess(configDir: string, dataDir: string, port: number): ChildProcess {
  return spawn('bun', ['run', 'test/fixtures/browser-server.ts', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, GEOAISSR_CONFIG_DIR: configDir, GEOAISSR_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function stopFakeProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 3_000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

interface FakeServerOptions {
  seedBot?: boolean;
  rounds?: number;
  quotaCeilings?: Partial<QuotaCounts>;
  initialQuota?: QuotaCounts;
  initialMatches?: MatchRecord[];
  unreadableHistory?: boolean;
  bots?: BotSlotConfig[];
  roundDurationSec?: number;
}

/** Writes the settings, history and quota files the fixture server starts from. */
function seedFixtureFiles(configDir: string, dataDir: string, opts?: FakeServerOptions): void {
  if (opts?.unreadableHistory) {
    mkdirSync(path.join(dataDir, 'matches.jsonl'), { recursive: true });
  }
  if (opts?.seedBot || opts?.rounds !== undefined || opts?.quotaCeilings || opts?.bots) {
    mkdirSync(configDir, { recursive: true });
    writeTestSettings(
      configDir,
      opts.rounds ?? 2,
      Boolean(opts.seedBot),
      opts.quotaCeilings,
      opts.bots,
      opts.roundDurationSec,
    );
  }
  if (opts?.initialMatches) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      path.join(dataDir, 'matches.jsonl'),
      opts.initialMatches.map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf8',
    );
  }
  if (opts?.initialQuota) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      path.join(dataDir, 'quota.json'),
      JSON.stringify({
        version: 1,
        month: new Date().toISOString().slice(0, 7),
        ...opts.initialQuota,
      }),
      'utf8',
    );
  }
}

export async function startIsolatedFakeServer(opts?: FakeServerOptions): Promise<StartedFakeApp> {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-pw-e2e-'));
  const [configDir, dataDir] = [path.join(root, 'config'), path.join(root, 'data')];
  seedFixtureFiles(configDir, dataDir, opts);
  let proc = launchFakeProcess(configDir, dataDir, 0);

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
    alternateBaseUrl: `${parsed.protocol}//${parsed.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${parsed.port}`,
    dataDir,
    get hostUrl() {
      return hostUrl;
    },
    get guestUrl() {
      return guestUrl;
    },
    restart: async () => {
      await stopFakeProcess(proc);
      proc = launchFakeProcess(configDir, dataDir, Number(parsed.port || 80));
      ({ hostUrl, guestUrl } = await waitForUrls(proc));
    },
    stop: async () => {
      await stopFakeProcess(proc);
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
