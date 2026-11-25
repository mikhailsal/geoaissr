import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultAvatar } from '../../shared/avatar.ts';
import { formatProfileToken } from '../../shared/profile-token.ts';
import type { ServerMessage } from '../../shared/protocol.ts';
import { createDefaultSettings, type StoredProfile } from '../../shared/storage-schemas.ts';
import { createRoomShell } from '../engine/shell.ts';
import { createInitialRoomState } from '../engine/types.ts';
import { createThumbStore } from '../http/thumbs.ts';
import { createServerLogger } from '../log.ts';
import { ProfileStore } from '../storage/profiles.ts';
import { createSettingsWriter } from '../cli/settings-writer.ts';
import { loadSettings } from '../storage/settings.ts';
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
  const settingsFile = path.join(dir, 'settings.json');
  const initial = createInitialRoomState({
    matchId: 'profile-test',
    fakeMode: true,
    settings: {
      ...createDefaultSettings(),
      rounds: 1,
      roundDurationSec: 60,
      aiWaitWindowSec: 0,
    },
    quotaSummary: buildQuotaSummaryForRoom(quota, { rounds: 1 }),
    tunnel: { mode: 'local', status: 'local', inviteUrl: null, changedSinceStart: false },
    availableHarnesses: [],
  });
  const shell = createRoomShell(initial, {
    onStateChange: () => {
      coordinator.broadcastState();
    },
    saveSettings: createSettingsWriter(settingsFile, loadSettings(settingsFile).status),
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
      unexpected?: ServerMessage['type'],
    ): Promise<Extract<ServerMessage, { type: T }>> => {
      const deadline = Date.now() + 2000;
      for (;;) {
        const value = queue.shift();
        if (value && value.type === unexpected) throw new Error('unexpected ' + unexpected);
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
    async function expectHostRequired(request: Record<string, unknown>) {
      const ownerEntry = await connect(f.url);
      ownerEntry.send({ ...request, expectedRole: 'host' });
      expect((await ownerEntry.next('profile_login_error')).code).toBe('host_required');
      expect(await ownerEntry.closeCode()).toBe(4003);
    }
    const guestLogin = { type: 'profile_login', profileToken: guest.owner.profile.profileToken };
    await expectHostRequired(guestLogin);
    await expectHostRequired({
      type: 'hello',
      token: 'host',
      playerId: guest.owner.playerId,
      playerSecret: guest.owner.playerSecret,
    });
    guest.c.send({ type: 'avatar_gesture', seq: 2, gesture: 'wave' });
    expect((await guest.c.next('ack', 'hello_error')).result).toBe('ok');
    f.stop();
    f = fixture(dir, '-fresh');
    await expectHostRequired(guestLogin);
    expect(f.shell.getState().playerOrder).toHaveLength(0);
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
    const extra = await f.profiles.create({ nick: 'Same', color: 'p-1', role: 'guest' });
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
    const unrelated = await f.profiles.create({ nick: 'Other', color: 'p-2', role: 'guest' });
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

test('a customized avatar reaches peers, survives legacy profile edits and restores after restart', async () => {
  const dir = temporary();
  let f = fixture(dir);
  try {
    const peer = await register(f, 'host');
    const player = await register(f);
    const avatar = { ...defaultAvatar(false), gear: 'beanie', color: '#abcdef' };
    player.c.send({ type: 'update_profile', seq: 2, nick: 'Orbit', color: 'p-3', avatar });
    expect((await player.c.next('ack')).result).toBe('ok');
    const view = f.shell.getView(peer.owner.playerId);
    expect(view.players.find((p) => p.id === player.owner.playerId)?.avatar).toEqual(avatar);
    const preferences = { effects: false, music: true, effectsVolume: 0.4, musicVolume: 0.6 };
    player.c.send({ type: 'update_audio_preferences', seq: 3, preferences });
    expect((await player.c.next('ack')).result).toBe('ok');
    player.c.send({ type: 'update_profile', seq: 4, nick: 'Nova', color: 'p-3' });
    expect((await player.c.next('ack')).result).toBe('ok');
    f.stop();
    f = fixture(dir);
    const restored = await login(f, player.owner.profile);
    expect(restored.ok.profile.avatar).toEqual(avatar);
    expect(restored.ok.profile.audioPreferences).toEqual(preferences);
    expect((await restored.c.next('state')).view.players[0]?.avatar).toEqual(avatar);
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guest spin reaches a peer once and only the host can edit or animate a bot', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const host = await register(f, 'host');
    const guest = await register(f);
    host.c.send({ type: 'add_bot', seq: 2 });
    expect((await host.c.next('ack')).result).toBe('ok');
    const bot = f.shell.getView(guest.owner.playerId).bots[0];
    if (!bot) throw new Error('missing bot');
    const avatar = { ...defaultAvatar(true), outfit: 'hoodie' };
    for (const [actor, result] of [
      [guest, 'forbidden'],
      [host, 'ok'],
    ] as const) {
      actor.c.send({ type: 'update_bot', seq: 3, botId: bot.id, patch: { avatar } });
      expect((await actor.c.next('ack')).result).toBe(result);
      actor.c.send({ type: 'avatar_gesture', seq: 4, botId: bot.id, gesture: 'wave' });
      expect((await actor.c.next('ack')).result).toBe(result);
    }
    expect(f.shell.getView(guest.owner.playerId).bots[0]?.avatar).toEqual(avatar);
    expect(await guest.c.next('avatar_gesture')).toMatchObject({
      participantId: bot.id,
      gesture: 'wave',
    });
    const spin = { type: 'avatar_gesture', seq: 5, gesture: 'spin' };
    guest.c.send(spin);
    expect(await host.c.next('avatar_gesture')).toMatchObject({
      participantId: guest.owner.playerId,
      gesture: 'spin',
    });
    expect((await guest.c.next('ack')).result).toBe('ok');
    guest.c.send(spin);
    expect((await guest.c.next('ack')).result).toBe('ok');
    expect(f.shell.getState().players[guest.owner.playerId]).not.toHaveProperty('gesture');
    f.shell.getState().phase = 'FINAL';
    guest.c.send({ ...spin, seq: 6 });
    expect((await guest.c.next('ack')).result).toBe('invalid');
    host.c.send({ type: 'ping', clientNow: 0 });
    expect((await host.c.next('pong', 'avatar_gesture')).clientNow).toBe(0);
    expect(loadSettings(path.join(dir, 'settings.json')).value.bots[0]?.avatar).toEqual(avatar);
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// A successful wardrobe acknowledgement promises an atomic settings write and a published look.
test('bot wardrobe rejects failed and newer-version writes without publishing the draft', async () => {
  for (const failure of ['unwritable', 'newer_version'] as const) {
    const dir = temporary();
    const file = path.join(dir, 'settings.json');
    if (failure === 'newer_version') writeFileSync(file, '{"version":999}');
    const f = fixture(dir);
    try {
      const host = await register(f, 'host');
      const guest = await register(f);
      host.c.send({ type: 'add_bot', seq: 2 });
      expect((await host.c.next('ack')).result).toBe('ok');
      const before = f.shell.getView(guest.owner.playerId).bots[0];
      if (!before) throw new Error('missing bot');
      const original = readFileSync(file, 'utf8');
      if (failure === 'unwritable') {
        rmSync(file);
        mkdirSync(file);
      }
      const avatar = { ...defaultAvatar(true), outfit: 'hoodie' };
      const edit = { type: 'update_bot', seq: 3, botId: before.id, patch: { avatar } };
      host.c.send(edit);
      host.c.send(edit);
      expect((await host.c.next('ack')).result).toBe('invalid');
      expect((await host.c.next('ack')).result).toBe('invalid');
      expect(f.shell.getView(guest.owner.playerId).bots[0]).toEqual(before);
      if (failure === 'newer_version') {
        expect(readFileSync(file, 'utf8')).toBe(original);
        continue;
      }
      rmSync(file, { recursive: true });
      writeFileSync(file, original);
      host.c.send({ type: 'update_lobby', seq: 4, patch: { rounds: 3 } });
      host.c.send(edit);
      expect((await host.c.next('ack')).result).toBe('ok');
      expect((await host.c.next('ack')).result).toBe('invalid');
      host.c.send({ ...edit, seq: 5 });
      host.c.send({ type: 'update_bot', seq: 6, botId: before.id, patch: { name: 'Пилот' } });
      expect(await host.c.next('ack')).toMatchObject({ seq: 5, result: 'ok' });
      expect(loadSettings(file).value.bots[0]?.avatar).toEqual(avatar);
      expect(await host.c.next('ack')).toMatchObject({ seq: 6, result: 'ok' });
      expect(loadSettings(file).value).toMatchObject({
        rounds: 3,
        bots: [{ name: 'Пилот', avatar }],
      });
      expect(f.shell.getView(guest.owner.playerId).bots[0]?.avatar).toEqual(avatar);
    } finally {
      f.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// Value: protects=shared angles and per-lineup cleanup; fails_when=players diverge or removed angles replay; why_new=one sender misses both; seam=none; no_claim=local sockets do not model tunnel latency.
test('a guest can drag a lobby participant, release immediately, and then boost a spin', async () => {
  const dir = temporary();
  const f = fixture(dir);
  try {
    const host = await register(f, 'host');
    const guest = await register(f);
    const participantId = host.owner.playerId;
    for (const [i, yaw] of [0.52, -2.42].entries()) {
      guest.c.send({ type: 'avatar_turn', seq: i + 2, participantId, yaw });
      expect(await host.c.next('avatar_turn')).toMatchObject({ participantId, yaw });
      expect(await guest.c.next('avatar_turn')).toMatchObject({ participantId, yaw });
      expect((await guest.c.next('ack')).result).toBe('ok');
    }
    const late = await register(f);
    expect(await late.c.next('avatar_turn')).toMatchObject({ participantId, yaw: -2.42 });
    host.c.send({ type: 'avatar_turn', seq: 2, participantId, yaw: 1 });
    late.c.send({ type: 'avatar_turn', seq: 2, participantId, yaw: -1 });
    const streams = await Promise.all(
      [host, guest, late].map(async ({ c }) => [
        (await c.next('avatar_turn')).yaw,
        (await c.next('avatar_turn')).yaw,
      ]),
    );
    expect(streams[0]?.toSorted()).toEqual([-1, 1]);
    expect(streams[1]).toEqual(streams[0]);
    expect(streams[2]).toEqual(streams[0]);
    host.c.send({ type: 'ping', clientNow: 9 });
    await host.c.next('pong');
    for (const seq of [4, 5]) {
      guest.c.send({ type: 'avatar_spin', seq, participantId });
      expect(await host.c.next('avatar_gesture')).toMatchObject({ participantId, gesture: 'spin' });
      expect((await guest.c.next('ack')).result).toBe('ok');
    }
    guest.c.send({ type: 'avatar_turn', seq: 6, participantId: 'missing', yaw: 0 });
    expect((await guest.c.next('ack')).result).toBe('invalid');
    host.c.send({ type: 'add_bot', seq: 3 });
    expect((await host.c.next('ack')).result).toBe('ok');
    const botId = f.shell.getState().settings.bots[0]?.id;
    if (!botId) throw new Error('Missing test bot');
    guest.c.send({ type: 'avatar_turn', seq: 7, participantId: botId, yaw: 2 });
    expect((await guest.c.next('ack')).result).toBe('ok');
    host.c.send({ type: 'remove_bot', botId, seq: 4 });
    expect((await host.c.next('ack')).result).toBe('ok');
    const afterRemoval = await register(f);
    expect((await afterRemoval.c.next('avatar_turn')).participantId).toBe(participantId);
    afterRemoval.c.send({ type: 'ping', clientNow: 10 });
    await afterRemoval.c.next('pong', 'avatar_turn');
    host.c.send({ type: 'start_match', seq: 5 });
    expect((await host.c.next('ack')).result).toBe('ok');
    guest.c.send({ type: 'avatar_turn', seq: 8, participantId, yaw: 0 });
    expect((await guest.c.next('ack')).result).toBe('invalid');
    for (const [seq, type] of [
      [6, 'end_match'],
      [7, 'play_again'],
    ] as const) {
      host.c.send({ type, seq });
      expect((await host.c.next('ack')).result).toBe('ok');
    }
    const nextLobby = await register(f);
    nextLobby.c.send({ type: 'ping', clientNow: 11 });
    await nextLobby.c.next('pong', 'avatar_turn');
  } finally {
    f.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

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
