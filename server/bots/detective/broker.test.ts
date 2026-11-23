import { expect, test } from 'bun:test';
import { BrokerBusyError, createBroker, type Question } from './broker.ts';

const Q: Question[] = [
  { kind: 'describe', topic: 'дорожная разметка' },
  { kind: 'text', target: 'вывеска' },
];

function idSeq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `r${n}`;
  };
}

test('an answer settles the request once and a second answer is dropped as late', async () => {
  const broker = createBroker({ newId: idSeq() });
  const asked = broker.ask(Q, 5000);
  const req = await broker.nextRequest(1000);
  expect(req?.id).toBe('r1');
  expect(broker.answer('r1', [{ n: 1, value: 'белая осевая', frame: 2, confidence: 'sure' }])).toBe(
    'settled',
  );
  const outcome = await asked;
  expect(outcome.settledBy).toBe('answer');
  expect(outcome.items.map((i) => i.status)).toEqual(['answered', 'timeout']);
  expect(outcome.items[0]?.frame).toBe(2);
  expect(outcome.items[0]?.confidence).toBe('sure');
  expect(broker.answer('r1', [{ n: 2, value: 'X', frame: 1 }])).toBe('late');
  expect(broker.answer('nope', [])).toBe('unknown');
});

test('abstentions are reported as abstained, not answered', async () => {
  const broker = createBroker({ newId: idSeq() });
  const drive: Question = { kind: 'drive', heading: 0, distance_m: 400, topic: 'указатели' };
  const asked = broker.ask([...Q, drive], 5000);
  broker.answer('r1', [
    { n: 1, value: 'not_visible', frame: null },
    { n: 2, value: 'unreadable', frame: null },
    { n: 3, value: 'no_road', frame: null },
  ]);
  expect((await asked).items.map((i) => i.status)).toEqual(['abstained', 'abstained', 'abstained']);
});

test('an unanswered request times out and its late answer is dropped', async () => {
  const broker = createBroker({ newId: idSeq() });
  const outcome = await broker.ask(Q, 20);
  expect(outcome.settledBy).toBe('timeout');
  expect(outcome.items.every((i) => i.status === 'timeout')).toBe(true);
  expect(broker.answer('r1', [{ n: 1, value: 'left', frame: 1 }])).toBe('late');
});

test('only one request may be outstanding', async () => {
  const broker = createBroker({ newId: idSeq() });
  const first = broker.ask(Q, 5000);
  let busy: unknown = null;
  try {
    await broker.ask(Q, 5000);
  } catch (err) {
    busy = err;
  }
  expect(busy).toBeInstanceOf(BrokerBusyError);
  broker.close();
  expect((await first).settledBy).toBe('closed');
});

test('eyes going down settles the outstanding request and every later one', async () => {
  const broker = createBroker({ newId: idSeq() });
  const pending = broker.ask(Q, 5000);
  broker.eyesDown();
  expect((await pending).items.every((i) => i.status === 'eyes_down')).toBe(true);
  const later = await broker.ask(Q, 5000);
  expect(later.settledBy).toBe('eyes_down');
});

test('next_request waits for an ask, redelivers it, and wakes with null on close', async () => {
  const broker = createBroker({ newId: idSeq() });
  const waiting = broker.nextRequest(5000);
  void broker.ask(Q, 5000);
  expect((await waiting)?.id).toBe('r1');
  expect((await broker.nextRequest(10))?.id).toBe('r1');
  expect(broker.current()?.id).toBe('r1');
  broker.answer('r1', []);
  expect(broker.current()).toBeNull();
  const idle = broker.nextRequest(5000);
  broker.close();
  expect(await idle).toBeNull();
  expect(await broker.nextRequest(5000)).toBeNull();
});

test('a closed broker answers a new ask at once with timeouts', async () => {
  const broker = createBroker({ newId: idSeq() });
  broker.close();
  const outcome = await broker.ask(Q, 5000);
  expect(outcome.settledBy).toBe('closed');
  expect(broker.hasPending()).toBe(false);
});

// Value: protects=a wait sized for the old round deadline is cut when the round gets shorter; fails_when=the brain stays blocked in ask past the new deadline; why_new=the timer was set once per request; seam=none; no_claim=who decides the new deadline (the engine).
test('a shorter round cuts the outstanding wait, and a longer one never extends it', async () => {
  const broker = createBroker({ newId: idSeq() });
  const started = Date.now();
  const asked = broker.ask(Q, 60_000);
  broker.capWait(20);
  const outcome = await asked;
  expect(outcome.settledBy).toBe('timeout');
  expect(Date.now() - started).toBeLessThan(5000);
  // No time left at all: the request settles at once.
  const second = broker.ask(Q, 60_000);
  broker.capWait(0);
  expect((await second).settledBy).toBe('timeout');
  expect(broker.hasPending()).toBe(false);
  // A cap longer than the request's own limit changes nothing, and so does one with no request.
  const short = broker.ask(Q, 20);
  broker.capWait(60_000);
  expect((await short).settledBy).toBe('timeout');
  expect(Date.now() - started).toBeLessThan(5000);
  broker.capWait(10);
});

test('a handed-out request says how long the brain still waits for it', async () => {
  const clock = { now: 1000 };
  const broker = createBroker({ newId: idSeq(), now: () => clock.now });
  const asked = broker.ask(Q, 30_000);
  expect((await broker.nextRequest(10))?.leftMs).toBe(30_000);
  clock.now = 9000;
  expect(broker.current()?.leftMs).toBe(22_000);
  broker.capWait(4000);
  expect(broker.current()?.leftMs).toBe(4000);
  broker.close();
  await asked;
});
