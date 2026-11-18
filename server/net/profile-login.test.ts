import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatProfileToken } from '../../shared/profile-token.ts';
import type { ServerMessage } from '../../shared/protocol.ts';
import type { StoredProfile } from '../../shared/storage-schemas.ts';
import { createRoomShell } from '../engine/shell.ts';
import { createInitialRoomState } from '../engine/types.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { createServerLogger } from '../log.ts';
import { ProfileStore } from '../storage/profiles.ts';
import { buildQuotaSummaryForRoom, createQuotaManager } from '../storage/quota.ts';
import { startAppHttpServer } from './http.ts';
import { createAuthRateLimiter } from './rate-limit.ts';
import { createWsRoomCoordinator } from './ws.ts';

function fixture(dir: string, suffix = '') {
  const logger = createServerLogger(path.join(dir, 'logs'));
  const profiles = new ProfileStore(path.join(dir, 'profiles.json'), (tokens) => {
    logger.registerSecrets([], tokens);
  });
  const quota = createQuotaManager(path.join(dir, 'quota.json'));
  const initial = createInitialRoomState({
    matchId: 'profile-test',
    fakeMode: true,
    settings: {
      version: 1,
      region: 'world',
      rounds: 1,
      roundDurationSec: 60,
      moveEnabled: true,
      aiWaitWindowSec: 0,
      bots: [],
    },
    quotaSummary: buildQuotaSummaryForRoom(quota, { rounds: 1 }),
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [],
  });
  const shell = createRoomShell(initial, {
    onStateChange: () => {
      coordinator.broadcastState();
    },
    saveSettings: async () => {},
    confirmQuotaReset: () => Promise.resolve(initial.quotaSummary),
    prepareRound: () =>
      Promise.resolve({
        panoId: 'fake',
        lat: 55,
        lng: 37,
        countryId: '643-eu',
        countryNameRu: 'Россия',
        region: 'world',
        fakeSceneIndex: 0,
      }),
    startBotProcesses: () => {},
    releaseBotObserve: () => {},
    stopBotProcess: () => {},
    stopAllBots: () => {},
    clearRoundImages: () => {},
    clearThumbs: () => {},
    appendMatchRecord: async () => {},
    logRoundEnd: () => {},
  });
  const rateLimiter = createAuthRateLimiter('tunnel');
  const coordinator = createWsRoomCoordinator({
    shell,
    profiles,
    hostToken: 'host' + suffix,
    guestToken: 'guest' + suffix,
    browserMapsKey: null,
    fakeMode: true,
    quotaManager: quota,
    rateLimiter,
  });
  const server = startAppHttpServer({
    port: 0,
    staticDir: path.join(dir, 'missing'),
    shell,
    thumbStore: createThumbStore(),
    wsCoordinator: coordinator,
    rateLimiter,
  });
  return {
    profiles,
    shell,
    server,
    rateLimiter,
    logger,
    url: server.baseUrl.replace('http:', 'ws:') + '/ws',
    stop: () => {
      server.stop();
      shell.dispose();
    },
  };
}
async function connect(url: string) {
  const socket = new WebSocket(url);
  const queue: ServerMessage[] = [];
  let wake: (() => void) | null = null;
  let closed: number | null = null;
  socket.onmessage = (event) => {
    queue.push(JSON.parse(String(event.data)) as ServerMessage);
    wake?.();
  };
  socket.onclose = (event) => {
    closed = event.code;
    wake?.();
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => {
      resolve();
    };
    socket.onerror = () => {
      reject(new Error('socket failed'));
    };
  });
  return {
    socket,
    send: (value: unknown) => {
      socket.send(JSON.stringify(value));
    },
    next: async <T extends ServerMessage['type']>(
      type: T,
    ): Promise<Extract<ServerMessage, { type: T }>> => {
      const deadline = Date.now() + 2000;
      for (;;) {
        const value = queue.shift();
        if (value?.type === type) return value as Extract<ServerMessage, { type: T }>;
        if (value) continue;
        if (closed !== null || Date.now() > deadline) throw new Error('missing ' + type);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 30);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    },
    closeCode: async () => {
      while (closed === null) await Bun.sleep(5);
      return closed;
    },
  };
}
async function register(f: ReturnType<typeof fixture>, role = 'guest', profileId?: string) {
  const c = await connect(f.url);
  c.send({ type: 'hello', token: role });
  await c.next('hello_ok');
  c.send({ type: 'join', seq: 1, nick: 'Same', color: 'p-1', profileId });
  const owner = await c.next('join_ok');
  return { c, owner };
}
async function login(f: ReturnType<typeof fixture>, profile: StoredProfile) {
  const c = await connect(f.url);
  c.send({
    type: 'profile_login',
    profileToken: formatProfileToken(profile.profileToken).toUpperCase(),
  });
  return { c, ok: await c.next('profile_login_ok') };
}
function temporary(): string {
  return mkdtempSync(path.join(tmpdir(), 'geo-profile-wire-'));
}

