import { avatarChoices, type AvatarSlot } from '$shared/avatar-catalog';
import { defaultAvatar, type AvatarAppearance } from '$shared/avatar';
import options from './options.json';
import palettes from './palettes.json';
import presets from '$shared/avatar-presets.json';

export { presets };
export const groups: { name: string; slots: AvatarSlot[] }[] = [
  { name: 'Образ', slots: [] },
  { name: 'Одежда', slots: ['outfit', 'bottom', 'shoe'] },
  { name: 'Причёска', slots: ['hair', 'dye'] },
  { name: 'Лицо', slots: ['eyeStyle', 'brow', 'nose', 'freckles', 'mark'] },
  { name: 'Усы и борода', slots: ['mustache', 'beard'] },
  { name: 'Аксессуары', slots: ['gear', 'eyewear', 'earrings', 'neckwear'] },
  { name: 'Тело', slots: ['skin', 'faceShape', 'build'] },
];
export const slotNames: Record<AvatarSlot, string> = {
  outfit: 'Верх',
  bottom: 'Низ',
  shoe: 'Обувь',
  hair: 'Стрижка',
  dye: 'Окрашивание',
  eyeStyle: 'Глаза',
  brow: 'Брови',
  nose: 'Нос',
  freckles: 'Веснушки',
  mark: 'Рисунок',
  mustache: 'Усы',
  beard: 'Борода',
  gear: 'Головной убор',
  eyewear: 'Очки',
  earrings: 'Серьги',
  neckwear: 'На шею',
  skin: 'Оттенок кожи',
  faceShape: 'Форма лица',
  build: 'Телосложение',
};
type ColorKey = Exclude<keyof AvatarAppearance, AvatarSlot | 'base'> | 'skin';
type ColorSlot = { key: ColorKey; palette: keyof typeof palettes; linked?: boolean };
const colorSlots: Partial<Record<AvatarSlot, ColorSlot>> = {
  outfit: { key: 'color', palette: 'outfit' },
  bottom: { key: 'bottomColor', palette: 'outfit' },
  shoe: { key: 'shoeColor', palette: 'outfit' },
  hair: { key: 'hairColor', palette: 'hair' },
  dye: { key: 'dyeColor', palette: 'hair' },
  eyeStyle: { key: 'eyeColor', palette: 'eyeStyle' },
  brow: { key: 'browColor', palette: 'hair', linked: true },
  beard: { key: 'beardColor', palette: 'hair', linked: true },
  mustache: { key: 'mustacheColor', palette: 'hair', linked: true },
  gear: { key: 'gearColor', palette: 'outfit' },
  eyewear: { key: 'eyewearColor', palette: 'outfit' },
  earrings: { key: 'earringColor', palette: 'earrings' },
  neckwear: { key: 'neckColor', palette: 'earrings' },
};
interface Option {
  label: string;
  color?: string;
}
const labels: Record<AvatarSlot, Record<string, Option>> = options;
// Each sheet follows the catalog order, with up to five cells per row.
export function thumbnail(group: AvatarSlot | 'look', index: number, count: number) {
  const cols = Math.min(5, count);
  const rows = Math.ceil(count / cols);
  const x = ((index % cols) * 100) / Math.max(1, cols - 1);
  const y = (Math.floor(index / cols) * 100) / Math.max(1, rows - 1);
  return `background-image:url("/orbit/${group}.webp"); background-size:${cols * 100}% ${rows * 100}%; background-position:${x}% ${y}%;`;
}
export function items(slot: AvatarSlot) {
  return avatarChoices[slot].map((id, index) => {
    const entry = labels[slot][id];
    if (!entry) throw new Error('Missing wardrobe label: ' + slot + '/' + id);
    const image =
      slot !== 'skin' &&
      !(id === 'none' && ['gear', 'eyewear', 'earrings', 'neckwear'].includes(slot));
    return {
      id,
      ...entry,
      image: image ? thumbnail(slot, index, avatarChoices[slot].length) : null,
    };
  });
}
export function colorControl(slot: AvatarSlot, look: AvatarAppearance) {
  if (slot === 'skin') return { key: 'skin' as const, palette: [], linked: false };
  const color = colorSlots[slot];
  if (!color || look[slot] === 'none' || (slot === 'dye' && look.dye === 'solid')) return;
  return { ...color, palette: palettes[color.palette] };
}
export function equip(look: AvatarAppearance, slot: AvatarSlot, id: string): AvatarAppearance {
  const choice = labels[slot][id];
  const color = colorSlots[slot];
  const next = { ...look, [slot]: id };
  if (color && choice?.color && !color.linked && slot !== 'eyeStyle' && slot !== 'dye') {
    const current = labels[slot][look[slot]]?.color ?? defaultAvatar(false)[color.key];
    if (look[color.key] === current) next[color.key] = choice.color;
  }
  return next;
}
export function applyPreset(
  look: AvatarAppearance,
  preset: (typeof presets)[number],
): AvatarAppearance {
  return { ...defaultAvatar(false), ...preset.changes, base: look.base };
}
export function shuffle(look: AvatarAppearance): AvatarAppearance {
  let result = defaultAvatar(look.base === 'robot');
  const optional: AvatarSlot[] = [
    'gear',
    'eyewear',
    'earrings',
    'neckwear',
    'mustache',
    'beard',
    'mark',
  ];
  for (const group of groups) {
    for (const slot of group.slots) {
      const choices = avatarChoices[slot];
      const id =
        optional.includes(slot) && Math.random() < 0.55
          ? 'none'
          : choices[Math.floor(Math.random() * choices.length)];
      if (id) result = equip(result, slot, id);
    }
  }
  return result;
}
