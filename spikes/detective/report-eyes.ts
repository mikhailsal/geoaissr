import { formatToolZodError } from '../../shared/bot-tools.ts';
import { maskReport, reportLines, reportSchema } from './report.ts';
import { PRE_REPORT_LOOKS } from './report-protocol.ts';
import {
  elapsedMs,
  errorReply,
  roundOver,
  wakeReportWaiters,
  type SessionState,
  type ToolReply,
} from './state.ts';

/** The eyes' `report` tool of the report protocol: one scene report per round. */

const ROUND_OVER_TEXT = 'Раунд окончен. Больше ничего не вызывай и заверши работу.';
/** What follows `observe` under the report protocol: the text hunt, then the report. */
export const AFTER_OBSERVE_TEXT = `Теперь охота за текстом: до ${PRE_REPORT_LOOKS} приближений look (fov 20–40) туда, где может быть текст, затем report.`;
export const REPORT_FIRST_TEXT =
  'Сначала сдай отчёт о сцене: вызови report. Напарник ждёт его и без него не может начать.';

export function handleReport(s: SessionState, args: unknown): ToolReply {
  if (roundOver(s)) return { text: ROUND_OVER_TEXT };
  if (s.frames.length === 0) {
    return errorReply('Сначала вызови observe: отчёт пишется по кадрам.');
  }
  if (s.report !== null) return { text: 'Отчёт уже принят. Вызови next_request.' };
  const parsed = reportSchema.safeParse(args);
  if (!parsed.success) return errorReply(formatToolZodError(parsed.error));
  const lines = reportLines(parsed.data);
  if (lines.length === 0) {
    return errorReply('Отчёт пуст: опиши, что видно на кадрах, хотя бы в одном разделе.');
  }
  // A wrong frame number does not reject the report: rewriting it would cost the brain its time.
  const unknownFrames = lines.filter((l) => !s.frames.some((f) => f.n === l.frame)).length;
  const { report: masked, masked: maskedWords } = maskReport(s.guard, parsed.data);
  s.report = { tMs: elapsedMs(s), raw: parsed.data, masked, maskedWords, unknownFrames };
  wakeReportWaiters(s);
  return { text: 'Отчёт принят и передан напарнику. Вызови next_request.' };
}
