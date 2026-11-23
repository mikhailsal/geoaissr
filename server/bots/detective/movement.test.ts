import { expect, test } from 'bun:test';
import { ASK, REPORT, answerCurrent, briefed, makeSession } from './test-helpers.ts';

const DRIVE_ASK = {
  ...ASK,
  requests: [
    { kind: 'drive', heading: 0, distance_m: 600, topic: 'указатели и таблички с названиями' },
    { kind: 'text', target: 'самый крупный указатель' },
  ],
};

test('a fourth paid action before the report is refused and costs no turn', async () => {
  const { session, log } = makeSession({ moveLimit: 8 });
  await session.call('eyes', 'observe', {});
  for (const heading of [10, 100]) {
    const look = await session.call('eyes', 'look', { heading, fov: 30 });
    expect(look.isError).toBeUndefined();
  }
  const moved = await session.call('eyes', 'move', { heading: 0, distance_m: 500 });
  expect(moved.isError).toBeUndefined();
  expect(moved.text).toContain('Кадр 7.');
  expect(moved.text).toContain('пройдено около 500 м');
  const early = await session.call('eyes', 'look', { heading: 280, fov: 30 });
  expect(early.isError).toBe(true);
  expect(early.text).toContain('До отчёта можно сделать не больше 3 платных ходов');
  expect(session.state.turnsUsed).toBe(3);
  await session.call('eyes', 'report', REPORT);
  const later = await session.call('eyes', 'look', { heading: 280, fov: 30 });
  expect(later.isError).toBeUndefined();
  expect(log.turns).toEqual([1, 2, 3, 4]);
  // Frames taken before the first ask belong to the report step; a frame after a move says how
  // far from the start it was taken.
  expect(log.frames.slice(4).map((f) => [f.turn, f.n, f.action, f.params?.fromStartM])).toEqual([
    [0, 5, 'look', undefined],
    [0, 6, 'look', undefined],
    [0, 7, 'move', 500],
    [0, 8, 'look', 500],
  ]);
  expect(log.frames[6]?.params?.distanceM).toBe(500);
});

test('paid actions stop at the slot limit, and a look needs the start frames', async () => {
  const { session } = makeSession({ moveLimit: 1 });
  expect((await session.call('eyes', 'look', { heading: 0 })).text).toContain(
    'Сначала вызови observe',
  );
  await session.call('eyes', 'observe', {});
  expect((await session.call('eyes', 'look', { heading: 0 })).isError).toBeUndefined();
  await session.call('eyes', 'report', REPORT);
  const over = await session.call('eyes', 'look', { heading: 90 });
  expect(over.isError).toBe(true);
  expect(over.text).toContain('Платные ходы кончились');
  expect(session.state.turnsUsed).toBe(1);
});

test('the eyes drive on request; the answer cites a frame marked with the distance from the start', async () => {
  // No test override of the ask timeout: a drive gets the product's longer limit.
  const { session, log } = await briefed({ askTimeoutMs: undefined });
  const asked = session.call('brain', 'ask', DRIVE_ASK);
  const request = await session.call('eyes', 'next_request', {});
  expect(request.text).toContain('Проедь по дороге: move(heading=0, distance_m=600)');
  expect(request.text).toContain('на запрос до 45 с');
  // Describing the new place without driving there is refused.
  const lazy = await answerCurrent(session, [
    { n: 1, value: 'указателей не видно', confidence: 'sure', frame: 1 },
    { n: 2, value: 'not_visible' },
  ]);
  expect(lazy.isError).toBe(true);
  expect(lazy.text).toContain('сначала вызови move');
  // «Не видно» about a place nobody drove to is refused too: only no_road answers without a move.
  const blind = await answerCurrent(session, [
    { n: 1, value: 'not_visible' },
    { n: 2, value: 'not_visible' },
  ]);
  expect(blind.isError).toBe(true);
  expect(blind.text).toContain('сначала вызови move');
  const moved = await session.call('eyes', 'move', { heading: 0, distance_m: 600 });
  expect(moved.isError).toBeUndefined();
  expect(moved.text).toContain('Кадр 5.');
  // After the drive the answer must come from the new place, not from a frame taken before it.
  const stale = await answerCurrent(session, [
    { n: 1, value: 'синий указатель', confidence: 'sure', frame: 2 },
    { n: 2, value: 'not_visible' },
  ]);
  expect(stale.isError).toBe(true);
  expect(stale.text).toContain('кадр 2 снят до проезда; ответь по кадру 5');
  const ack = await answerCurrent(session, [
    { n: 1, value: 'синий указатель на перекрёстке', confidence: 'sure', frame: 5 },
    { n: 2, value: 'CENTRUM 3', confidence: 'sure', frame: 5 },
  ]);
  expect(ack.isError).toBeUndefined();
  const reply = await asked;
  expect(reply.text).toContain(
    '1. Проезд 600 м на 0°, «указатели и таблички с названиями»: синий указатель на перекрёстке (уверенно, кадр 5, 600 м к С от старта)',
  );
  expect(reply.text).toContain('2. Текст «самый крупный указатель»: "CENTRUM 3"');
  expect(reply.text).toContain('Платных ходов у напарника: 3.');
  // The frame of the drive belongs to the exchange that asked for it.
  expect(log.frames.at(-1)).toMatchObject({ turn: 1, n: 5, action: 'move' });
  const settled = log.steps.filter((s) => s.turn === 1).at(-1)?.patch.requests;
  expect(settled?.[0]).toMatchObject({
    kind: 'drive',
    heading: 0,
    distanceM: 600,
    status: 'answered',
    frame: 5,
  });
});

test('a drive that found no road is answered with no_road', async () => {
  const { session } = await briefed();
  const asked = session.call('brain', 'ask', DRIVE_ASK);
  const ack = await answerCurrent(session, [
    { n: 1, value: 'no_road' },
    { n: 2, value: 'not_visible' },
  ]);
  expect(ack.isError).toBeUndefined();
  expect((await asked).text).toContain('проехать не удалось');
});

test('a drive is refused when movement is off, when two are asked or when no paid turns are left', async () => {
  const off = await briefed({ moveEnabled: false });
  const refused = await off.session.call('brain', 'ask', DRIVE_ASK);
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain('движение по дороге выключено');
  expect((await off.session.call('eyes', 'move', { heading: 0 })).text).toContain(
    'Движение выключено',
  );
  const two = await briefed();
  const drive = DRIVE_ASK.requests[0];
  const twice = await two.session.call('brain', 'ask', { ...ASK, requests: [drive, drive] });
  expect(twice.text).toContain('только один проезд');
  const spent = await briefed({ moveLimit: 0 });
  const none = await spent.session.call('brain', 'ask', DRIVE_ASK);
  expect(none.text).toContain('не осталось платных ходов');
  for (const t of [off, two, spent]) expect(t.session.state.asks).toBe(0);
});
