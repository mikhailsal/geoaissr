import type { JournalStep, ShiftEffect } from '$shared/bot-journal';
import { formatZoom, pluralizeRu } from '../i18n/format';

export type ShiftTone = 'excluded' | 'weaker' | 'stronger';

const SHIFT_LABELS: Record<ShiftEffect, string> = {
  excluded: 'Отпало',
  weaker: 'Менее вероятно',
  stronger: 'Более вероятно',
};

const kmFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const kmIntFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export const FIRST_LOOK_TITLE = 'Первый взгляд';
export const NO_SUMMARY_TEXT = 'Итог не записан';
export const NO_FINDING_TEXT = 'вывод не записан';
export const ROUND_ENDED_TEXT = 'раунд закончился раньше вывода';

/** Disclosure caption: «Ход за ходом (3 шага)». Counts every step, including the first look. */
export function disclosureLabel(count: number): string {
  return `Ход за ходом (${pluralizeRu(count, 'шаг', 'шага', 'шагов')})`;
}

export function shiftLabel(effect: ShiftEffect): string {
  return SHIFT_LABELS[effect];
}

/** Title of a step row, from its action and the camera parameters of its first frame. */
export function stepTitle(step: JournalStep): string {
  if (step.kind === 'observe') return FIRST_LOOK_TITLE;
  // A Detective exchange: the brain's request number k is step k.
  if (step.kind === 'ask') {
    return step.control ? `Запрос ${step.index} · контрольная проверка` : `Запрос ${step.index}`;
  }
  const params = step.frames[0]?.params;
  const heading = params ? ` · азимут ${Math.round(params.heading)}°` : '';
  if (step.kind === 'look') {
    const zoomed = params?.fov !== undefined && params.fov > 0 && params.fov < 90;
    const head = zoomed ? `Зум ${formatZoom(params.fov ?? 90)}×` : 'Осмотр';
    return `${head}${heading}`;
  }
  const head = params?.step !== undefined ? `Шаг ${params.step}` : 'Перемещение';
  // A long move shows how much road it covered.
  const far = params?.distanceM !== undefined ? ` · ${Math.round(params.distanceM)} м` : '';
  return `${head}${heading}${far}`;
}

/** «400 м от старта» for a frame the eyes took after driving away; null at the start. */
export function awayFromStart(fromStartM: number | undefined): string | null {
  return fromStartM !== undefined && fromStartM > 0
    ? `${Math.round(fromStartM)} м от старта`
    : null;
}

/**
 * Accessible name of a frame button: «Кадр шага N: <действие>». A Detective frame has its own
 * number, the one the report and the answers cite: «Кадр 5: <подпись>».
 */
export function frameName(
  step: JournalStep,
  frameLabel: string,
  frameNumber?: number,
  fromStartM?: number,
): string {
  if (frameNumber !== undefined) {
    const label = frameLabel.trim();
    const away = awayFromStart(fromStartM);
    const parts = [label, ...(away ? [away] : [])].filter((part) => part.length > 0);
    return parts.length > 0 ? `Кадр ${frameNumber}: ${parts.join(' · ')}` : `Кадр ${frameNumber}`;
  }
  const base = `Кадр шага ${step.index}: ${stepTitle(step)}`;
  return step.kind === 'observe' && frameLabel.trim() ? `${base} — ${frameLabel.trim()}` : base;
}

export interface FindingLine {
  text: string;
  /** False for a real finding; true for the placeholder texts. */
  placeholder: boolean;
}

/** The «Вывод:» content of a step, or null when the step has nothing to say yet. */
export function findingLine(step: JournalStep): FindingLine | null {
  if (step.finding) return { text: step.finding, placeholder: false };
  if (step.findingState === 'missing') return { text: NO_FINDING_TEXT, placeholder: true };
  if (step.findingState === 'round-ended' || step.findingState === 'pending') {
    return { text: ROUND_ENDED_TEXT, placeholder: true };
  }
  return null;
}

export function formatKm(km: number): string {
  return km < 10 ? kmFmt.format(km) : kmIntFmt.format(km);
}

/** The pin line of a step, or null when no point information exists for it. */
export function pinLine(step: JournalStep): string | null {
  if (step.pointMissing) return 'новая точка не записана';
  if (step.movedKm !== undefined) {
    if (step.movedKm === 0) return 'точка не сдвинулась';
    if (step.movedKm < 0.1) return 'точка сдвинулась меньше чем на 0,1 км';
    return `точка сдвинулась на ${formatKm(step.movedKm)} км`;
  }
  if (step.currentGuess) return 'первая точка';
  return null;
}
