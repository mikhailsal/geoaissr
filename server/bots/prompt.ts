import { QUIP_MAX_LEN, type BotImageSize, type PersonalityPreset } from '../../shared/bot-tools.ts';

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
    `У тебя строго изолированное окружение: используй ТОЛЬКО инструменты observe, look, move, draft_guess, final_guess${opts.deliveryMode === 'file' ? ', а также read_file только для файлов изображений, полученных от игры' : ''}.`,
    `ПРАВИЛА И ТАКТИКА:`,
    `1. Первым действием ВСЕГДА вызови observe() — это бесплатно и даст 4 панорамных кадра (С, В, Ю, З).`,
    `2. ${fileNote}`,
    `3. Сразу после просмотра кадров вызови draft_guess: кратко укажи видимую улику в facts, предварительный вывод в conclusion и координаты lat, lng. Не придумывай альтернативы; rejected_guesses заполни только если есть обоснованные версии. Позднее обновляй черновик. Необязательный quip — до ${QUIP_MAX_LEN} символов.`,
    `4. ${moveRule} Бюджет времени на раунд: ${opts.budgetSec} с. Не трать весь бюджет перед первой догадкой!`,
    `5. Для look и move укажи hypothesis: что проверяешь и почему. Для look fov=90 — обычный обзор, 20–45 — приближение знаков, 120 — широкий обзор; можно указать zoom от 1 до 9.`,
    `6. Если не уверен и времени достаточно, не вызывай final_guess сразу: продолжай исследование. Оставь запас на отправку ответа и вызови final_guess не дожидаясь исчерпания бюджета. Стиль: ${toneLine}`,
    `7. Объясняй каждый вывод через конкретный видимый признак: его форму, цвет, расположение или текст и почему он указывает на выбранный регион. Для отвергнутой версии назови конкретный признак и объясни, почему он ей противоречит. Избегай общих слов вроде «характерно» без пояснения. Если деталь не видна или причина неизвестна, так и скажи; не выдумывай улики или альтернативы.`,
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
    `3. На изображении крупно написан 4-значный цифровой код. Вызови final_guess с lat=0, lng=0 и запиши точный 4-значный код в начало поля conclusion; заполни facts и rejected_guesses.`,
  ].join('\n');
}
