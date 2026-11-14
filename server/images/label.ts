import path from 'node:path';
import sharp from 'sharp';
import type { BotImageSize } from '../../shared/bot-tools.ts';

const FONT_CY = path.resolve(
  import.meta.dir,
  '../../node_modules/@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2',
);
const FONT_LAT = path.resolve(
  import.meta.dir,
  '../../node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2',
);

const CARDINALS_RU = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'] as const;

export function normalizeHeadingDeg(heading: number): number {
  const mod = ((Math.round(heading) % 360) + 360) % 360;
  return mod;
}

export function headingToCardinalRu(heading: number): string {
  const deg = ((heading % 360) + 360) % 360;
  const idx = Math.floor((deg + 22.5) / 45) % 8;
  return CARDINALS_RU[idx] ?? 'С';
}

export function formatImageLabel(
  action: 'observe' | 'look' | 'move',
  heading: number,
  step?: number,
): { prefixCy: string; degLat: string; dirCy: string; fullText: string } {
  const deg = normalizeHeadingDeg(heading);
  const dirCy = headingToCardinalRu(deg);
  const prefixCy =
    action === 'observe' ? 'Старт:' : action === 'look' ? 'Взгляд:' : `Шаг ${step ?? 1}:`;
  const degLat = `${deg}°`;
  return {
    prefixCy,
    degLat,
    dirCy,
    fullText: `${prefixCy} ${degLat} ${dirCy}`,
  };
}

function escapePango(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function renderTextPng(
  text: string,
  fontfile: string,
  colorHex: string,
  pangoSize: number,
): Promise<Buffer> {
  return sharp({
    text: {
      text: `<span foreground="${colorHex}" size="${pangoSize}">${escapePango(text)}</span>`,
      fontfile,
      rgba: true,
      dpi: 96,
    },
  })
    .png()
    .toBuffer();
}

export async function annotateStreetViewImage(
  rawBuffer: Buffer,
  size: BotImageSize,
  parts: { prefixCy: string; degLat: string; dirCy: string },
): Promise<Buffer> {
  const pangoSize = size <= 256 ? 13_500 : size <= 400 ? 15_500 : 17_500;
  const [prefixPng, degPng, dirPng] = await Promise.all([
    renderTextPng(parts.prefixCy, FONT_CY, '#F4F1EA', pangoSize),
    renderTextPng(parts.degLat, FONT_LAT, '#FFD23F', pangoSize),
    renderTextPng(parts.dirCy, FONT_CY, '#FFD23F', pangoSize),
  ]);

  const [mPrefix, mDeg, mDir] = await Promise.all([
    sharp(prefixPng).metadata(),
    sharp(degPng).metadata(),
    sharp(dirPng).metadata(),
  ]);

  const padX = 10;
  const padY = 6;
  const gap = 5;
  const w1 = mPrefix.width;
  const w2 = mDeg.width;
  const w3 = mDir.width;
  const textH = Math.max(mPrefix.height, mDeg.height, mDir.height, 16);
  const pillW = Math.min(size - 16, padX * 2 + w1 + gap + w2 + gap + w3);
  const pillH = Math.max(24, textH + padY * 2);

  const badge = await sharp({
    create: {
      width: pillW,
      height: pillH,
      channels: 4,
      background: { r: 20, g: 23, b: 27, alpha: 0.82 },
    },
  })
    .composite([
      { input: prefixPng, left: padX, top: Math.round((pillH - mPrefix.height) / 2) },
      { input: degPng, left: padX + w1 + gap, top: Math.round((pillH - mDeg.height) / 2) },
      {
        input: dirPng,
        left: padX + w1 + gap + w2 + gap,
        top: Math.round((pillH - mDir.height) / 2),
      },
    ])
    .png()
    .toBuffer();

  return sharp(rawBuffer)
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: badge, left: 8, top: 8 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

export async function createThumb(labeledBuffer: Buffer): Promise<Buffer> {
  const base = sharp(labeledBuffer).resize(160, 160, { fit: 'cover' });
  for (const quality of [72, 55, 38, 25]) {
    const out = await base.clone().jpeg({ quality }).toBuffer();
    if (out.byteLength <= 15 * 1024 || quality === 25) {
      return out;
    }
  }
  return base.jpeg({ quality: 25 }).toBuffer();
}
