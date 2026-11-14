import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getBotToolDefinitions } from '../shared/bot-tools.ts';

interface BackendToolResponse {
  text: string;
  images?: Array<{ name: string; base64: string; mimeType: string }>;
  isError?: boolean;
}

const API_URL = process.env.GEO_API_URL ?? '';
const BOT_TOKEN =
  process.env.GEO_BOT_TOKEN ??
  (process.env.GEO_BOT_TOKEN_FILE
    ? readFileSync(process.env.GEO_BOT_TOKEN_FILE, 'utf8').trim()
    : '');
const DELIVERY_MODE = process.env.GEO_DELIVERY_MODE === 'file' ? 'file' : 'mcp';
const WORK_DIR = process.env.GEO_WORK_DIR ?? process.cwd();
const MOVE_ENABLED = process.env.GEO_MOVE_ENABLED !== 'false';

async function postToolCall(tool: string, args: unknown): Promise<BackendToolResponse> {
  const res = await fetch(`${API_URL}/tool/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${BOT_TOKEN}`,
    },
    body: JSON.stringify(args ?? {}),
  });
  return (await res.json()) as BackendToolResponse;
}

function buildContentBlocks(
  result: BackendToolResponse,
): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
  const content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  > = [{ type: 'text', text: result.text }];

  if (!result.images || result.images.length === 0) {
    return content;
  }

  if (DELIVERY_MODE === 'file') {
    mkdirSync(WORK_DIR, { recursive: true });
    const savedPaths: string[] = [];
    for (const img of result.images) {
      const safeName = path.basename(img.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const fullPath = path.join(WORK_DIR, safeName);
      writeFileSync(fullPath, Buffer.from(img.base64, 'base64'));
      savedPaths.push(fullPath);
    }
    content.push({
      type: 'text',
      text: `Снимки сохранены в файлы рабочей директории (прочитайте их через read_file): ${savedPaths.join(', ')}`,
    });
    return content;
  }

  for (const img of result.images) {
    content.push({ type: 'image', data: img.base64, mimeType: img.mimeType });
  }
  return content;
}

async function main(): Promise<void> {
  if (!API_URL || !BOT_TOKEN) {
    throw new Error('GEO_API_URL and GEO_BOT_TOKEN environment variables are required');
  }

  const mcp = new McpServer({ name: 'geo', version: '0.1.0' }, { capabilities: { tools: {} } });

  const tools = getBotToolDefinitions(MOVE_ENABLED);

  mcp.server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools }));

  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    try {
      const result = await postToolCall(toolName, req.params.arguments ?? {});
      return {
        content: buildContentBlocks(result),
        ...(result.isError ? { isError: true } : {}),
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Ошибка обращения к серверу игры: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`bot-tools failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
