import { REGION_COUNTRIES } from '../../shared/regions.ts';

/**
 * Place-name and demonym guard for the brain's free text sent to the eyes (the target of a
 * transcription request). It is a heuristic: country names and their stems from shared/regions,
 * and a list of irregular demonyms. Script names made from demonyms («японская», «грузинская»)
 * are blocked too: the script is asked through the catalog feature, so a transcription target
 * never needs one. Catalog values are fixed ids and need no guard.
 */

/** Words inside country names that are ordinary words, not places. */
const GENERIC_NAME_WORDS = new Set([
  'новая',
  'южная',
  'южный',
  'северная',
  'западная',
  'восточная',
  'центральная',
  'республика',
  'демократическая',
  'народная',
  'объединённые',
  'объединенные',
  'королевство',
  'острова',
  'остров',
  'федерация',
  'штаты',
  'гвинея',
]);

/** Irregular demonym stems that a country-name stem does not catch. */
const DEMONYM_STEMS = [
  'русск',
  'англи',
  'британ',
  'немец',
  'немц',
  'француз',
  'испан',
  'итальян',
  'китай',
  'америк',
  'турец',
  'турк',
  'голланд',
  'швед',
  'финск',
  'норвеж',
  'датск',
  'польск',
  'чешск',
  'венгер',
  'шотланд',
  'ирланд',
  'австрал',
  'бразил',
  'мексик',
  'индонез',
  'вьетнам',
  'корей',
  'египет',
  'тамил',
  'тайск',
  'тайц',
  'хинди',
  'бенгал',
  'европ',
  'азиат',
  'африк',
  'латиноамер',
  'скандинав',
  'балкан',
  'прибалт',
];

/** Common words that a country stem catches ("того" is Togo, "грузовик" starts like Georgia). */
const COMMON_WORDS = new Set(['того', 'груз']);
const COMMON_PREFIXES = ['грузов', 'грузч', 'костюм', 'костёр', 'костер'];

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word) || COMMON_PREFIXES.some((p) => word.startsWith(p));
}

const LETTERS = /[a-zа-яё]+/gu;

function words(text: string): string[] {
  return text.toLowerCase().match(LETTERS) ?? [];
}

function stemOf(word: string): string {
  return word.length <= 5 ? word.slice(0, 4) : word.slice(0, word.length - 2);
}

function buildPlaceStems(): string[] {
  const stems = new Set<string>(DEMONYM_STEMS);
  for (const country of REGION_COUNTRIES) {
    for (const word of words(country.nameRu)) {
      if (word.length < 4 || GENERIC_NAME_WORDS.has(word)) continue;
      stems.add(stemOf(word));
    }
  }
  return [...stems];
}

export interface PlaceGuard {
  /** The first word that looks like a place name or demonym, or null when the text is clean. */
  findPlaceWord: (text: string) => string | null;
}

export function createPlaceGuard(): PlaceGuard {
  const stems = buildPlaceStems();
  return {
    findPlaceWord(text) {
      for (const word of words(text)) {
        if (word.length < 3 || isCommonWord(word)) continue;
        if (stems.some((stem) => word.startsWith(stem))) return word;
      }
      return null;
    },
  };
}

/** English names of countries and large cities, for transcriptions written in Latin script. */
const LATIN_PLACE_NAMES = [
  'argentina',
  'australia',
  'brazil',
  'canada',
  'china',
  'england',
  'france',
  'georgia',
  'germany',
  'india',
  'italy',
  'japan',
  'korea',
  'mexico',
  'nepal',
  'new zealand',
  'puerto rico',
  'russia',
  'south africa',
  'spain',
  'sri lanka',
  'taiwan',
  'thailand',
  'united kingdom',
  'usa',
  'london',
  'paris',
  'berlin',
  'rome',
  'milan',
  'madrid',
  'barcelona',
  'moscow',
  'tokyo',
  'osaka',
  'kyoto',
  'bangkok',
  'taipei',
  'kathmandu',
  'colombo',
  'delhi',
  'mumbai',
  'tbilisi',
  'sydney',
  'melbourne',
  'hobart',
  'auckland',
  'wellington',
  'buenos aires',
  'mendoza',
  'johannesburg',
  'cape town',
  'new york',
  'washington',
  'san juan',
];

/** Place names (Russian country names, common English names) found in a text. */
export function placeNamesIn(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const country of REGION_COUNTRIES) {
    const name = country.nameRu.toLowerCase();
    if (name.length >= 4 && lower.includes(name)) found.push(country.nameRu);
  }
  for (const name of LATIN_PLACE_NAMES) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(lower)) found.push(name);
  }
  return found;
}
