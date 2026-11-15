import { expect, test } from 'bun:test';
import { ServerClock } from './clock.ts';

test('ServerClock picks offset from lowest-RTT sample among last 5 pings', () => {
  const clock = new ServerClock();
  clock.seed(1_000, 1_000);

  clock.recordPong(2_500, 2_000, 2_200);
  clock.recordPong(3_550, 3_000, 3_040);
  clock.recordPong(4_400, 4_000, 4_300);

  expect(clock.getLastRttMs()).toBe(300);
  expect(clock.getOffsetMs()).toBe(530);
  expect(clock.remainingMs(10_530, 5_000)).toBe(5_000);
  expect(clock.remainingMs(4_000, 5_000)).toBe(0);
});

test('ServerClock ignores isolated huge spike but accepts two corroborating samples', () => {
  const clock = new ServerClock();
  clock.recordPong(10_050, 10_000, 10_100);
  clock.recordPong(11_050, 11_000, 11_100);
  expect(clock.getOffsetMs()).toBe(0);

  clock.recordPong(60_050, 12_000, 12_100);
  expect(clock.getOffsetMs()).toBe(0);

  clock.recordPong(61_050, 13_000, 13_100);
  expect(clock.getOffsetMs()).toBe(48_000);
});
