// Value: protects=the two processes of a Detective on codex and agy: each gets its role's tools, approved, and the long MCP timeout; the brain on agy cannot open any file, so it cannot read the eyes' frames; fails_when=a role lists the camera tools, codex asks to approve a role tool it cannot answer, a 45 s ask is cut by the CLI, or the brain's guard lets read_file through; why_new=the Detective ran only on claude; seam=none; no_claim=how the real CLIs follow the config.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DetectiveRole } from '../../../shared/detective-tools.ts';
import { getHarnessAdapter } from './index.ts';
import { MCP_TOOL_TIMEOUT_SEC } from './shared.ts';

function launch(harness: 'codex' | 'agy', workDir: string, role: DetectiveRole) {
  return getHarnessAdapter(harness).buildLaunchSpec({
    workDir,
    model: harness === 'codex' ? 'gpt-6-luna' : 'gemini-3.8-flash-low',
    effort: 'low',
    prompt: 'go',
    apiUrl: 'http://127.0.0.1:9999',
    botToken: `tok-${role}`,
    moveEnabled: true,
    role,
  });
}

function withDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-detective-roles-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The tool names codex is told to approve in advance. */
function codexApprovals(cmd: readonly string[]): string[] {
  return cmd.flatMap((arg) => {
    const m = /^mcp_servers\.geo\.tools\.([a-z_]+)\.approval_mode="approve"$/.exec(arg);
    return m?.[1] ? [m[1]] : [];
  });
}

test('codex runs each role with its own tools approved, its role set and a long MCP timeout', () => {
  withDir((dir) => {
    const brain = launch('codex', path.join(dir, 'brain'), 'brain');
    expect(codexApprovals(brain.cmd).sort()).toEqual(['ask', 'briefing', 'final_guess']);
    expect(brain.cmd).toContain('mcp_servers.geo.env.GEO_BOT_ROLE="brain"');
    expect(brain.cmd).toContain(`mcp_servers.geo.tool_timeout_sec=${String(MCP_TOOL_TIMEOUT_SEC)}`);
    const eyes = launch('codex', path.join(dir, 'eyes'), 'eyes');
    expect(codexApprovals(eyes.cmd).sort()).toEqual(
      ['answer', 'look', 'move', 'next_request', 'observe', 'report'].sort(),
    );
    expect(eyes.cmd).toContain('mcp_servers.geo.env.GEO_BOT_ROLE="eyes"');
    // An ask waits up to 45 s; the CLI must not cut the call before the server answers.
    expect(MCP_TOOL_TIMEOUT_SEC).toBeGreaterThan(45);
  });
});

function runGuard(workDir: string, toolCall: unknown): string {
  const guardPath = path.join(workDir, '.agents', 'plugins', 'geo', 'guard.ts');
  const res = Bun.spawnSync([process.execPath, 'run', guardPath], {
    stdin: new TextEncoder().encode(JSON.stringify({ toolCall })),
  });
  return (JSON.parse(res.stdout.toString()) as { decision: string }).decision;
}

function mcpEnv(workDir: string): Record<string, string> {
  const file = path.join(workDir, '.agents', 'plugins', 'geo', 'mcp_config.json');
  const config = JSON.parse(readFileSync(file, 'utf8')) as {
    mcpServers: { geo: { env: Record<string, string> } };
  };
  return config.mcpServers.geo.env;
}

test('agy lets each role call only its own tools; the brain may not open any file', () => {
  withDir((dir) => {
    const brainDir = path.join(dir, 'brain');
    const eyesDir = path.join(dir, 'eyes');
    const brain = launch('agy', brainDir, 'brain');
    const eyes = launch('agy', eyesDir, 'eyes');
    expect(mcpEnv(brain.cwd).GEO_BOT_ROLE).toBe('brain');
    expect(mcpEnv(eyes.cwd)).toMatchObject({ GEO_BOT_ROLE: 'eyes', GEO_DELIVERY_MODE: 'file' });

    expect(runGuard(brain.cwd, { name: 'mcp_geo_geo_briefing', args: {} })).toBe('allow');
    expect(runGuard(brain.cwd, { name: 'mcp_geo_geo_look', args: {} })).toBe('deny');
    expect(runGuard(eyes.cwd, { name: 'mcp_geo_geo_look', args: {} })).toBe('allow');
    expect(runGuard(eyes.cwd, { name: 'mcp_geo_geo_final_guess', args: {} })).toBe('deny');

    // The eyes save their frames in their own directory and may read them there.
    mkdirSync(eyes.cwd, { recursive: true });
    writeFileSync(path.join(eyes.cwd, 'frame-1.jpg'), 'image');
    writeFileSync(path.join(brain.cwd, 'note.txt'), 'text');
    const eyesFrame = path.join(realpathSync(eyes.cwd), 'frame-1.jpg');
    expect(runGuard(eyes.cwd, { name: 'read_file', args: { Path: 'frame-1.jpg' } })).toBe('allow');
    // The brain is refused the eyes' frame by any path, and even a file of its own.
    for (const Path of [eyesFrame, '../eyes/frame-1.jpg', 'note.txt']) {
      expect(runGuard(brain.cwd, { name: 'read_file', args: { Path } })).toBe('deny');
      expect(runGuard(brain.cwd, { name: 'view_file', args: { path: Path } })).toBe('deny');
    }
  });
});
