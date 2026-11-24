import {
  MOVE_DISTANCE_MAX_M,
  QUIP_MAX_LEN,
  type BotImageSize,
  type PersonalityPreset,
} from '../../shared/bot-tools.ts';
import { loadPrompt } from './prompt-files.ts';

const PRESET_TONE_RU: Record<PersonalityPreset, string> = {
  neutral: 'Спокойный, точный и деловой тон.',
  braggart: 'Уверенный, чуть самонадеянный тон с лёгким азартом.',
  humble: 'Скромный, осторожный и вежливый тон.',
  scientist: 'Аналитический тон с упором на факты: дорожная разметка, архитектура, климат, знаки.',
};

function sanitizeSingleLine(raw: string, maxLen: number): string {
  let cleaned = '';
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    cleaned += code < 32 || code === 127 ? ' ' : ch;
  }
  return cleaned.replace(/\s+/g, ' ').replace(/[«»]/g, '"').trim().slice(0, maxLen);
}

export function sanitizePersonalityText(raw: string): string {
  return sanitizeSingleLine(raw, 200);
}

/** The tone of a bot's summary and quip: the preset, plus the host's own words when given. */
export function buildToneLine(preset: PersonalityPreset, personalityText: string): string {
  const customTone = sanitizePersonalityText(personalityText);
  return customTone
    ? `${PRESET_TONE_RU[preset]} Стиль реплик (quip): «${customTone}».`
    : PRESET_TONE_RU[preset];
}

/** The values the Intuit template may use; see `prompts/intuit.txt`. */
export function buildBotRoundPrompt(opts: {
  botName: string;
  regionLabelRu: string;
  moveEnabled: boolean;
  moveLimit: number;
  budgetSec: number;
  personalityPreset: PersonalityPreset;
  personalityText: string;
  deliveryMode: 'mcp' | 'file';
}): string {
  return loadPrompt('intuit.txt', {
    botName: sanitizeSingleLine(opts.botName, 24) || 'Bot',
    regionLabel: opts.regionLabelRu,
    moveEnabled: opts.moveEnabled,
    moveLimit: opts.moveLimit,
    budgetSec: opts.budgetSec,
    moveDistanceMax: MOVE_DISTANCE_MAX_M,
    quipMaxLen: QUIP_MAX_LEN,
    toneLine: buildToneLine(opts.personalityPreset, opts.personalityText),
    fileDelivery: opts.deliveryMode === 'file',
  });
}

export function buildVisionCheckPrompt(
  deliveryMode: 'mcp' | 'file',
  imageSize: BotImageSize,
): string {
  const readInstruction =
    deliveryMode === 'file'
      ? 'Прочитай сохранённый файл из рабочей директории через read_file.'
      : 'Просмотри полученное изображение из ответа observe.';
  return [
    `Служебная самопроверка зрения (${imageSize}px).`,
    `1. Вызови observe().`,
    `2. ${readInstruction}`,
    `3. На изображении крупно написан 4-значный цифровой код. Вызови final_guess с lat=0, lng=0 и запиши точный 4-значный код в начало поля summary; в finding напиши, что видно на кадре.`,
  ].join('\n');
}
