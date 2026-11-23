import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type FakeHarnessScenario =
  | 'normal'
  | 'hanging'
  | 'exit_before_guess'
  | 'exit_after_guess'
  | 'invalid_args'
  | 'parallel_calls';

export interface McpToolCallResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}

export async function connectBridgeMcp(opts: {
  apiUrl: string;
  botToken: string;
  workDir: string;
  deliveryMode?: 'mcp' | 'file';
  bridgeScriptPath?: string;
  /** One of the two roles of a Detective bot; the bridge then lists that role's tools. */
  role?: 'brain' | 'eyes';
  moveEnabled?: boolean;
}): Promise<{
  client: Client;
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
  close: () => Promise<void>;
}> {
  const bunBin = process.execPath || 'bun';
  const scriptPath = opts.bridgeScriptPath ?? path.resolve(process.cwd(), 'bot-tools/main.ts');
  const transport = new StdioClientTransport({
    command: bunBin,
    args: ['run', scriptPath],
    cwd: opts.workDir,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      LANG: process.env.LANG ?? 'en_US.UTF-8',
      GEO_API_URL: opts.apiUrl,
      GEO_BOT_TOKEN: opts.botToken,
      GEO_WORK_DIR: opts.workDir,
      GEO_DELIVERY_MODE: opts.deliveryMode ?? 'mcp',
      ...(opts.role ? { GEO_BOT_ROLE: opts.role } : {}),
      ...(opts.moveEnabled === false ? { GEO_MOVE_ENABLED: 'false' } : {}),
    },
  });
  const client = new Client({ name: 'fake-harness', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return {
    client,
    callTool: async (name, args) => {
      const res = await client.callTool({ name, arguments: args });
      return res as unknown as McpToolCallResult;
    },
    close: async () => {
      await transport.close();
    },
  };
}

function getText(res: McpToolCallResult): string {
  return res.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text ?? '')
    .join('\n');
}

const STEP = {
  finding: 'На стартовых кадрах дорожная разметка и архитектура похожи на Россию.',
  current_guess: { lat: 55.7, lng: 37.6 },
};

async function runNormalScenario(
  callTool: (n: string, a: Record<string, unknown>) => Promise<McpToolCallResult>,
): Promise<void> {
  await callTool('observe', {});
  const look = {
    heading: 90,
    pitch: 0,
    fov: 60,
    hypothesis: 'Проверяю дорожные знаки.',
  };
  // The first attempt omits the finding once to exercise the correction path.
  const bounced = await callTool('look', { ...look, current_guess: STEP.current_guess });
  if (!bounced.isError) throw new Error('expected a correction for the missing finding');
  await callTool('look', { ...look, ...STEP });
  await callTool('final_guess', {
    lat: 55.75,
    lng: 37.61,
    finding: 'Знаки на кириллице подтверждают версию.',
    summary: 'Я увидел кириллические знаки и архитектуру центральной части страны.',
    quip: 'Уверенная догадка!',
  });
}

async function runInvalidArgsScenario(
  callTool: (n: string, a: Record<string, unknown>) => Promise<McpToolCallResult>,
): Promise<void> {
  await callTool('observe', {});
  const badLook = await callTool('look', { heading: 999, pitch: 0, fov: 60, ...STEP });
  if (!badLook.isError) throw new Error('expected isError on invalid heading');
  const badLat = await callTool('final_guess', {
    lat: 120,
    lng: 10,
    summary: 'Плохая широта',
    finding: 'Нет',
  });
  if (!badLat.isError) throw new Error('expected isError on out-of-range lat');

  const okGuess = await callTool('final_guess', {
    lat: 50.1,
    lng: 14.4,
    summary: 'А'.repeat(700),
    finding: 'Б'.repeat(700),
    quip: 'Б'.repeat(180),
  });
  if (okGuess.isError) throw new Error(`unexpected guess error: ${getText(okGuess)}`);
}

async function runParallelScenario(
  callTool: (n: string, a: Record<string, unknown>) => Promise<McpToolCallResult>,
): Promise<void> {
  await callTool('observe', {});
  const [r1, r2] = await Promise.all([
    callTool('look', { heading: 0, pitch: 0, fov: 60, ...STEP }),
    callTool('look', { heading: 180, pitch: 0, fov: 60, ...STEP }),
  ]);
  const errs = [r1, r2].filter((r) => Boolean(r.isError)).length;
  if (errs !== 1) throw new Error(`expected 1 ok + 1 turn-limit error, got errors=${errs}`);
  await callTool('final_guess', {
    lat: 48.85,
    lng: 2.35,
    finding: 'Параллельные запросы упёрлись в лимит.',
    summary: 'Параллельные запросы корректно уперлись в лимит одного хода.',
  });
}

export async function runFakeHarnessScenario(opts: {
  scenario: FakeHarnessScenario;
  apiUrl: string;
  botToken: string;
  workDir: string;
  deliveryMode?: 'mcp' | 'file';
}): Promise<number> {
  const conn = await connectBridgeMcp(opts);
  try {
    if (opts.scenario === 'normal') {
      await runNormalScenario(conn.callTool);
      return 0;
    }
    if (opts.scenario === 'exit_before_guess') {
      await conn.callTool('observe', {});
      return 1;
    }
    if (opts.scenario === 'exit_after_guess') {
      await conn.callTool('observe', {});
      await conn.callTool('final_guess', {
        lat: 52.52,
        lng: 13.4,
        finding: 'Кадры показали городскую застройку.',
        summary: 'Я успел отправить догадку до аварийного выхода.',
      });
      return 1;
    }
    if (opts.scenario === 'invalid_args') {
      await runInvalidArgsScenario(conn.callTool);
      return 0;
    }
    if (opts.scenario === 'parallel_calls') {
      await runParallelScenario(conn.callTool);
      return 0;
    }
    // hanging scenario: fetch observe, then hang until SIGTERM/SIGKILL
    await conn.callTool('observe', {});
    await new Promise<void>(() => {
      // stay alive for deadline/abort test
    });
    return 0;
  } finally {
    await conn.close().catch(() => undefined);
  }
}

async function mainCli(): Promise<void> {
  const args = Bun.argv.slice(2);
  const idx = args.indexOf('--scenario');
  const scenario = (idx >= 0 ? args[idx + 1] : process.env.FAKE_SCENARIO) as
    FakeHarnessScenario | undefined;
  const apiUrl = process.env.GEO_API_URL ?? '';
  const botToken = process.env.GEO_BOT_TOKEN ?? '';
  const workDir = process.env.GEO_WORK_DIR ?? process.cwd();
  const deliveryMode = (process.env.GEO_DELIVERY_MODE as 'mcp' | 'file' | undefined) ?? 'mcp';
  if (!scenario || !apiUrl || !botToken) {
    console.error('Missing --scenario, GEO_API_URL, or GEO_BOT_TOKEN');
    process.exit(1);
  }
  const code = await runFakeHarnessScenario({ scenario, apiUrl, botToken, workDir, deliveryMode });
  process.exit(code);
}

if (import.meta.main) {
  await mainCli();
}
