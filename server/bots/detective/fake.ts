import type { BotTokenUsage } from '../../../shared/bot-results.ts';
import type { RoundTarget } from '../../engine/types.ts';
import { cleanupBotHandle } from '../process.ts';
import type { Question } from './broker.ts';
import { reportRoleUsage, runIds, type DetectiveRun } from './run.ts';
import { roundOver, turnsLeft, type ToolReply } from './state.ts';

/**
 * `--fake` mode: a scripted brain and scripted eyes play one Detective round without a CLI. They
 * call the real session, so the report, the exchanges, a drive, an unreadable text and the control
 * check all pass through the same handlers and reach the journal the same way as in a live round.
 */

const pause = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

function near(target: RoundTarget, delta: number): { lat: number; lng: number } {
  return { lat: clampLat(target.lat + delta), lng: target.lng + delta };
}

/** Token counts that are plainly made up: fake mode has no CLI to report real ones. */
function fakeUsage(inputTokens: number, outputTokens: number): BotTokenUsage {
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: 0,
    totalTokens: inputTokens + outputTokens,
  };
}

const FAKE_REPORT = {
  sections: {
    texts: [{ text: '«MAGAZIN 24» — вывеска над входом в одноэтажное здание', frame: 2 }],
    road: [
      { text: 'Сторона движения: правая — машины стоят вдоль правого края', frame: 1 },
      { text: 'Дорога идёт: на север и на юг; на севере видны дома', frame: 1 },
      { text: 'Асфальт, белая прерывистая осевая линия', frame: 3 },
    ],
    vehicles: [{ text: 'Светлый седан, номер размыт', frame: 2 }],
    poles_signs: [{ text: 'Бетонные столбы с тремя проводами вдоль дороги', frame: 4 }],
    buildings: [{ text: 'Одноэтажные дома со скатными крышами', frame: 2 }],
    nature: [
      { text: 'Солнце: на юге, высоко', frame: 3 },
      { text: 'Лиственные деревья, трава вдоль обочин', frame: 4 },
    ],
    unusual: [],
  },
};

type Call = (tool: string, args?: unknown) => Promise<ToolReply>;

async function fakeAnswer(
  run: DetectiveRun,
  call: Call,
  q: Question,
  n: number,
): Promise<Record<string, unknown>> {
  const frames = run.session.state.frames;
  const lastFrame = (): number => frames[frames.length - 1]?.n ?? 1;
  if (q.kind === 'drive') {
    const moved = await call('move', { heading: q.heading, distance_m: q.distance_m });
    if (moved.isError) return { n, value: 'no_road' };
    return {
      n,
      value: 'Перекрёсток с синим указателем, дальше ряд одноэтажных домов.',
      confidence: 'sure',
      frame: lastFrame(),
    };
  }
  // One text stays unreadable and one answer is unsure, so the card shows both marks.
  if (q.kind === 'text') {
    return q.target.includes('вывеска')
      ? { n, value: 'MAGAZIN 24 | +00 555 0100', confidence: 'sure', frame: 2 }
      : { n, value: 'unreadable' };
  }
  if (q.topic.includes('почва')) {
    return { n, value: 'Обочина из светлого гравия.', confidence: 'unsure', frame: lastFrame() };
  }
  return {
    n,
    value: 'Белая прерывистая осевая, сплошные краевые линии.',
    confidence: 'sure',
    frame: lastFrame(),
  };
}

async function runFakeEyes(run: DetectiveRun, stepDelayMs: number): Promise<void> {
  const s = run.session.state;
  const call: Call = (tool, args = {}) => run.session.call('eyes', tool, args);
  await call('observe');
  await pause(stepDelayMs);
  if (turnsLeft(s) > 0) await call('look', { heading: 90, pitch: 0, fov: 30 });
  await pause(stepDelayMs);
  if ((await call('report', FAKE_REPORT)).isError) return;
  while (!roundOver(s)) {
    if ((await call('next_request')).isError) return;
    const request = s.broker.current();
    if (!request) continue;
    await pause(stepDelayMs);
    const answers: Array<Record<string, unknown>> = [];
    for (const [idx, q] of request.questions.entries()) {
      answers.push(await fakeAnswer(run, call, q, idx + 1));
    }
    await call('answer', { request_id: request.id, answers });
  }
}

