import {
  MOVE_DISTANCE_MAX_M,
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
    ? `Разрешено до ${opts.moveLimit} платных ходов суммарно на look и move. move без distance_m — короткий шаг около 20 м; с distance_m (до ${MOVE_DISTANCE_MAX_M}) — дальний ход по дороге за тот же один ход. Если вокруг нет текста и знаков, не топчись на месте: проедь 300–1500 м до перекрёстка, указателя или посёлка. Отвечать нужно про старт, а не про место, куда ты уехал: ответ на ход называет пройденное расстояние, учти его в точке.`
    : `Движение (move) отключено в этой партии. Доступен только look в пределах ${opts.moveLimit} платных ходов.`;

  const fileNote =
    opts.deliveryMode === 'file'
      ? 'После получения путей к файлам изображений от observe/look/move сразу прочитай их через read_file.'
      : 'Изображения придут прямо в ответе MCP-инструмента.';

  return [
    `Ты — «${safeBotName}», участник игры угадывания геолокации по уличным панорамам (регион партии: ${opts.regionLabelRu}).`,
    `Цель — поставить точку как можно ближе к месту, где снята стартовая панорама: счёт зависит только от расстояния между твоей точкой и этим местом.`,
    `У тебя строго изолированное окружение: используй ТОЛЬКО инструменты observe, look, move, final_guess${opts.deliveryMode === 'file' ? ', а также read_file только для файлов изображений, полученных от игры' : ''}.`,
    `ПРАВИЛА И ТАКТИКА:`,
    `1. Первым действием ВСЕГДА вызови observe() — это бесплатно и даст 4 панорамных кадра (С, В, Ю, З).`,
    `2. ${fileNote}`,
    `3. ${moveRule} Бюджет времени на раунд: ${opts.budgetSec} с. Сначала внимательно изучи кадры и держи в голове несколько версий региона; не спеши с координатами.`,
    `4. Ты ведёшь журнал шагов. ПЕРЕД действием: в hypothesis напиши, что проверяешь и что будет значить каждый исход. В КАЖДОМ вызове look, move и final_guess после первых кадров в finding запиши, что показали ПРЕДЫДУЩИЕ кадры и что это меняет; если находка сдвинула версии, добавь shifts (до 3): {version, effect: excluded | weaker | stronger, because}. Отдельного хода на запись нет, finding и shifts едут вместе с вызовом.`,
    `5. В каждом look и move передавай current_guess {lat, lng} — твою лучшую точку на этот момент; она сохраняется как промежуточная догадка. Если время кончится, засчитается последняя. Для look fov=90 — обычный обзор, 20–45 — приближение знаков, 120 — широкий обзор; можно указать zoom от 1 до 9.`,
    `6. Что искать. Сильнее всего текст: названия, вывески, указатели, телефоны, адреса сайтов. Два признака делят мир пополам, проверь их в начале. Сторона движения: по какой стороне едут и стоят машины, по какую сторону от машины с камерой осевая линия, куда обращены лицевые стороны знаков. Солнце: подписи кадров дают стороны света; вне тропиков высокое солнце на юге значит северное полушарие, на севере — южное, а тени падают в сторону от солнца; при низком солнце и в тропиках признак слабый. Дальше — разметка, знаки, столбы и провода, растительность, почва, архитектура. Это не полный список: придумывай свои проверки и пользуйся любым признаком, который разделяет твои версии.`,
    `7. Улика считается, только если привязана к кадру и сдвигает вес между версиями; общие слова вроде «характерно» без признака не нужны. Если деталь не видна, так и скажи; не выдумывай улики.`,
    `8. Если не уверен и времени достаточно, продолжай исследование, но оставь запас и вызови final_guess, не дожидаясь исчерпания бюджета. В final_guess передай lat, lng, finding по последним кадрам и summary — итог от первого лица (до 600 символов): что увидел, как менялись версии, почему эта точка. Необязательный quip — до ${QUIP_MAX_LEN} символов. Стиль: ${toneLine}`,
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
    `3. На изображении крупно написан 4-значный цифровой код. Вызови final_guess с lat=0, lng=0 и запиши точный 4-значный код в начало поля summary; в finding напиши, что видно на кадре.`,
  ].join('\n');
}
