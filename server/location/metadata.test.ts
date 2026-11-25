import { expect, test } from 'bun:test';
import { createMetadataClient } from './metadata.ts';
import { panoAt } from './test-helpers.ts';

// Value: protects=the counter the sampling tool reads counts every request sent, the second try of a lookup included; fails_when=a lookup Google answered at the second try counts once and the tool reports less traffic than it sent;
// why_new=the counter stood before the retry, and the metadata client had no test of its own; seam=none; no_claim=real Google answers (fetch double)
test('a lookup that is sent twice counts as two requests', async () => {
  let sent = 0;
  const client = createMetadataClient({
    serverKey: 'test-key',
    fetchImpl: () => {
      sent += 1;
      const body = JSON.stringify(panoAt({ lat: 1, lng: 2 }));
      return Promise.resolve(new Response(body, { status: sent === 1 ? 500 : 200 }));
    },
  });
  expect(await client.find({ lat: 1, lng: 2 }, 100)).toMatchObject({ lat: 1, lng: 2 });
  expect(await client.find({ lat: 1, lng: 2 }, 100)).toMatchObject({ lat: 1, lng: 2 });
  expect(client.lookupCount()).toBe(3);
});
