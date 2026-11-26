/**
 * A map is the pool of places a round can start in. The region narrows any map to a continent
 * or to one country; the two settings are independent.
 */
export const MAP_IDS = [
  'standard',
  'wild',
  'cities',
  'megacities',
  'capitals',
  'airports',
  'highlands',
  'north',
  'retro',
] as const;
export type MapId = (typeof MAP_IDS)[number];

export function isMapId(value: string): value is MapId {
  return (MAP_IDS as readonly string[]).includes(value);
}

/** Name of the map in the lobby. */
export const MAP_LABELS_RU: Readonly<Record<MapId, string>> = {
  standard: 'Стандартная',
  wild: 'Глушь',
  cities: 'Города',
  megacities: 'Мегаполисы',
  capitals: 'Столицы',
  airports: 'Аэропорты мира',
  highlands: 'Высокогорье',
  north: 'Север',
  retro: 'Ретро',
};

/**
 * A few words after the map's name in the list of maps, so that «Глушь» or «Север» says what it
 * is before it is picked. The full line under the select follows in `MAP_DESCRIPTIONS_RU`.
 */
export const MAP_OPTION_NOTES_RU: Readonly<Record<MapId, string>> = {
  standard: 'города и случайные точки',
  wild: 'случайные точки, чаще вдали от городов',
  cities: 'от 500 тысяч жителей',
  megacities: 'от 5 миллионов жителей',
  capitals: 'только столицы стран',
  airports: 'до 5 км от аэропорта',
  highlands: 'города выше 2000 м',
  north: 'севернее 60° с. ш.',
  retro: 'панорамы до 2012 года',
};

/** One line under the map select: what kind of places the map holds. */
export const MAP_DESCRIPTIONS_RU: Readonly<Record<MapId, string>> = {
  standard: 'Половина раундов в городах и посёлках, половина в случайных точках страны',
  wild: 'Случайные точки по площади стран: чаще вдали от городов',
  cities: 'Плотная застройка городов от 500 тысяч жителей',
  megacities: 'Только города от 5 миллионов жителей',
  capitals: 'Только столицы стран',
  airports: 'Не дальше 5 км от аэропорта с регулярными рейсами',
  highlands: 'Города от 100 тысяч жителей выше 2000 м над уровнем моря',
  north: 'Только севернее 60° северной широты',
  retro: 'Панорамы, снятые до 2012 года',
};

/**
 * What a bot is told about the map in its start prompt: the same fact a player reads in the
 * lobby. Empty for the standard map, so its prompt carries no extra words.
 */
export function getMapPromptNoteRu(map: MapId): string {
  if (map === 'standard') return '';
  const description = MAP_DESCRIPTIONS_RU[map];
  return `; карта «${MAP_LABELS_RU[map]}»: ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
}
