// Value: protects=CLI wiring publishes terminal usage and late pricing to both players; fails_when=startup omits pricing or results lose late accounting; no_claim=actual provider billing.
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDefaultSettings } from '../shared/storage-schemas.ts';
import type { BotTokenUsage } from '../shared/bot-results.ts';
import type { ServerMessage } from '../shared/protocol.ts';
import { parseStartArgs } from '../server/cli/preflight.ts';
import { startGeoServer } from '../server/cli/start.ts';
import { saveSettings } from '../server/storage/settings.ts';

async function connect(baseUrl: string, token: string, nick: string): Promise<TestClient> {
  const messages: ServerMessage[] = [];
  const ws = new WebSocket(`${baseUrl.replace('http://', 'ws://')}/ws`);
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') messages.push(JSON.parse(ev.data) as ServerMessage);
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener(
      'open',
      () => {
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      'error',
      () => {
        reject(new Error('WebSocket failed'));
      },
      { once: true },
    );
  });
  const client = { ws, messages };
  ws.send(JSON.stringify({ type: 'hello', token }));
  await waitFor(client, (m) => m.type === 'hello_ok');
  ws.send(JSON.stringify({ type: 'join', seq: 1, nick, color: nick === 'Host' ? 'p-1' : 'p-2' }));
  await waitFor(client, (m) => m.type === 'join_ok');
  return client;
}
interface TestClient {
  ws: WebSocket;
  messages: ServerMessage[];
}
async function waitFor(
  client: TestClient,
  predicate: (m: ServerMessage) => boolean,
): Promise<ServerMessage> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const found = client.messages.find(predicate);
    if (found) return found;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for message; saw ${client.messages.length}`);
}
function seedSettings(configDir: string): void {
  const settings = createDefaultSettings();
  settings.rounds = 1;
  settings.roundDurationSec = 60;
  settings.aiWaitWindowSec = 5;
  settings.bots = [
    {
      id: 'b1',
      name: 'Bot',
      color: 'p-4',
      harness: 'claude',
      model: 'claude-haiku-4-5',
      effort: 'low',
      moveLimit: 2,
      imageSize: 400,
      budgetSec: 60,
      personalityPreset: 'neutral',
      personalityText: '',
      difficultyPreset: 'amateur',
      enabled: true,
    },
  ];
  saveSettings(path.join(configDir, 'settings.json'), settings);
}
function resultWithCost(message: ServerMessage, cost: number | null): boolean {
  if (message.type !== 'state' || message.view.phase !== 'ROUND_RESULTS') return false;
  const entry = message.view.results?.entries.find((item) => item.isAi);
  return entry?.costUsd === cost && entry.tokenUsage?.totalTokens === 175;
}
async function playRound(host: TestClient, guest: TestClient): Promise<void> {
  host.ws.send(JSON.stringify({ type: 'start_match', seq: 2 }));
  await waitFor(host, (m) => m.type === 'state' && m.view.phase === 'ROUND_LOADING');
  for (const client of [host, guest])
    client.ws.send(
      JSON.stringify({ type: 'pano_loaded', seq: 10, roundNumber: 1, countedLoad: true }),
    );
  const scheduled = await waitFor(
    host,
    (m) => m.type === 'state' && m.view.loading?.countdownStartsAt != null,
  );
  if (scheduled.type !== 'state') throw new Error('Missing scheduled countdown');
  // Keep the existing countdown deadline; wait for the added loading phrase separately.
  await Bun.sleep(Math.max(0, (scheduled.view.loading?.countdownStartsAt ?? 0) - Date.now()));
  await waitFor(host, (m) => m.type === 'state' && m.view.phase === 'ROUND_ACTIVE');
  for (const client of [host, guest])
    client.ws.send(
      JSON.stringify({ type: 'submit_guess', seq: 20, roundNumber: 1, lat: 55.75, lng: 37.61 }),
    );
}

test('CLI exposes usage and delayed pricing to host and guest result views', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'geo-accounting-ws-'));
  const oldConfig = process.env.GEOAISSR_CONFIG_DIR;
  const oldData = process.env.GEOAISSR_DATA_DIR;
  process.env.GEOAISSR_CONFIG_DIR = path.join(root, 'config');
  process.env.GEOAISSR_DATA_DIR = path.join(root, 'data');
  seedSettings(process.env.GEOAISSR_CONFIG_DIR);
  let resolveEstimate: ((value: { costUsd: number; matchedModelId: string }) => void) | undefined;
  const pending = new Promise<{ costUsd: number; matchedModelId: string }>((resolve) => {
    resolveEstimate = resolve;
  });
  const requests: Array<{ model: string; usage: BotTokenUsage }> = [];
  const script = `const [url,token]=process.argv.slice(1); await fetch(url+'/tool/final_guess',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({lat:55.75,lng:37.61,conclusion:'Test'})}); process.stdout.write(JSON.stringify({type:'result',usage:{input_tokens:120,output_tokens:30,cache_read_input_tokens:20,cache_creation_input_tokens:5}}));`;
  const server = await startGeoServer(
    { ...parseStartArgs(['--fake', '--no-tunnel', '--no-open']), port: 0 },
    {
      skipClientBuild: true,
      estimateBotCost: (model, usage) => {
        requests.push({ model, usage });
        return pending;
      },
      buildCustomLaunchSpec: ({ apiUrl, botToken, workDir }) => ({
        cmd: [process.execPath, '-e', script, apiUrl, botToken],
        cwd: workDir,
      }),
    },
  );
  let host: TestClient | undefined;
  let guest: TestClient | undefined;
  try {
    host = await connect(server.baseUrl, server.hostToken, 'Host');
    guest = await connect(server.baseUrl, server.guestToken, 'Guest');
    await playRound(host, guest);
    await waitFor(host, (m) => resultWithCost(m, null));
    await waitFor(guest, (m) => resultWithCost(m, null));
    expect(requests).toEqual([
      {
        model: 'claude-haiku-4-5',
        usage: { inputTokens: 145, outputTokens: 30, cachedInputTokens: 20, totalTokens: 175 },
      },
    ]);
    resolveEstimate?.({ costUsd: 0.0123, matchedModelId: 'anthropic/claude-4.5-haiku' });
    await waitFor(host, (m) => resultWithCost(m, 0.0123));
    const guestResult = await waitFor(guest, (m) => resultWithCost(m, 0.0123));
    if (guestResult.type !== 'state') throw new Error('Expected result state');
    expect(guestResult.view.results?.entries.find((entry) => entry.isAi)?.matchedModelId).toBe(
      'anthropic/claude-4.5-haiku',
    );
  } finally {
    host?.ws.close();
    guest?.ws.close();
    await server.stop();
    if (oldConfig === undefined) delete process.env.GEOAISSR_CONFIG_DIR;
    else process.env.GEOAISSR_CONFIG_DIR = oldConfig;
    if (oldData === undefined) delete process.env.GEOAISSR_DATA_DIR;
    else process.env.GEOAISSR_DATA_DIR = oldData;
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
