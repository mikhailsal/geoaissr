import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { BotToolQueue, ToolResponsePayload } from './queue.ts';

export interface BotApiRegistration {
  token: string;
  queue: BotToolQueue;
}

export interface BotToolApiServer {
  port: number;
  baseUrl: string;
  registerBot: (queue: BotToolQueue) => string;
  unregisterBot: (token: string) => void;
  close: () => void;
}

function safeBearerMatch(authHeader: string | null, expectedToken: string): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const presented = authHeader.slice('Bearer '.length);
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expectedToken, 'utf8');
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

function findQueueByAuth(
  bots: Map<string, BotToolQueue>,
  authHeader: string | null,
): BotToolQueue | null {
  for (const [token, queue] of bots.entries()) {
    if (safeBearerMatch(authHeader, token)) return queue;
  }
  return null;
}

export function createBotToolApiServer(): BotToolApiServer {
  const bots = new Map<string, BotToolQueue>();

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== 'POST' || !url.pathname.startsWith('/tool/')) {
        return new Response('Not found', { status: 404 });
      }
      const queue = findQueueByAuth(bots, req.headers.get('authorization'));
      if (!queue) {
        return Response.json(
          { text: 'Unauthorized bot session token', isError: true } satisfies ToolResponsePayload,
          { status: 401 },
        );
      }

      let toolName: string;
      try {
        toolName = decodeURIComponent(url.pathname.slice('/tool/'.length));
      } catch {
        return Response.json(
          { text: 'Invalid tool name encoding', isError: true } satisfies ToolResponsePayload,
          { status: 400 },
        );
      }
      let body: unknown = {};
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { text: 'Invalid JSON request body', isError: true } satisfies ToolResponsePayload,
          { status: 400 },
        );
      }
      const result = await queue.dispatch(toolName, body);
      return Response.json(result, { status: 200 });
    },
  });

  const port = server.port ?? 0;
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    registerBot(queue) {
      const token = randomBytes(16).toString('hex');
      bots.set(token, queue);
      return token;
    },
    unregisterBot(token) {
      bots.delete(token);
    },
    close() {
      void server.stop(true);
      bots.clear();
    },
  };
}
