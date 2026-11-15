import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { contrastRatio, PARTICIPANT_COLORS } from '../../../shared/colors.ts';

function parseCssVars(cssText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of cssText.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const key = m[1];
    const val = m[2];
    if (key && val) out[key] = val.trim();
  }
  return out;
}

test('tokens.css text/surface color pairs satisfy WCAG AA contrast ratios', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'web/src/styles/tokens.css'), 'utf8');
  const vars = parseCssVars(css);
  const bg800 = vars['--asphalt-800'] ?? '';
  const bg900 = vars['--asphalt-900'] ?? '';
  const bg700 = vars['--asphalt-700'] ?? '';
  const paper = vars['--paper'] ?? '';
  const paperDim = vars['--paper-dim'] ?? '';
  const paint = vars['--paint'] ?? '';
  const paintInk = vars['--paint-ink'] ?? '';
  const signal = vars['--signal'] ?? '';
  const ok = vars['--ok'] ?? '';

  expect(contrastRatio(paper, bg800)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(paper, bg900)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(paper, bg700)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(paperDim, bg800)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(paperDim, bg900)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(paintInk, paint)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(signal, bg800)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(ok, bg800)).toBeGreaterThanOrEqual(4.5);
});

test('all 12 participant colors maintain >= 4.5:1 contrast with chosen avatar ink', () => {
  for (const c of PARTICIPANT_COLORS) {
    expect(contrastRatio(c.hex, c.inkHex)).toBeGreaterThanOrEqual(4.5);
  }
});
