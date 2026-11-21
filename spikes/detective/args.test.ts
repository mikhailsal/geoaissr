import { expect, test } from 'bun:test';
import { parseSpikeArgs } from './args.ts';

test('spike 2 flags: protocol, per-role models and the zoom rule', () => {
  const args = parseSpikeArgs([
    '--protocol',
    'choice',
    '--brain-model',
    'claude-sonnet-5-5',
    '--eyes-model',
    'claude-haiku-5-5',
    '--require-zoom',
    '--repeats',
    '3',
  ]);
  expect(args.protocol).toBe('choice');
  expect(args.brainModel).toBe('claude-sonnet-5-5');
  expect(args.eyesModel).toBe('claude-haiku-5-5');
  expect(args.requireZoom).toBe(true);
  expect(args.repeats).toBe(3);
  const defaults = parseSpikeArgs([]);
  expect(defaults.protocol).toBe('catalog');
  expect(defaults.brainModel).toBeNull();
  expect(defaults.requireZoom).toBe(false);
});

test('spike 3 flags: the report protocol and the brain effort', () => {
  const args = parseSpikeArgs(['--protocol', 'report', '--brain-effort', 'medium']);
  expect(args.protocol).toBe('report');
  expect(args.brainEffort).toBe('medium');
  expect(parseSpikeArgs([]).brainEffort).toBe('low');
  expect(() => parseSpikeArgs(['--brain-effort', 'max'])).toThrow('low or medium');
  expect(() => parseSpikeArgs(['--arm', 'labels', '--protocol', 'report'])).toThrow(
    'a report has no labels',
  );
});

test('bad spike 2 flags are refused', () => {
  expect(() => parseSpikeArgs(['--protocol', 'free'])).toThrow('catalog, choice or report');
  expect(() => parseSpikeArgs(['--brain-model', 'gpt-5'])).toThrow('--brain-model must match');
  expect(() => parseSpikeArgs(['--arm', 'labels', '--protocol', 'choice'])).toThrow(
    'choices have no labels',
  );
});
