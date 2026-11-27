import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dir, 'check-pushed-env.sh');
const ZERO = '0'.repeat(40);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const res = Bun.spawnSync(['git', ...args], { cwd });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr.toString()}`);
  return res.stdout.toString().trim();
}

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pushed-env-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commit(dir: string, message: string, files: Record<string, string | null>): string {
  for (const [name, content] of Object.entries(files)) {
    if (content === null) git(dir, 'rm', '-q', '--cached', name);
    else {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), content);
      git(dir, 'add', '-f', name);
    }
  }
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function prePush(dir: string, localSha: string, remoteSha: string): { code: number; err: string } {
  const res = Bun.spawnSync([SCRIPT], {
    cwd: dir,
    stdin: Buffer.from(`refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`),
  });
  return { code: res.exitCode, err: res.stderr.toString() };
}

// Value: protects=a .env committed and later untracked never leaves the machine (the public
// history would keep the secret); fails_when=the guard checks only the current index or skips
// commits of a new branch; why_new=pre-commit was removed, pre-push is the last local stop;
// seam=the hook's stdin protocol; no_claim=a .env pushed some other way than git push.
test('a push is rejected when an outgoing commit contained .env, even if later untracked', () => {
  const dir = repo();
  commit(dir, 'base', { 'README.md': 'x', '.env.example': 'KEY=' });
  const withEnv = commit(dir, 'oops', { '.env': 'KEY=secret' });
  const head = commit(dir, 'untrack', { '.env': null });
  expect(git(dir, 'ls-files', '.env')).toBe('');

  const newBranch = prePush(dir, head, ZERO);
  expect(newBranch.code).toBe(1);
  expect(newBranch.err).toContain(`commit ${withEnv} contains: .env`);

  const update = prePush(dir, head, git(dir, 'rev-parse', 'HEAD~2'));
  expect(update.code).toBe(1);
});

test('a push without .env in its outgoing commits passes, .env.example included', () => {
  const dir = repo();
  const base = commit(dir, 'base', { 'README.md': 'x' });
  const head = commit(dir, 'example', { '.env.example': 'KEY=', 'nested.env.ts': 'x' });
  expect(prePush(dir, head, ZERO).code).toBe(0);
  expect(prePush(dir, head, base).code).toBe(0);
  // Deleting a remote branch sends a zero local sha: nothing to check.
  expect(prePush(dir, ZERO, head).code).toBe(0);
});

test('commits already on the remote are not checked again', () => {
  const dir = repo();
  commit(dir, 'base', { 'README.md': 'x' });
  commit(dir, 'old env', { 'config/.env.local': 'KEY=old' });
  const pushed = commit(dir, 'untrack', { 'config/.env.local': null });
  const head = commit(dir, 'next', { 'b.txt': 'y' });
  expect(prePush(dir, head, pushed).code).toBe(0);
});
