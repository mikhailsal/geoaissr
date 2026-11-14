import { expect, test } from 'bun:test';
import { MapLoadReporter, type MapLoadKind } from './map-load-reports.ts';

/** A stand-in for the socket: it takes reports only while `open`, and logs every one it took. */
function makeSocket() {
  const socket = { open: false, delivered: [] as MapLoadKind[] };
  const reporter = new MapLoadReporter((kind) => {
    if (!socket.open) return false;
    socket.delivered.push(kind);
    return true;
  });
  return { reporter, socket };
}

test('a map load that could not be sent is not counted as sent', () => {
  const { reporter, socket } = makeSocket();

  reporter.report('guess');
  expect(socket.delivered).toEqual([]);

  socket.open = true;
  reporter.report('guess');
  expect(socket.delivered).toEqual(['guess']);
});

test('pending map loads are flushed once and delivered kinds are never repeated', () => {
  const { reporter, socket } = makeSocket();
  reporter.report('guess');

  socket.open = true;
  reporter.report('results');
  expect(socket.delivered).toEqual(['results']);

  reporter.flushPending();
  expect(socket.delivered).toEqual(['results', 'guess']);

  reporter.flushPending();
  reporter.report('guess');
  reporter.report('results');
  expect(socket.delivered).toEqual(['results', 'guess']);
});

test('flushing while the socket is still down keeps the reports pending', () => {
  const { reporter, socket } = makeSocket();
  reporter.report('results');
  reporter.flushPending();
  expect(socket.delivered).toEqual([]);

  socket.open = true;
  reporter.flushPending();
  expect(socket.delivered).toEqual(['results']);
});

test('reset forgets sent and pending reports for a new session', () => {
  const { reporter, socket } = makeSocket();
  reporter.report('guess');
  socket.open = true;
  reporter.report('results');

  reporter.reset();
  reporter.flushPending();
  expect(socket.delivered).toEqual(['results']);

  reporter.report('results');
  expect(socket.delivered).toEqual(['results', 'results']);
});
