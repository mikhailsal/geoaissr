import type { Question } from './broker.ts';
import { isAbstain } from './catalog.ts';
import type { DetectiveSession } from './session.ts';
import type { SessionState } from './state.ts';

/**
 * In-process stand-ins for the two roles, used by `--dry` and the tests. They drive the same
 * session handlers the real processes reach over HTTP, at no cost.
 */

function fakeValue(s: SessionState, q: Question): string {
  if (q.kind === 'feature') return s.opts.sample.labels?.[q.feature] ?? 'not_visible';
  if (q.kind === 'choice') return '1';
  if (q.kind === 'describe') return 'серый асфальт, разметки нет';
  return s.opts.sample.signText?.[0]?.text ?? 'not_visible';
}

/** Report protocol: one zoom, then the scene report, before the first request. */
async function fileFakeReport(session: DetectiveSession): Promise<void> {
  const sign = session.state.opts.sample.signText?.[0]?.text;
  await session.call('eyes', 'look', { heading: 90, fov: 30 });
  await session.call('eyes', 'report', {
    sections: {
      texts: sign ? [{ text: `«${sign}» — вывеска на здании`, frame: 5 }] : [],
      road: [{ text: 'серый асфальт, разметки нет', frame: 1 }],
      buildings: [{ text: 'двухэтажные дома со скатными крышами', frame: 2 }],
    },
  });
}

export async function runFakeEyes(session: DetectiveSession): Promise<void> {
  const s = session.state;
  const report = s.opts.protocol === 'report';
  await session.call('eyes', 'observe', {});
  if (report) await fileFakeReport(session);
  for (let i = 0; i < 20 && s.final === null; i += 1) {
    await session.call('eyes', 'next_request', {});
    const request = s.broker.current();
    if (!request) continue;
    const answers = request.questions.map((q, idx) => ({
      n: idx + 1,
      value: fakeValue(s, q),
      frame: 1,
      ...(report ? { confidence: 'sure' } : {}),
    }));
    const mustZoom =
      s.opts.requireZoom &&
      answers.some((a) => isAbstain(a.value)) &&
      s.turnsUsed < s.opts.moveLimit;
    if (s.turnsUsed === 0 || mustZoom) {
      await session.call('eyes', 'look', { heading: 90, fov: 30 });
    }
    await session.call('eyes', 'answer', { request_id: request.id, answers });
  }
}

const CATALOG_ASKS = [
  [
    { kind: 'feature', feature: 'driving_side' },
    { kind: 'feature', feature: 'script' },
  ],
  [
    { kind: 'text', target: 'самая крупная вывеска' },
    { kind: 'feature', feature: 'roof_type' },
  ],
];

const CHOICE_ASKS = [
  [
    {
      kind: 'choice',
      question: 'С какой стороны едут машины?',
      options: ['по левой', 'по правой'],
    },
    { kind: 'text', target: 'все надписи на вывесках' },
  ],
  [
    {
      kind: 'choice',
      question: 'Какие крыши у домов?',
      options: ['скатная черепица', 'плоские бетонные', 'металл'],
    },
  ],
];

const REPORT_ASKS = [
  [
    { kind: 'describe', topic: 'дорога: покрытие, разметка, бордюры' },
    { kind: 'text', target: 'самая крупная вывеска' },
  ],
  [{ kind: 'describe', topic: 'машины: по какой стороне дороги стоят и едут' }],
];

async function runFakeReportBrain(session: DetectiveSession): Promise<void> {
  const s = session.state;
  const point = { lat: s.opts.sample.lat + 0.5, lng: s.opts.sample.lng + 0.5 };
  await session.call('brain', 'briefing', {});
  await session.call('brain', 'ask', {
    hypothesis: 'Вывеска и дорога разделят основные версии.',
    requests: REPORT_ASKS[0],
    finding: 'В отчёте асфальт без разметки и двухэтажные дома: версии пока широкие.',
    current_guess: point,
  });
  await session.call('brain', 'ask', {
    hypothesis: 'Сторона движения подтвердит или опровергнет версию.',
    requests: REPORT_ASKS[1],
    finding: 'Вывеска прочитана: версия сузилась до одной страны.',
    current_guess: point,
    control: true,
  });
  await session.call('brain', 'final_guess', {
    lat: point.lat,
    lng: point.lng,
    confidence: 'country',
    clue: 'Вывеска на здании.',
    summary: 'Я прочитал отчёт, попросил переписать вывеску и перепроверил сторону движения.',
    finding: 'Сторона движения подтвердила версию.',
  });
}

export async function runFakeBrain(session: DetectiveSession): Promise<void> {
  const s = session.state;
  if (s.opts.protocol === 'report') return runFakeReportBrain(session);
  const point = { lat: s.opts.sample.lat + 0.5, lng: s.opts.sample.lng + 0.5 };
  const [first, second] = s.opts.protocol === 'choice' ? CHOICE_ASKS : CATALOG_ASKS;
  await session.call('brain', 'ask', {
    hypothesis: 'Сторона движения и письменность разделят основные версии.',
    questions: first,
  });
  await session.call('brain', 'ask', {
    hypothesis: 'Вывеска сузит регион.',
    questions: second,
    finding: 'Сторона движения и письменность получены; версии сузились.',
    current_guess: point,
  });
  await session.call('brain', 'final_guess', {
    lat: point.lat,
    lng: point.lng,
    summary: 'Я сопоставил сторону движения, письменность и вывеску.',
    finding: 'Вывеска и крыши подтвердили версию.',
  });
}