// I1 protects: invitation-required registration and durable owner credential issuance;
// fails_when: bare registration works, persistence follows success or role authority is misassigned;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('registration requires invitation and persists owner credentials before responding', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const bare = await connect(f.url);
    bare.send({ type: 'join', seq: 1, nick: 'A', color: 'p-1' });
    expect(await bare.closeCode()).toBe(4001);
    expect(f.shell.getState().playerOrder).toHaveLength(0);
    const { owner, c } = await register(f, 'host');
    const saved = new ProfileStore(path.join(dir, 'profiles.json')).getById(
      owner.profile.profileId,
    );
    expect(saved).toEqual(owner.profile);
    expect(saved?.role).toBe('host');
    c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I2 protects: code-only login and generic invalid-code handling;
// fails_when: invitation is required, invalid code creates seats or error leaks input;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('code login works without invitation and malformed or unknown codes fail identically', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { owner, c } = await register(f);
    c.socket.close();
    const restored = await login(f, owner.profile);
    expect(restored.ok.playerId).toBe(owner.playerId);
    const errors = [];
    for (const raw of ['secret malformed value', 'f'.repeat(32), ' '.repeat(65)]) {
      const bad = await connect(f.url);
      bad.send({ type: 'profile_login', profileToken: raw });
      const error = await bad.next('profile_login_error');
      errors.push(error.message);
      expect(error.code).toBe('invalid_profile_token');
      expect(JSON.stringify(error)).not.toContain(raw);
      expect(await bad.closeCode()).toBe(4003);
    }
    expect(new Set(errors).size).toBe(1);
    expect(f.shell.getState().playerOrder).toHaveLength(1);
    restored.c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I4 protects: persisted host/guest authority survives fresh invitation tokens;
