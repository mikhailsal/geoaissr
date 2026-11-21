import { afterEach, expect, test } from 'bun:test';
import { loadCatalog } from './catalog.ts';
import { startDetectiveToolServer, type DetectiveToolServer } from './server.ts';
import { makeSession } from './test-helpers.ts';

let server: DetectiveToolServer | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

async function post(token: string, pathname: string, body: unknown = {}) {
  if (!server) throw new Error('no server');
  const res = await fetch(`${server.baseUrl}${pathname}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function toolNames(json: Record<string, unknown>): string[] {
  return (json.tools as Array<{ name: string }>).map((t) => t.name);
}

test('each token sees only its role tools', async () => {
  const session = makeSession();
  server = startDetectiveToolServer(session, loadCatalog());
  expect(toolNames((await post(server.tokens.brain, '/tools')).json)).toEqual([
    'ask',
    'final_guess',
  ]);
  expect(toolNames((await post(server.tokens.eyes, '/tools')).json)).toEqual([
    'observe',
    'look',
    'next_request',
    'answer',
  ]);
  expect((await post('wrong', '/tools')).status).toBe(401);
});

test('the eyes get frames over HTTP and the brain is refused camera tools', async () => {
  const session = makeSession();
  server = startDetectiveToolServer(session, loadCatalog());
  const eyes = await post(server.tokens.eyes, '/tool/observe');
  expect((eyes.json.images as unknown[]).length).toBe(4);
  const brain = await post(server.tokens.brain, '/tool/observe');
  expect(brain.json.isError).toBe(true);
  expect(brain.json.images).toBeUndefined();
});
