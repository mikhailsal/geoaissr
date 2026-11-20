import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createBotRunner } from '../server/bots/runner.ts';
import type { EngineEvent } from '../server/engine/types.ts';
import { createFakeLocationService } from '../server/location.ts';
import { loadDataset } from './eval-bots/manifest.ts';
import { pickFinalGuess } from './eval-bots/records.ts';

test('loadDataset rejects missing manifest when --dataset is passed and resolves imagePaths', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-ds-'));
  try {
    expect(() => loadDataset(path.join(dir, 'missing'))).toThrow();
    const imgBuf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 40, b: 80 } },
    })
      .jpeg()
      .toBuffer();
    for (const name of ['0.jpg', '90.jpg', '180.jpg', '270.jpg']) {
      writeFileSync(path.join(dir, name), imgBuf);
    }
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify([
        {
          id: 'pl-1',
          countryNameRu: 'Польша',
          lat: 52.23,
          lng: 21.01,
          imagePaths: ['0.jpg', '90.jpg', '180.jpg', '270.jpg'],
        },
      ]),
    );
    const items = loadDataset(dir);
    expect(items.length).toBe(1);
    expect(items[0]?.imagePaths?.[0]).toBe(path.join(dir, '0.jpg'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('eval-bots CLI fails live runs without imagePaths and writes a dry summary and rounds file to --out', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-cli-'));
  try {
    const outFile = path.join(dir, 'out-report');
    const badProc = Bun.spawn([process.execPath, 'run', 'scripts/eval-bots.ts', '--repeats', '1'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await badProc.exited).not.toBe(0);

    const dryProc = Bun.spawn(
      [
        process.execPath,
        'run',
        'scripts/eval-bots.ts',
        '--dry',
        '--repeats',
        '1',
        '--out',
        outFile,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(await dryProc.exited).toBe(0);
    expect(existsSync(path.join(outFile, 'rounds.jsonl'))).toBe(true);
    const report = JSON.parse(readFileSync(path.join(outFile, 'summary.json'), 'utf8')) as {
      dry: boolean;
      repeats: number;
      rounds: number;
    };
    expect(report.dry).toBe(true);
    expect(report.repeats).toBe(1);
    expect(report.rounds).toBe(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('eval-bots --dataset --dry handles valid dataset dir without hanging on getLookView', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-eval-dsrun-'));
  try {
    const imgBuf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 70, g: 110, b: 140 } },
    })
      .jpeg()
      .toBuffer();
    for (const name of ['0.jpg', '90.jpg', '180.jpg', '270.jpg']) {
      writeFileSync(path.join(dir, name), imgBuf);
    }
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify([
        {
          id: 'it-1',
          countryNameRu: 'Италия',
          lat: 41.9,
          lng: 12.5,
          imagePaths: ['0.jpg', '90.jpg', '180.jpg', '270.jpg'],
        },
      ]),
    );
    const outFile = path.join(dir, 'ds-out');
    const proc = Bun.spawn(
      [
        process.execPath,
        'run',
        'scripts/eval-bots.ts',
        '--dataset',
        dir,
        '--dry',
        '--repeats',
        '1',
        '--out',
        outFile,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(await proc.exited).toBe(0);
    const report = JSON.parse(readFileSync(path.join(outFile, 'summary.json'), 'utf8')) as {
      rounds: number;
      medianErrorKm: number | null;
      finishRate: number | null;
    };
    // One spot at one repeat gives exactly one measured round.
    expect(report.rounds).toBe(1);
    expect(typeof report.medianErrorKm).toBe('number');
    expect(report.finishRate).toBe(1);
    const lines = readFileSync(path.join(outFile, 'rounds.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    const row = JSON.parse(lines[0] ?? '{}') as { spotId: string; pinSource: string };
    expect(row.spotId).toBe('it-1');
    expect(row.pinSource).toBe('final');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fake bot runner dispatches aborted bot_finished when fake sequence rejects', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-fake-err-'));
  mkdirSync(dir, { recursive: true });
  const events: EngineEvent[] = [];
  const runner = createBotRunner({
    runDir: path.join(dir, 'run'),
    childrenFile: path.join(dir, 'children.json'),
    fakeMode: true,
    fakeStepDelayMs: 5,
    imageService: {
      prepareStartViews: () => Promise.resolve(),
      getObserveViews: () => Promise.resolve([]),
      getLookView: () => Promise.reject(new Error('forced look error')),
      getMoveView: () => Promise.reject(new Error('no move')),
      clearRound: () => undefined,
    },
    locationService: createFakeLocationService(),
    dispatch: (e) => events.push(e),
  });
  try {
    runner.startRoundBots({
      matchId: 'm-err',
      gen: 1,
      roundNumber: 1,
      target: {
        panoId: 'p0',
        lat: 0,
        lng: 0,
        countryId: '0',
        countryNameRu: 'Тест',
        region: 'world',
        fakeSceneIndex: 0,
      },
      bots: [
        {
          id: 'b1',
          name: 'Bot1',
          color: 'p-4',
          harness: 'claude',
          model: 'haiku',
          effort: 'low',
          moveLimit: 0,
          imageSize: 256,
          budgetSec: 60,
          personalityPreset: 'neutral',
          personalityText: '',
          difficultyPreset: 'custom',
          enabled: true,
        },
      ],
      moveEnabled: false,
    });
    runner.releaseObserve('m-err', 1, 1);
    await new Promise((r) => setTimeout(r, 60));
    const finished = events.find((e) => e.type === 'bot_finished');
    expect(finished?.type).toBe('bot_finished');
    if (finished?.type === 'bot_finished') {
      expect(finished.aborted).toBe(true);
      expect(finished.diagnosticsTail).toContain('forced look error');
    }
  } finally {
    await runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const GUESS_IDS = { matchId: 'm', gen: 1, roundNumber: 1, botId: 'b' } as const;

function guessEvent(lat: number, lng: number, finalized?: boolean): EngineEvent {
  return {
    type: 'bot_guess_recorded',
    ...GUESS_IDS,
    guess: { lat, lng, explanation: 'test' },
    finalized,
  };
}

const FINISHED_EVENT: EngineEvent = {
  type: 'bot_finished',
  ...GUESS_IDS,
  aborted: false,
  reason: 'done',
};

// protects=latest draft fallback; fails_when=an earlier checkpoint is scored; no_claim=live model quality.
test('pickFinalGuess scores the latest draft when no final arrives', () => {
  const picked = pickFinalGuess([
    guessEvent(10, 20, false),
    guessEvent(11, 21, false),
    FINISHED_EVENT,
  ]);
  expect(picked).toMatchObject({ lat: 11, lng: 21 });
});

// protects=final immutability and legacy final events; fails_when=later draft or final overwrites a final; no_claim=queue behavior.
test('pickFinalGuess preserves the first final against later guesses', () => {
  for (const finalized of [true, undefined]) {
    const picked = pickFinalGuess([
      guessEvent(1, 2, false),
      guessEvent(10, 20, finalized),
      guessEvent(11, 21, false),
      guessEvent(12, 22, true),
      FINISHED_EVENT,
    ]);
    expect(picked).toMatchObject({ lat: 10, lng: 20 });
  }
});

test('pickFinalGuess ignores guesses recorded after the bot finished, like the reducer', () => {
  const picked = pickFinalGuess([guessEvent(10, 20), FINISHED_EVENT, guessEvent(11, 21)]);
  expect(picked).toMatchObject({ lat: 10, lng: 20 });
});

test('pickFinalGuess returns null when the bot never guessed', () => {
  expect(pickFinalGuess([FINISHED_EVENT])).toBeNull();
});
