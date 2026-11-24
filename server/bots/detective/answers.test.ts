import { expect, test } from 'bun:test';
import type { BotImageService } from '../../images/bot-image-service.ts';
import {
  ASK,
  answerCurrent,
  briefed,
  manualGate,
  stubImageService,
  until,
} from './test-helpers.ts';

// Value: protects=the brain never reads «не ответил вовремя» for a request the eyes did answer, and never loses an answer to a repeated number; fails_when=an answer with a repeated or a missing number is accepted; why_new=the server took the first item per number and showed the rest as timed out; seam=none; no_claim=the wording a model picks after the correction.
test('an answer needs exactly one item for every request of the exchange', async () => {
  const { session, log } = await briefed();
  const asked = session.call('brain', 'ask', ASK);
  const twice = await answerCurrent(session, [
    { n: 1, value: 'жёлтые номера', confidence: 'sure', frame: 1 },
    { n: 1, value: 'белые номера', confidence: 'unsure', frame: 2 },
  ]);
  expect(twice.isError).toBe(true);
  expect(twice.text).toContain('просьба 1: на неё в answers несколько ответов');
  expect(twice.text).toContain('просьба 2: ответа нет');
  // The refused answer settled nothing: the request is still the eyes' to answer.
  expect(session.state.broker.hasPending()).toBe(true);
  expect(log.corrections.at(-1)).toMatchObject({ role: 'eyes', tool: 'answer' });
  const ack = await answerCurrent(session, [
    { n: 1, value: 'жёлтые номера', confidence: 'sure', frame: 1 },
    { n: 2, value: 'not_visible' },
  ]);
  expect(ack.isError).toBeUndefined();
  const reply = await asked;
  expect(reply.text).toContain('жёлтые номера');
  expect(reply.text).not.toContain('белые номера');
});

// Value: protects=the journal shows a frame under the exchange that asked for it; fails_when=a slow frame is filed under the next exchange; why_new=the exchange number was read after the camera work; seam=none; no_claim=how long a real frame takes.
test('a frame that arrives after its exchange timed out stays in that exchange', async () => {
  const slow = manualGate();
  const images = stubImageService();
  const imageService: BotImageService = {
    ...images,
    getLookView: async (o) => {
      await slow.wait();
      return images.getLookView(o);
    },
  };
  const { session, log } = await briefed({ imageService, askTimeoutMs: 30 });
  const first = session.call('brain', 'ask', ASK);
  await session.call('eyes', 'next_request', {});
  const look = session.call('eyes', 'look', { heading: 10, fov: 30 });
  // The brain's wait runs out while the camera still works, and the brain asks again.
  await first;
  const second = session.call('brain', 'ask', {
    ...ASK,
    requests: [{ kind: 'describe', topic: 'столбы и провода' }],
  });
  await until(() => session.state.asks === 2);
  slow.open();
  expect((await look).isError).toBeUndefined();
  expect(log.frames.at(-1)).toMatchObject({ turn: 1, n: 5, action: 'look' });
  await second;
});