/** The three asks of the fake brain: a first look, a drive (or a second look) and the control. */
function fakeAsks(run: DetectiveRun): Array<Record<string, unknown>> {
  const { target } = run.params;
  const second: Question = run.canMove
    ? { kind: 'drive', heading: 0, distance_m: 400, topic: 'указатели и таблички с названиями' }
    : { kind: 'describe', topic: 'столбы и провода: форма опор и число проводов' };
  return [
    {
      hypothesis:
        'Правостороннее движение и латиница оставляют несколько версий; их разделят разметка и текст на вывеске.',
      finding: 'Из отчёта: движение правостороннее, вывеска латиницей, солнце на юге.',
      current_guess: near(target, 1.5),
      requests: [
        { kind: 'describe', topic: 'дорожная разметка: цвет осевой и краевых линий' },
        { kind: 'text', target: 'вывеска над входом, кадр 2' },
      ],
    },
    {
      hypothesis: 'Разметка подходит к обеим версиям; нужен указатель с названием.',
      finding: 'Осевая белая и прерывистая, краевые сплошные: соседний регион подходит хуже.',
      shifts: [
        { version: 'Соседний регион', effect: 'weaker', because: 'Разметка другого образца.' },
      ],
      current_guess: near(target, 0.8),
      requests: [second, { kind: 'text', target: 'номер ближайшей машины' }],
    },
    {
      hypothesis: 'Версия держится на цвете обочин; проверяю его ещё раз перед ответом.',
      finding: 'Новое место показало синий указатель и такие же дома; номер машины не разобрать.',
      current_guess: near(target, 0.5),
      control: true,
      requests: [{ kind: 'describe', topic: 'почва и обочины: цвет' }],
    },
  ];
}

/** Resolves to true when the final guess was accepted. Exported for its test. */
export async function runFakeBrain(run: DetectiveRun, stepDelayMs: number): Promise<boolean> {
  const s = run.session.state;
  const { target, slot } = run.params;
  const call: Call = (tool, args = {}) => run.session.call('brain', tool, args);
  // An error reply means there will be no report (the eyes are gone or time is short). It comes
  // back without a wait, so asking again in a loop would never let the server do anything else.
  let reportLost = false;
  while (!s.briefed && !roundOver(s) && !reportLost) {
    reportLost = (await call('briefing')).isError === true;
  }
  for (const ask of reportLost ? [] : fakeAsks(run)) {
    await pause(stepDelayMs);
    if (roundOver(s)) return false;
    await call('ask', ask);
  }
  await pause(stepDelayMs);
  const summary = `Я не видел кадров: по отчёту напарника и его ответам остановился на версии «${target.countryNameRu}» и проверил решающий признак ещё раз.`;
  await call('final_guess', {
    ...near(target, 0.4),
    confidence: 'country',
    clue: 'Разметка и столбы местного образца, вывеска латиницей.',
    finding: 'Контрольная проверка подтвердила цвет обочин.',
    summary,
    quip: slot.personalityPreset === 'braggart' ? 'Я и не глядя угадал!' : 'Спасибо глазам.',
  });
  return s.final;
}

export function startFakeDetective(run: DetectiveRun): void {
  const { ctx, handle } = run;
  const stepDelayMs = ctx.fakeStepDelayMs ?? 250;
  const ids = runIds(run);
  ctx.logger?.log('harness_start', { slotId: ids.botId, mode: 'fake', playStyle: 'detective' });
  const eyes = runFakeEyes(run, stepDelayMs).catch(() => {
    // The fake brain reports the round; a broken fake eyes only shows up as unanswered asks.
    run.session.eyesExited();
  });
  void runFakeBrain(run, stepDelayMs)
    .then(async (final) => {
      run.session.end();
      await eyes;
      if (handle.stopped) return;
      reportRoleUsage(run, 'eyes', fakeUsage(4200, 380));
      reportRoleUsage(run, 'brain', fakeUsage(2600, 540));
      ctx.dispatch({
        type: 'bot_finished',
        ...ids,
        aborted: !final,
        reason: final ? 'завершил ход' : 'вышел без ответа',
      });
    })
    .catch((err: unknown) => {
      if (handle.stopped) return;
      const tail = (err instanceof Error ? err.message : String(err)).slice(-300);
      ctx.dispatch({
        type: 'bot_finished',
        ...ids,
        aborted: true,
        reason: 'сбой имитации',
        diagnosticsTail: tail,
      });
    })
    .finally(() => {
      ctx.logger?.log('harness_end', { slotId: ids.botId, mode: 'fake', aborted: handle.stopped });
      cleanupBotHandle(ctx.api, ctx.activeHandles, handle);
    });
}