// fails_when: host loses or guest acquires host actions;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('registry roles survive room restart and fresh invitation tokens', async () => {
  const dir = temporary();
  let f = fixture(dir);
  try {
    const host = await register(f, 'host');
    const guest = await register(f);
    f.stop();
    f = fixture(dir, '-fresh');
    for (const [owner, role, expected] of [
      [host.owner, 'host', 'ok'],
      [guest.owner, 'guest', 'forbidden'],
    ] as const) {
      const restored = await login(f, owner.profile);
      expect(restored.ok.profile.role).toBe(role);
      restored.c.send({ type: 'update_lobby', seq: 2, patch: { rounds: 3 } });
      expect((await restored.c.next('ack')).result).toBe(expected);
      restored.c.socket.close();
    }
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I5 protects: one connection resumes existing active-round state;
// fails_when: extra seat, changed results or old close disconnects replacement;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('takeover preserves active seat, guesses and score and clears previous connection ownership', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { owner, c } = await register(f, 'host');
    // Controlled engine fixture isolates transport takeover from real panorama/model timing.
    const state = f.shell.getState();
    state.phase = 'ROUND_ACTIVE';
    const seat = state.players[owner.playerId];
    if (!seat) throw new Error('seat missing');
    seat.totalScore = 123;
    seat.answeredRounds = 1;
    seat.isSpectator = false;
    state.roundNumber = 1;
    state.loadingOrActive = {
      roundNumber: 1,
      startedLoadingAt: Date.now(),
      startImagesReady: true,
      startImagesReadyAt: Date.now(),
      countdownStartsAt: Date.now(),
      target: {
        panoId: 'fake',
        lat: 55,
        lng: 37,
        countryId: '643-eu',
        countryNameRu: 'Россия',
        region: 'world',
        fakeSceneIndex: 0,
      },
      roundStartedAt: Date.now(),
      roundDeadlineAt: Date.now() + 60000,
      endsAt: Date.now() + 60000,
      allHumansConfirmedAt: null,
      humanGuesses: {
        [owner.playerId]: { pin: { lat: 10, lng: 20 }, confirmed: true, confirmedAt: Date.now() },
      },
      bots: {},
    };
    const guessBefore = structuredClone(state.loadingOrActive.humanGuesses);
    const before = { ...seat };
    const replacement = await login(f, owner.profile);
    expect(replacement.ok.resumedSeat).toBe(true);
    expect(await c.closeCode()).toBe(4002);
    await Bun.sleep(10);
    expect(f.shell.getState().players[owner.playerId]).toEqual({ ...before, connected: true });
    expect(f.shell.getState().loadingOrActive?.humanGuesses).toEqual(guessBefore);
    const view = await replacement.c.next('state');
    expect(view.view.active?.myPin).toEqual({ lat: 10, lng: 20 });
    expect(view.view.active?.myConfirmed).toBe(true);
    expect(f.shell.getState().playerOrder).toEqual([owner.playerId]);
    replacement.c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I6 protects: capacity treats existing seats separately from new profiles;
// fails_when: full room blocks return or admits an extra participant;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('full room resumes existing profile but rejects a ninth seat', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { owner, c } = await register(f, 'host');
    c.socket.close();
    for (let i = 1; i < 8; i++)
      f.shell.dispatch({
        type: 'player_join',
        playerId: `seat${i}`,
        secret: 'test',
        name: 'Same',
        color: 'p-1',
        isHost: false,
      });
    const returned = await login(f, owner.profile);
    expect(returned.ok.resumedSeat).toBe(true);
    const extra = f.profiles.create({ nick: 'Same', color: 'p-1', role: 'guest' });
    const rejected = await connect(f.url);
    rejected.send({ type: 'profile_login', profileToken: extra.profileToken });
    expect((await rejected.next('profile_login_error')).code).toBe('room_full');
    expect(f.shell.getState().playerOrder).toHaveLength(8);
    returned.c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I7 protects: first legacy enrollment and bound-seat ID preservation;
// fails_when: IDs replaced, reclaimed or overwritten by submitted different ID;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('legacy opaque ID enrolls once and bound seat secret keeps authoritative ID', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { owner, c } = await register(f, 'guest', 'opaque legacy ID');
    c.socket.close();
    const bound = await connect(f.url);
    bound.send({
      type: 'hello',
      token: 'host',
      playerId: owner.playerId,
      playerSecret: owner.playerSecret,
      profileId: 'attacker ID',
    });
    const hello = await bound.next('hello_ok');
    expect(hello.profile).toEqual(owner.profile);
    expect(hello.role).toBe('guest');
    expect(hello.restoredProfileId).toBe('opaque legacy ID');
    expect(f.profiles.getById('attacker ID')).toBeUndefined();
    bound.socket.close();
    f.shell.dispatch({
      type: 'player_join',
      playerId: 'legacy-unbound',
      secret: 'test-old',
      name: 'Legacy',
      color: 'p-1',
      isHost: false,
    });
    const unbound = await connect(f.url);
    unbound.send({
      type: 'hello',
      token: 'host',
      playerId: 'legacy-unbound',
      playerSecret: 'test-old',
      profileId: owner.profile.profileId,
    });
    expect((await unbound.next('profile_login_error')).code).toBe('profile_store_unavailable');
    expect(f.shell.getState().players['legacy-unbound']?.profileId).toBeUndefined();
    expect(f.profiles.getById(owner.profile.profileId)).toEqual(owner.profile);
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// protects=legacy host seats enroll only with host authority and retain their authoritative ID;
// fails_when=guest invitation creates an unusable guest credential for a host or mutates rejected seats;
// why_new=legacy hosts without a registry entry exercise the new permanent-code enrollment gap;
// seam=none; no_claim=local WS and isolated files, not public network or production credentials.
test('legacy host enrollment rejects guest authority before persistence and accepts host invitation', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const unrelated = f.profiles.create({ nick: 'Other', color: 'p-2', role: 'guest' });
    const file = path.join(dir, 'profiles.json');
    const registryBefore = readFileSync(file, 'utf8');
    for (const bound of [false, true]) {
      const playerId = `legacy-host-${bound}`;
      const profileId = `authoritative-host-${bound}`;
      f.shell.dispatch({
        type: 'player_join',
        playerId,
        secret: 'test',
        name: 'Legacy host',
        color: 'p-1',
        isHost: true,
        profileId: bound ? profileId : undefined,
      });
      const before = structuredClone(f.shell.getState().players[playerId]);
      const rejected = await connect(f.url);
      rejected.send({
        type: 'hello',
        token: 'guest',
        playerId,
        playerSecret: 'test',
        profileId: bound ? 'submitted-different-ID' : profileId,
      });
      expect((await rejected.next('profile_login_error')).code).toBe('profile_store_unavailable');
      expect(await rejected.closeCode()).toBe(4003);
      expect(f.shell.getState().players[playerId]).toEqual(before);
      expect(readFileSync(file, 'utf8') === registryBefore).toBe(true);
    }
    const accepted = await connect(f.url);
    accepted.send({
      type: 'hello',
      token: 'host',
      playerId: 'legacy-host-true',
      playerSecret: 'test',
      profileId: 'submitted-different-ID',
    });
    const hello = await accepted.next('hello_ok');
    expect(hello.role).toBe('host');
    expect(hello.profile?.profileId).toBe('authoritative-host-true');
    expect(f.profiles.getById('submitted-different-ID')).toBeUndefined();
    expect(f.profiles.getById(unrelated.profileId)?.profileToken === unrelated.profileToken).toBe(
      true,
    );
    const persisted = new ProfileStore(file).getById('authoritative-host-true');
    expect(persisted?.role).toBe('host');
    if (!persisted) throw new Error('host profile missing');
    const returned = await login(f, persisted);
    expect(returned.ok.playerId).toBe('legacy-host-true');
    expect(returned.ok.profile.role).toBe('host');
    returned.c.socket.close();
    accepted.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I8 protects: both auth paths retain one-shot authentication and failure limits;
// fails_when: profile login permits identity switching or bypasses accounting;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('both authentication paths reject repeated auth and profile failures are counted', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { owner, c } = await register(f);
    c.send({ type: 'profile_login', profileToken: owner.profile.profileToken });
    expect(await c.closeCode()).toBe(4004);
    const restored = await login(f, owner.profile);
    restored.c.send({ type: 'hello', token: 'host' });
    expect(await restored.c.closeCode()).toBe(4004);
    for (let i = 0; i < 11; i++) {
      const bad = await connect(f.url);
      bad.send({ type: 'profile_login', profileToken: 'wrong' });
      await bad.closeCode();
    }
    expect(f.rateLimiter.isBlocked('127.0.0.1')).toBe(true);
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I9 protects: credentials remain owner-only in views and sanitized logs/crashes;
// fails_when: non-owner receives a code or diagnostics retain its complete value;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('room views and diagnostics do not expose profile credentials', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const host = await register(f, 'host');
    const guest = await register(f);
    const view = await guest.c.next('state');
    expect(JSON.stringify(view)).not.toContain(host.owner.profile.profileToken);
    expect(JSON.stringify(f.shell.getView(host.owner.playerId))).not.toContain(
      guest.owner.profile.profileToken,
    );
    f.logger.log('client_error', { message: host.owner.profile.profileToken });
    expect(JSON.stringify(f.shell.getState())).not.toContain(host.owner.profile.profileToken);
    const crash = f.logger.writeCrash(new Error(guest.owner.profile.profileToken));
    expect(readFileSync(crash, 'utf8')).not.toContain(guest.owner.profile.profileToken);
    for (const filename of readdirSync(path.join(dir, 'logs')))
      expect(readFileSync(path.join(dir, 'logs', filename), 'utf8')).not.toContain(
        host.owner.profile.profileToken,
      );
    host.c.socket.close();
    guest.c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I10 protects: wire edit acknowledgment follows durable persistence;
// fails_when: failed save mutates state or success reloads stale fields/changes code;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('wire edits persist before success and failed writes preserve live and stored values', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { owner, c } = await register(f);
    c.send({ type: 'update_profile', seq: 2, nick: 'Edited', color: 'p-2' });
    expect((await c.next('ack')).result).toBe('ok');
    const persisted = new ProfileStore(path.join(dir, 'profiles.json')).getById(
      owner.profile.profileId,
    );
    expect(persisted).toEqual({ ...owner.profile, nick: 'Edited', color: 'p-2' });
    const bytes = readFileSync(path.join(dir, 'profiles.json'), 'utf8');
    rmSync(path.join(dir, 'profiles.json'));
    mkdirSync(path.join(dir, 'profiles.json'));
    writeFileSync(path.join(dir, 'profiles.json', 'original'), bytes);
    c.send({ type: 'update_profile', seq: 3, nick: 'Lost', color: 'p-3' });
    expect((await c.next('ack')).result).toBe('invalid');
    expect(f.shell.getState().players[owner.playerId]?.name).toBe('Edited');
    expect(f.profiles.getById(owner.profile.profileId)).toEqual(persisted);
    c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// I2/I5 protects: corrupt profile storage and duplicate seats fail closed without displacement;
// fails_when: ambiguous identity logs in, original file changes or an active owner is disconnected;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('corrupt registry and multiple-seat identity reject login without selecting or replacing a seat', async () => {
  const dir = temporary();
  let f = fixture(dir);
  try {
    const { owner, c } = await register(f);
    f.shell.dispatch({
      type: 'player_join',
      playerId: 'duplicate',
      secret: 'other',
      name: 'Same',
      color: 'p-1',
      profileId: owner.profile.profileId,
      isHost: false,
    });
    const rejected = await connect(f.url);
    rejected.send({ type: 'profile_login', profileToken: owner.profile.profileToken });
    expect((await rejected.next('profile_login_error')).code).toBe('profile_store_unavailable');
    expect(f.shell.getState().players[owner.playerId]?.connected).toBe(true);
    c.socket.close();
    f.stop();
    const file = path.join(dir, 'profiles.json');
    writeFileSync(file, '{bad');
    f = fixture(dir);
    const unavailable = await connect(f.url);
    unavailable.send({ type: 'profile_login', profileToken: owner.profile.profileToken });
    expect((await unavailable.next('profile_login_error')).code).toBe('profile_store_unavailable');
    expect(readFileSync(file, 'utf8')).toBe('{bad');
    expect(f.shell.getState().playerOrder).toHaveLength(0);
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
// I8 protects: unauthenticated sockets time out before either authentication path;
// fails_when: the new path leaves idle sockets alive past the shared timeout;
// no_claim: local server/WS and isolated files with fake dependencies; not a public tunnel or paid model.
// why_new=Permanent profile credentials add an authority and persistence contract absent from earlier coverage; seam=none.
test('idle sockets retain the shared unauthenticated timeout', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const idle = await connect(f.url);
    expect(await idle.closeCode()).toBe(4001);
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}, 8000);

// Protects owner-bound durable audio settings and code restoration on a fresh server origin.
test('host and guest audio preferences save before ack and restore through permanent codes', async () => {
  const dir = temporary();
  const f = fixture(dir);
  let restored: ReturnType<typeof fixture> | undefined;
  try {
    const host = await register(f, 'host');
    const guest = await register(f);
    const preferences = { effects: false, music: true, effectsVolume: 0.4, musicVolume: 0.6 };
    const hostPreferences = { effects: true, music: false, effectsVolume: 0.7, musicVolume: 0.2 };
    host.c.send({ type: 'update_audio_preferences', seq: 2, preferences: hostPreferences });
    expect((await host.c.next('ack')).result).toBe('ok');
    guest.c.send({ type: 'update_audio_preferences', seq: 2, preferences });
    expect((await guest.c.next('ack')).result).toBe('ok');
    const saved = new ProfileStore(path.join(dir, 'profiles.json'));
    expect(saved.getById(host.owner.profile.profileId)).toEqual({
      ...host.owner.profile,
      audioPreferences: hostPreferences,
    });
    expect(saved.getById(guest.owner.profile.profileId)).toEqual({
      ...guest.owner.profile,
      audioPreferences: preferences,
    });
    guest.c.send({ type: 'update_audio_preferences', seq: 2, preferences: hostPreferences });
    expect((await guest.c.next('ack')).result).toBe('ok');
    expect(f.profiles.getById(guest.owner.profile.profileId)?.audioPreferences).toEqual(
      preferences,
    );
    restored = fixture(dir, '-new-origin');
    const authenticated = await login(restored, guest.owner.profile);
    expect(authenticated.ok.profile.audioPreferences).toEqual(preferences);
    expect(authenticated.ok.profile.profileId).toBe(guest.owner.profile.profileId);
    authenticated.c.socket.close();
    host.c.socket.close();
    guest.c.socket.close();
  } finally {
    restored?.stop();
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audio preference updates require authentication and reject forged or invalid payloads', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const preferences = { effects: true, music: true, effectsVolume: 1, musicVolume: 0.6 };
    const bare = await connect(f.url);
    bare.send({ type: 'update_audio_preferences', seq: 1, preferences });
    expect(await bare.closeCode()).toBe(4001);
    const { c, owner } = await register(f);
    c.send({
      type: 'update_audio_preferences',
      seq: 2,
      preferences: { ...preferences, musicVolume: 2 },
    });
    c.send({ type: 'update_audio_preferences', seq: 3, profileId: 'forged', preferences });
    c.send({ type: 'ping', clientNow: 1 });
    await c.next('pong');
    expect(f.profiles.getById(owner.profile.profileId)).toEqual(owner.profile);
    c.send({ type: 'update_audio_preferences', seq: 4, preferences });
    expect((await c.next('ack')).seq).toBe(4);
    c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audio preference storage failure reports a failed ack and preserves the profile', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { c, owner } = await register(f);
    const file = path.join(dir, 'profiles.json');
    const before = readFileSync(file, 'utf8');
    rmSync(file);
    mkdirSync(file);
    writeFileSync(path.join(file, 'original'), before);
    c.send({
      type: 'update_audio_preferences',
      seq: 2,
      preferences: { effects: false, music: false, effectsVolume: 0, musicVolume: 0 },
    });
    const ack = await c.next('ack');
    expect(ack.result).toBe('invalid');
    expect(ack.message).toContain('недоступны');
    expect(f.profiles.getById(owner.profile.profileId)).toEqual(owner.profile);
    expect(readFileSync(path.join(file, 'original'), 'utf8')).toBe(before);
    c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Protects durable-save acknowledgements from inheriting an unrelated later command's success.
test('a failed older audio save never becomes successful after a later action', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { c, owner } = await register(f);
    const file = path.join(dir, 'profiles.json');
    const before = readFileSync(file, 'utf8');
    rmSync(file);
    mkdirSync(file);
    writeFileSync(path.join(file, 'original'), before);
    const update = {
      type: 'update_audio_preferences',
      seq: 2,
      preferences: { effects: false, music: false, effectsVolume: 0.2, musicVolume: 0.3 },
    };
    c.send(update);
    expect((await c.next('ack')).result).toBe('invalid');
    c.send(update);
    expect((await c.next('ack')).result).toBe('invalid');
    rmSync(file, { recursive: true });
    writeFileSync(file, before);
    c.send({ type: 'update_profile', seq: 3, nick: 'Later name', color: 'p-2' });
    expect((await c.next('ack')).result).toBe('ok');
    c.send(update);
    const replay = await c.next('ack');
    expect(replay.seq).toBe(2);
    expect(replay.result).toBe('invalid');
    expect(f.profiles.getById(owner.profile.profileId)?.audioPreferences).toBeUndefined();
    expect(
      new ProfileStore(file).getById(owner.profile.profileId)?.audioPreferences,
    ).toBeUndefined();
    c.send({ ...update, seq: 4 });
    expect((await c.next('ack')).result).toBe('ok');
    c.send({ ...update, seq: 4 });
    expect((await c.next('ack')).result).toBe('ok');
    expect(new ProfileStore(file).getById(owner.profile.profileId)?.audioPreferences).toEqual(
      update.preferences,
    );
    c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Protects audio acknowledgements from reusing a profile edit result at the same sequence.
// fails_when: an audio update reports success without saving, or a fresh audio update cannot replay.
// no_claim: native local WebSocket and isolated profile storage with fake game dependencies.
// why_new=A profile edit at the current sequence can return success for a different command; seam=none.
test('audio preferences cannot reuse a profile edit acknowledgment at the same sequence', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const { c, owner } = await register(f);
    const file = path.join(dir, 'profiles.json');
    const profileId = owner.profile.profileId;
    const preferences = { effects: false, music: true, effectsVolume: 0.4, musicVolume: 0.6 };
    c.send({ type: 'update_profile', seq: 2, nick: 'Edited', color: 'p-2' });
    expect(await c.next('ack')).toMatchObject({ seq: 2, result: 'ok' });
    c.send({ type: 'update_audio_preferences', seq: 2, preferences });
    expect(await c.next('ack')).toMatchObject({ seq: 2, result: 'invalid' });
    expect(new ProfileStore(file).getById(profileId)).toEqual({
      ...owner.profile,
      nick: 'Edited',
      color: 'p-2',
    });
    const update = { type: 'update_audio_preferences', seq: 3, preferences };
    c.send(update);
    expect(await c.next('ack')).toMatchObject({ seq: 3, result: 'ok' });
    expect(new ProfileStore(file).getById(profileId)?.audioPreferences).toEqual(preferences);
    c.send(update);
    expect(await c.next('ack')).toMatchObject({ seq: 3, result: 'ok' });
    c.socket.close();
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
