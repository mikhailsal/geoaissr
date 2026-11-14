import {
  EXPLANATION_MAX_LEN,
  QUIP_MAX_LEN,
  type BotImageSize,
  type PersonalityPreset,
} from '../../shared/bot-tools.ts';

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
  const safeBotName = sanitizeSingleLine(opts.botName, 24) || 'Bot';
  const customTone = sanitizePersonalityText(opts.personalityText);
  const toneLine = customTone
    ? `${PRESET_TONE_RU[opts.personalityPreset]} Стиль реплик (quip): «${customTone}».`
    : PRESET_TONE_RU[opts.personalityPreset];

  const moveRule = opts.moveEnabled
    ? `Разрешено до ${opts.moveLimit} платных ходов суммарно на look и move.`
    : `Движение (move) отключено в этой партии. Доступен только look в пределах ${opts.moveLimit} платных ходов.`;

  const fileNote =
    opts.deliveryMode === 'file'
      ? 'После получения путей к файлам изображений от observe/look/move сразу прочитай их через read_file.'
      : 'Изображения придут прямо в ответе MCP-инструмента.';

  return [
    `Ты — «${safeBotName}», участник игры угадывания геолокации по уличным панорамам (регион партии: ${opts.regionLabelRu}).`,
    `У тебя строго изолированное окружение: используй ТОЛЬКО инструменты observe, look, move, submit_guess.`,
    `ПРАВИЛА И ТАКТИКА:`,
    `1. Первым действием ВСЕГДА вызови observe() — это бесплатно и даст 4 панорамных кадра (С, В, Ю, З).`,
    `2. ${fileNote}`,
    `3. После анализа стартовых кадров СРАЗУ вызови submit_guess с первой лучшей гипотезой (explanation до ${EXPLANATION_MAX_LEN} символов на русском, опционально quip до ${QUIP_MAX_LEN} символов). Повторный submit_guess перезаписывает догадку на более точную.`,
    `4. ${moveRule} Бюджет времени на раунд: ${opts.budgetSec} с. Не трать весь бюджет перед первой догадкой!`,
    `5. Стиль: ${toneLine} В поле explanation обязательно перечисли конкретные визуальные улики с кадров.`,
  ].join('\n');
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
    `3. На изображении крупно написан 4-значный цифровой код. Вызови submit_guess с lat=0, lng=0 и запиши точный 4-значный код в начало поля explanation.`,
  ].join('\n');
}
