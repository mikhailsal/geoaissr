import { readFileSync } from 'node:fs';
import { NONE_OF_THESE } from './choice.ts';
import { seededRandom } from './judge-extract.ts';
import type { ReportRoundFields } from './records.ts';
import { isCopiedTextLine } from './report-metrics.ts';
import type { ScoredItem } from './scoring.ts';

/**
 * Items for the eyes-answer judge (spike 2, bar 3): every choice and transcription question the
 * eyes answered or abstained on, grouped by spot, shuffled with a fixed seed and numbered.
 * Brain-written choices have no human labels, so this judge is their labelling pass.
 * Spike 3 adds what the eyes wrote in their own words: the lines of the scene report (kind
 * `report`, ask index 0) and the answers to `describe` requests.
 */

export interface EyesItem {
  spotId: string;
  executionId: string;
  /** 0 for a line of the scene report. */
  askIndex: number;
  kind: 'choice' | 'text' | 'describe' | 'report';
  /** The question, the transcription target or the topic; the section id for a report line. */
  question: string;
  options: string[];
  value: string;
  status: 'answered' | 'abstained';
  /** Spike 3: how sure the eyes said they were of an answer. */
  confidence?: 'sure' | 'unsure';
}

export interface EyesBatch {
  spotId: string;
  items: Array<{ n: number; text: string }>;
  key: Map<number, EyesItem>;
}

interface RoundRow {
  spotId: string;
  executionId: string;
  infraError: string | null;
  asks: Array<{ index: number; items: ScoredItem[] }>;
  reportRound?: Pick<ReportRoundFields, 'report'>;
}

function reportItems(r: RoundRow): EyesItem[] {
  return (r.reportRound?.report?.lines ?? []).map((line) => ({
    spotId: r.spotId,
    executionId: r.executionId,
    askIndex: 0,
    kind: 'report' as const,
    question: line.section,
    options: [],
    value: line.text,
    status: 'answered' as const,
  }));
}

function toEyesItem(r: RoundRow, askIndex: number, it: ScoredItem): EyesItem | null {
  if (it.kind === 'feature' || it.value === null) return null;
  if (it.status !== 'answered' && it.status !== 'abstained') return null;
  return {
    spotId: r.spotId,
    executionId: r.executionId,
    askIndex,
    kind: it.kind,
    question: it.question ?? '',
    options: it.options ?? [],
    value: it.value,
    status: it.status,
    ...(it.confidence ? { confidence: it.confidence } : {}),
  };
}

export function eyesItems(file: string): EyesItem[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RoundRow)
    .filter((r) => r.infraError === null)
    .flatMap((r) => [
      ...reportItems(r),
      ...r.asks.flatMap((a) =>
        a.items.map((it) => toEyesItem(r, a.index, it)).filter((x): x is EyesItem => x !== null),
      ),
    ]);
}

/** A statement in the eyes' own words that copies text from the scene (spike 3, bar 4). */
export function isCopiedText(item: EyesItem): boolean {
  if (item.kind === 'text') return item.status === 'answered';
  return item.kind === 'report' && isCopiedTextLine({ section: item.question, text: item.value });
}

function answerText(item: EyesItem): string {
  if (item.value === 'not_visible') return 'not visible';
  if (item.value === 'unreadable') return 'unreadable';
  if (item.kind === 'text') return `"${item.value}"`;
  if (item.value === NONE_OF_THESE) return 'none of the options fits';
  return `${item.value}) ${item.options[Number(item.value) - 1] ?? '?'}`;
}

/** One line the judge reads; it carries no role, round or timing field. */
export function renderEyesItem(item: EyesItem): string {
  if (item.kind === 'report') return `[scene note] ${item.value}`;
  if (item.kind === 'describe') {
    const answer = item.status === 'abstained' ? answerText(item) : item.value;
    return `[description] Request: «${item.question}». Answer: ${answer}`;
  }
  if (item.kind === 'text') {
    return `[transcription] Request: «${item.question}». Answer: ${answerText(item)}`;
  }
  const options = item.options.map((o, i) => `${i + 1}) ${o}`).join('; ');
  return `[choice] Question: «${item.question}». Options: ${options}. Answer: ${answerText(item)}`;
}

export function buildEyesBatches(items: readonly EyesItem[], seed: number): EyesBatch[] {
  const rand = seededRandom(seed);
  const bySpot = new Map<string, EyesItem[]>();
  for (const item of items) bySpot.set(item.spotId, [...(bySpot.get(item.spotId) ?? []), item]);
  return [...bySpot.keys()].sort().map((spotId) => {
    const list = [...(bySpot.get(spotId) ?? [])];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j] as EyesItem, list[i] as EyesItem];
    }
    const key = new Map<number, EyesItem>();
    const rendered = list.map((item, idx) => {
      key.set(idx + 1, item);
      return { n: idx + 1, text: renderEyesItem(item) };
    });
    return { spotId, items: rendered, key };
  });
}
