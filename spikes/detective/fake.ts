import type { DetectiveSession } from './session.ts';

/**
 * In-process stand-ins for the two roles, used by `--dry` and the tests. They drive the same
 * session handlers the real processes reach over HTTP, at no cost.
 */

export async function runFakeEyes(session: DetectiveSession): Promise<void> {
  const s = session.state;
  await session.call('eyes', 'observe', {});
  for (let i = 0; i < 20 && s.final === null; i += 1) {
    await session.call('eyes', 'next_request', {});
    const request = s.broker.current();
    if (!request) continue;
    if (s.turnsUsed === 0) await session.call('eyes', 'look', { heading: 90, fov: 30 });
    const answers = request.questions.map((q, idx) => {
      const label =
        q.kind === 'feature'
          ? (s.opts.sample.labels?.[q.feature] ?? 'not_visible')
          : (s.opts.sample.signText?.[0]?.text ?? 'not_visible');
      return { n: idx + 1, value: label, frame: 1 };
    });
    await session.call('eyes', 'answer', { request_id: request.id, answers });
  }
}

export async function runFakeBrain(session: DetectiveSession): Promise<void> {
  const s = session.state;
  const point = { lat: s.opts.sample.lat + 0.5, lng: s.opts.sample.lng + 0.5 };
  await session.call('brain', 'ask', {
    hypothesis: 'Сторона движения и письменность разделят основные версии.',
    questions: [
      { kind: 'feature', feature: 'driving_side' },
      { kind: 'feature', feature: 'script' },
    ],
  });
  await session.call('brain', 'ask', {
    hypothesis: 'Вывеска сузит регион.',
    questions: [
      { kind: 'text', target: 'самая крупная вывеска' },
      { kind: 'feature', feature: 'roof_type' },
    ],
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
