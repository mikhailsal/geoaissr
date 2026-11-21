import type { EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import type { SettledItem } from './broker.ts';
import { placeNamesIn } from './guard.ts';

/** Scores of one answered question against the human labels of the spot. */

export interface ScoredItem {
  kind: 'feature' | 'text' | 'choice';
  feature: string | null;
  /** Choice: the brain's question; text: the transcription target. */
  question?: string;
  /** Choice only: the brain's options, numbered from 1. */
  options?: string[];
  status: SettledItem['status'];
  value: string | null;
  frame: number | null;
  /** Feature: the labelled value; text: the labelled sign texts joined. */
  label: string | null;
  /** True/false for an answered item; null for abstentions and missing answers. */
  agrees: boolean | null;
  /** Place names in a transcription that the labelled sign text does not contain. */
  inventedPlaces: string[];
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\?/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A transcription matches when it contains a labelled text (or the reverse) or shares a word. */
export function transcriptionMatches(answer: string, labels: readonly string[]): boolean {
  const a = normalizeText(answer);
  if (a.length < 2) return false;
  for (const raw of labels) {
    const l = normalizeText(raw);
    if (l.length < 2) continue;
    if (a.includes(l) || l.includes(a)) return true;
    const words = l.split(' ').filter((w) => w.length >= 3);
    if (words.some((w) => a.split(' ').includes(w))) return true;
  }
  return false;
}

export function scoreItem(sample: EvalSampleItem, item: SettledItem): ScoredItem {
  const answered = item.status === 'answered' && item.value !== null;
  if (item.question.kind === 'feature') {
    const label = sample.labels?.[item.question.feature] ?? 'not_visible';
    return {
      kind: 'feature',
      feature: item.question.feature,
      status: item.status,
      value: item.value,
      frame: item.frame,
      label,
      agrees: answered ? item.value === label : null,
      inventedPlaces: [],
    };
  }
  if (item.question.kind === 'choice') {
    // Brain-written choices have no labels; the eyes-answer judge scores them.
    return {
      kind: 'choice',
      feature: null,
      question: item.question.question,
      options: item.question.options,
      status: item.status,
      value: item.value,
      frame: item.frame,
      label: null,
      agrees: null,
      inventedPlaces: [],
    };
  }
  const texts = (sample.signText ?? []).map((s) => s.text);
  const labelPlaces = new Set(placeNamesIn(texts.join(' ')));
  const value = item.value ?? '';
  return {
    kind: 'text',
    feature: null,
    question: item.question.target,
    status: item.status,
    value: item.value,
    frame: item.frame,
    label: texts.length > 0 ? texts.join(' | ') : null,
    agrees: answered ? transcriptionMatches(value, texts) : null,
    inventedPlaces: answered ? placeNamesIn(value).filter((p) => !labelPlaces.has(p)) : [],
  };
}
