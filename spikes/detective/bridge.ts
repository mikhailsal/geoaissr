import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP stdio bridge for one Detective role. It holds no tool logic: the tool list comes from the
 * spike server for this token's role, and every call is forwarded as is.
 */

interface Reply {
  text: string;
  images?: Array<{ name: string; base64: string; mimeType: string }>;
  isError?: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const API_URL = process.env.GEO_API_URL ?? '';
const TOKEN = process.env.GEO_BOT_TOKEN ?? '';

async function post(pathname: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API_URL}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

function content(reply: Reply) {
  const blocks: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  > = [{ type: 'text', text: reply.text }];
  for (const img of reply.images ?? []) {
    blocks.push({ type: 'image', data: img.base64, mimeType: img.mimeType });
  }
  return blocks;
}

async function main(): Promise<void> {
  if (!API_URL || !TOKEN) throw new Error('GEO_API_URL and GEO_BOT_TOKEN are required');
  const listed = (await post('/tools', {})) as { tools?: ToolDefinition[] };
  const tools = listed.tools ?? [];
  const mcp = new McpServer({ name: 'geo', version: '0.1.0' }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const reply = (await post(
        `/tool/${encodeURIComponent(req.params.name)}`,
        req.params.arguments ?? {},
      )) as Reply;
      return { content: content(reply), ...(reply.isError ? { isError: true } : {}) };
    } catch {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Сервер игры недоступен. Повтори вызов один раз; если ошибка повторится — заверши работу.',
          },
        ],
        isError: true,
      };
    }
  });
  await mcp.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(
    `detective bridge failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
