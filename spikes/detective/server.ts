import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CatalogFeature } from './catalog.ts';
import { roleToolDefinitions, type Role } from './protocol.ts';
import type { DetectiveSession } from './session.ts';
import type { ToolReply } from './state.ts';

/**
 * Loopback tool API for one Detective round. Each token is bound to one role on the server, so
 * the role's capabilities (tool list, images) never depend on what a bridge or model asks for.
 *   POST /tools        -> { tools } for the caller's role
 *   POST /tool/<name>  -> ToolReply
 */
export interface DetectiveToolServer {
  baseUrl: string;
  tokens: Record<Role, string>;
  close: () => void;
}

function sameToken(header: string | null, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const b = Buffer.from(token, 'utf8');
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

function roleOf(tokens: Record<Role, string>, header: string | null): Role | null {
  if (sameToken(header, tokens.brain)) return 'brain';
  if (sameToken(header, tokens.eyes)) return 'eyes';
  return null;
}

/** The brain must never receive an image, whatever a handler returns. */
function enforceCapabilities(role: Role, reply: ToolReply): ToolReply {
  if (role === 'brain' && reply.images) {
    const { images: _dropped, ...rest } = reply;
    return rest;
  }
  return reply;
}

export function startDetectiveToolServer(
  session: DetectiveSession,
  catalog: readonly CatalogFeature[],
): DetectiveToolServer {
  const tokens: Record<Role, string> = {
    brain: randomBytes(16).toString('hex'),
    eyes: randomBytes(16).toString('hex'),
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const role = roleOf(tokens, req.headers.get('authorization'));
      if (req.method !== 'POST') return new Response('Not found', { status: 404 });
      if (role === null) {
        return Response.json({ text: 'Unauthorized', isError: true }, { status: 401 });
      }
      if (url.pathname === '/tools') {
        return Response.json({
          tools: roleToolDefinitions(role, catalog, session.state.opts.protocol),
        });
      }
      if (!url.pathname.startsWith('/tool/')) return new Response('Not found', { status: 404 });
      const tool = url.pathname.slice('/tool/'.length);
      let body: unknown = {};
      try {
        body = await req.json();
      } catch {
        return Response.json({ text: 'Invalid JSON body', isError: true }, { status: 400 });
      }
      const reply = await session.call(role, tool, body);
      return Response.json(enforceCapabilities(role, reply));
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port ?? 0}`,
    tokens,
    close() {
      void server.stop(true);
    },
  };
}
