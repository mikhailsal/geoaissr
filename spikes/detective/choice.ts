import { ABSTAIN_RU, isAbstain } from './catalog.ts';

/**
 * Brain-written choice questions (protocol "choice", plan Open Question 1, option B). The brain
 * writes a question and 2–6 options; the eyes answer with one option number, `none_of_these`,
 * `not_visible` or `unreadable`. The eyes cannot bring in a concept that is not on the table.
 */

export const NONE_OF_THESE = 'none_of_these';
export const NONE_OF_THESE_RU = 'ни один вариант не подходит';

export interface ChoiceQuestion {
  kind: 'choice';
  question: string;
  options: string[];
}

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The eyes' value in canonical form: an option number ("1".."k"), `none_of_these` or an
 * abstention. An exact option text is accepted and turned into its number. Null when invalid.
 */
export function normalizeChoiceValue(q: ChoiceQuestion, value: string): string | null {
  const v = value.trim();
  if (isAbstain(v) || v === NONE_OF_THESE) return v;
  const numbered = /^(\d{1,2})[).]?$/.exec(v);
  if (numbered) {
    const k = Number(numbered[1]);
    return k >= 1 && k <= q.options.length ? String(k) : null;
  }
  const idx = q.options.findIndex((o) => norm(o) === norm(v));
  return idx >= 0 ? String(idx + 1) : null;
}

/** The text the brain reads for a canonical value. */
export function choiceLabelRu(q: ChoiceQuestion, value: string): string {
  if (isAbstain(value)) return ABSTAIN_RU[value];
  if (value === NONE_OF_THESE) return NONE_OF_THESE_RU;
  return q.options[Number(value) - 1] ?? value;
}

/** The first option that repeats an earlier one (case and spaces ignored), or null. */
export function duplicateOption(q: ChoiceQuestion): string | null {
  const seen = new Set<string>();
  for (const option of q.options) {
    const key = norm(option);
    if (seen.has(key)) return option;
    seen.add(key);
  }
  return null;
}

/** Options that repeat an answer the eyes always have: «не видно», «неразборчиво», «другое». */
const BUILTIN_ANYWHERE = [
  'не видно',
  'не видны',
  'не виден',
  'не разобрать',
  'неразборчив',
  'не понять',
  'не знаю',
];
const BUILTIN_PREFIXES = ['ничего из', 'ни один', 'ни одно', 'другое', 'другая', 'другой', 'иное'];

/** The first option that duplicates a built-in answer of the eyes, or null. */
export function builtinOption(q: ChoiceQuestion): string | null {
  return (
    q.options.find((o) => {
      const t = norm(o);
      return (
        BUILTIN_ANYWHERE.some((p) => t.includes(p)) || BUILTIN_PREFIXES.some((p) => t.startsWith(p))
      );
    }) ?? null
  );
}
