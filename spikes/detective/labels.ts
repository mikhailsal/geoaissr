import { randomBytes } from 'node:crypto';
import type { EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import type { AskOutcome, Question, SettledItem } from './broker.ts';
import { isAbstain } from './catalog.ts';

/**
 * Answers from the human labels instead of the eyes: the leak-comparison arm. The brain then
 * reads exactly the labelled features and sign texts, with no frame behind them.
 */

function labelValue(sample: EvalSampleItem, q: Question): string {
  if (q.kind === 'feature') return sample.labels?.[q.feature] ?? 'not_visible';
  // Brain-written choices have no labels; the labels arm runs only with the catalog protocol.
  if (q.kind === 'choice') return 'not_visible';
  const texts = (sample.signText ?? []).map((s) => s.text).filter((t) => t.trim().length > 0);
  return texts.length > 0 ? texts.join(' | ') : 'not_visible';
}

export function labelOutcome(sample: EvalSampleItem, questions: readonly Question[]): AskOutcome {
  const items: SettledItem[] = questions.map((question, idx) => {
    const value = labelValue(sample, question);
    return {
      n: idx + 1,
      question,
      status: isAbstain(value) ? 'abstained' : 'answered',
      value,
      frame: null,
    };
  });
  return { requestId: randomBytes(4).toString('hex'), items, cycleMs: 0, settledBy: 'answer' };
}
