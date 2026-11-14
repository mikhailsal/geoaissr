export const PAPER_HEX = '#F4F1EA';
export const ASPHALT_900_HEX = '#14171B';

export interface ParticipantColor {
  id: ParticipantColorId;
  cssVar: `--${ParticipantColorId}`;
  hex: string;
  labelRu: string;
  inkHex: typeof PAPER_HEX | typeof ASPHALT_900_HEX;
  inkToken: '--paper' | '--asphalt-900';
}

export const PARTICIPANT_COLOR_IDS = [
  'p-1',
  'p-2',
  'p-3',
  'p-4',
  'p-5',
  'p-6',
  'p-7',
  'p-8',
  'p-9',
  'p-10',
  'p-11',
  'p-12',
] as const;

export type ParticipantColorId = (typeof PARTICIPANT_COLOR_IDS)[number];

interface RawColorDef {
  id: ParticipantColorId;
  hex: string;
  labelRu: string;
}

const RAW_COLORS: readonly RawColorDef[] = [
  { id: 'p-1', hex: '#E8590C', labelRu: 'оранжевый' },
  { id: 'p-2', hex: '#C2255C', labelRu: 'малиновый' },
  { id: 'p-3', hex: '#9C36B5', labelRu: 'сиреневый' },
  { id: 'p-4', hex: '#7048E8', labelRu: 'фиолетовый' },
  { id: 'p-5', hex: '#339AF0', labelRu: 'синий' },
  { id: 'p-6', hex: '#1098AD', labelRu: 'бирюзовый' },
  { id: 'p-7', hex: '#0CA678', labelRu: 'изумрудный' },
  { id: 'p-8', hex: '#74B816', labelRu: 'салатовый' },
  { id: 'p-9', hex: '#8D5524', labelRu: 'коричневый' },
  { id: 'p-10', hex: '#868E96', labelRu: 'серый' },
  { id: 'p-11', hex: '#F06595', labelRu: 'розовый' },
  { id: 'p-12', hex: '#22B8CF', labelRu: 'голубой' },
];

function linearizeChannel(channelByte: number): number {
  const srgb = channelByte / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function chooseInk(bgHex: string): {
  inkHex: typeof PAPER_HEX | typeof ASPHALT_900_HEX;
  inkToken: '--paper' | '--asphalt-900';
} {
  const paperContrast = contrastRatio(bgHex, PAPER_HEX);
  const darkContrast = contrastRatio(bgHex, ASPHALT_900_HEX);
  if (darkContrast >= paperContrast) {
    return { inkHex: ASPHALT_900_HEX, inkToken: '--asphalt-900' };
  }
  return { inkHex: PAPER_HEX, inkToken: '--paper' };
}

export const PARTICIPANT_COLORS: readonly ParticipantColor[] = RAW_COLORS.map((c) => {
  const { inkHex, inkToken } = chooseInk(c.hex);
  return {
    id: c.id,
    cssVar: `--${c.id}`,
    hex: c.hex,
    labelRu: c.labelRu,
    inkHex,
    inkToken,
  };
});

export function getParticipantColor(id: ParticipantColorId): ParticipantColor {
  const found = PARTICIPANT_COLORS.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Unknown participant color: ${id}`);
  }
  return found;
}

export function isColorAvailable(
  colorId: ParticipantColorId,
  usedColors: readonly ParticipantColorId[],
): boolean {
  return !usedColors.includes(colorId);
}

export function pickFirstFreeColor(
  usedColors: readonly ParticipantColorId[],
): ParticipantColorId | null {
  for (const id of PARTICIPANT_COLOR_IDS) {
    if (!usedColors.includes(id)) {
      return id;
    }
  }
  return null;
}
