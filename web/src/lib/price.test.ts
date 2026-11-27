import { expect, test } from 'bun:test';
import { formatApiPrice } from './price';

// Regression: QA ISSUE-001 (2026-11-16) - prices need three decimals, and a missing price is not zero.
test('the API price rounds to three decimals', () => {
  expect(formatApiPrice(0.00065)).toBe('~$0.001');
  expect(formatApiPrice(0.12345)).toBe('~$0.123');
  expect(formatApiPrice(12)).toBe('~$12.000');
});

test('a zero price is shown as zero and a missing price as unavailable', () => {
  expect(formatApiPrice(0)).toBe('~$0.000');
  expect(formatApiPrice(undefined)).toBe('н/д');
  expect(formatApiPrice(null)).toBe('н/д');
});
