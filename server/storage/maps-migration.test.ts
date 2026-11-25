import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GeoError } from '../errors.ts';
import { readMatchRecords } from './matches.ts';
import { loadSettings, saveSettings } from './settings.ts';

const V1_SETTINGS = {
  version: 1,
  rounds: 7,
  roundDurationSec: 90,
  moveEnabled: false,
  aiWaitWindowSec: 15,
  bots: [],
};

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'geo-maps-migration-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Value: protects=a settings file of version 1 keeps every setting and gains the map, with the airports map moved out of the region; fails_when=the migration is dropped and the file is renamed to .bad, losing the bots;
// why_new=settings had no migration before; seam=none; no_claim=files older than version 1 (none exist)
test('a version 1 settings file migrates to version 2 without losing a setting', () => {
  withTempDir((dir) => {
    const plain = path.join(dir, 'plain.json');
    writeFileSync(plain, JSON.stringify({ ...V1_SETTINGS, region: 'europe' }));
    const europe = loadSettings(plain);
    expect(europe.status).toBe('migrated');
    expect(europe.value).toMatchObject({
      version: 2,
      map: 'standard',
      region: 'europe',
      rounds: 7,
      roundDurationSec: 90,
      moveEnabled: false,
    });
    expect(existsSync(`${plain}.bad`)).toBe(false);

    const airports = path.join(dir, 'airports.json');
    writeFileSync(airports, JSON.stringify({ ...V1_SETTINGS, region: 'airports' }));
    const moved = loadSettings(airports);
    expect(moved.status).toBe('migrated');
    expect(moved.value.map).toBe('airports');
    expect(moved.value.region).toBe('world');

    // Saving writes the new version; loading it again needs no migration.
    saveSettings(airports, moved.value, moved.status);
    expect(JSON.parse(readFileSync(airports, 'utf8'))).toMatchObject({
      version: 2,
      map: 'airports',
    });
    expect(loadSettings(airports).status).toBe('ok');
  });
});

// Value: protects=a one-country region survives a save and a load, and a country this build does not know falls back to the world; fails_when=a country region is rejected by the schema or an unknown one reaches the sampler;
// why_new=regions were a fixed list; seam=none; no_claim=the lobby's own check of a patch (storage only)
test('settings keep a one-country region and replace an unknown country with the world', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'settings.json');
    const settings = { ...V1_SETTINGS, version: 2, map: 'capitals', region: 'country:FRA' };
    writeFileSync(file, JSON.stringify(settings));
    const loaded = loadSettings(file);
    expect(loaded.status).toBe('ok');
    expect(loaded.value.region).toBe('country:FRA');
    expect(loaded.value.map).toBe('capitals');

    writeFileSync(file, JSON.stringify({ ...settings, region: 'country:ZZZ' }));
    const unknown = loadSettings(file);
    expect(unknown.status).toBe('ok');
    expect(unknown.value.region).toBe('world');
    expect(unknown.value.map).toBe('capitals');

    writeFileSync(file, JSON.stringify({ ...settings, map: 'atlantis' }));
    expect(loadSettings(file).status).toBe('unreadable');
  });
});

// Value: protects=an older build reading a version 2 file would refuse to overwrite it, and this build does the same for version 3; fails_when=a newer settings file is renamed to .bad or overwritten;
// why_new=the settings version moved for the first time; seam=none; no_claim=the behaviour of the already released builds (checked by reading their code path, which this test repeats)
test('a settings file of a newer version is left alone', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'settings.json');
    const future = JSON.stringify({ ...V1_SETTINGS, version: 3, map: 'standard', region: 'world' });
    writeFileSync(file, future);
    const loaded = loadSettings(file);
    expect(loaded.status).toBe('newer_version');
    expect(loaded.fileVersion).toBe(3);
    let refused: unknown;
    try {
      saveSettings(file, loaded.value, loaded.status);
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(GeoError);
    expect((refused as GeoError).code).toBe('GEO_SETTINGS_NEWER');
    expect(readFileSync(file, 'utf8')).toBe(future);
    expect(existsSync(`${file}.bad`)).toBe(false);
  });
});

const V1_RECORD = {
  version: 1,
  matchId: 'old-match',
  startedAt: '2026-11-13T10:00:00.000Z',
  endedAt: '2026-11-13T10:05:00.000Z',
  plannedRounds: 5,
  playedRounds: 5,
  moveEnabled: true,
  participants: [],
  humanVsAi: { visible: false, humansTotal: 0, aiTotal: 0 },
  rounds: [],
};

// Value: protects=match history written before the map existed is still read, with the airports map recovered from its old region; fails_when=version 1 lines are skipped as invalid and the win counters reset;
// why_new=match records had one version; seam=none; no_claim=the wins counter itself (reader only)
test('version 1 match records are read as version 2 with their map', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'matches.jsonl');
    const lines = [
      { ...V1_RECORD, region: 'asia' },
      { ...V1_RECORD, matchId: 'old-airports', region: 'airports' },
      { ...V1_RECORD, version: 2, matchId: 'new', map: 'cities', region: 'country:JPN' },
      { ...V1_RECORD, version: 3, matchId: 'future' },
      { ...V1_RECORD, matchId: 'broken', region: 'atlantis' },
    ];
    writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    const read = readMatchRecords(file);
    expect(read.records.map((r) => [r.matchId, r.version, r.map, r.region])).toEqual([
      ['old-match', 2, 'standard', 'asia'],
      ['old-airports', 2, 'airports', 'world'],
      ['new', 2, 'cities', 'country:JPN'],
    ]);
    expect(read.skippedNewer).toBe(1);
    expect(read.skippedInvalid).toBe(1);
  });
});
