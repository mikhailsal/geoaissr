import { REGION_COUNTRIES } from '../../shared/regions.ts';

/**
 * Place-name and demonym guard for the brain's free text sent to the eyes: the target of a
 * transcription request and, in the choice protocol, the question and its options. It is a
 * heuristic: country names and their stems from shared/regions, irregular demonyms, large cities
 * and English demonyms. A demonym right next to a script noun names a script the eyes can see
 * («грузинское письмо», «арабская вязь») and passes: the plan's script-name whitelist. Catalog
 * values are fixed ids and need no guard.
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

/** Large cities in Russian, as stems; a few short names are matched as whole words only. */
const CITY_STEMS = [
  'токи',
  'осак',
  'киот',
  'париж',
  'лондон',
  'берлин',
  'мадрид',
  'барселон',
  'милан',
  'москв',
  'москов',
  'петербург',
  'пекин',
  'шанха',
  'гонконг',
  'сеул',
  'бангкок',
  'тайбэ',
  'мумба',
  'катманд',
  'коломб',
  'тбилис',
  'сидне',
  'мельбурн',
  'хобарт',
  'окленд',
  'веллингтон',
  'буэнос',
  'мендос',
  'йоханнесбург',
  'кейптаун',
  'вашингтон',
  'стамбул',
  'каир',
  'торонто',
  'чикаго',
];
const CITY_WORDS = new Set(['дели', 'рим', 'рио', 'дубай', 'нью', 'лос']);

/** English country names and demonyms, for a brain that writes in Latin script. */
const LATIN_STEMS = [
  'japan',
  'chines',
  'china',
  'thai',
  'korea',
  'russia',
  'german',
  'french',
  'france',
  'spanish',
  'spain',
  'italian',
  'italy',
  'british',
  'english',
  'america',
  'austral',
  'brazil',
  'mexic',
  'india',
  'nepal',
  'georgia',
  'taiwan',
  'argentin',
  'zealand',
  'africa',
  'europ',
  'asian',
  'lanka',
  'sinhal',
  'tamil',
  'hindi',
  'arab',
];

/** Nouns that turn a neighbouring demonym into a script name. */
const SCRIPT_NOUN_STEMS = [
  'письм',
  'алфавит',
  'шрифт',
  'букв',
  'вязь',
  'иероглиф',
  'слогов',
  'цифр',
  'кана',
  'хангыл',
  'script',
  'alphabet',
  'letter',
  'character',
];

function isScriptNoun(word: string): boolean {
  return SCRIPT_NOUN_STEMS.some((stem) => word.startsWith(stem));
}

function isScriptName(ws: readonly string[], i: number): boolean {
  return isScriptNoun(ws[i - 1] ?? '') || isScriptNoun(ws[i + 1] ?? '');
}

/** True when a text asks about a script («Какая письменность на вывесках?»). */
export function mentionsScript(text: string): boolean {
  return words(text).some((w) => isScriptNoun(w) || w.startsWith('письменн'));
}

/** An adjective form («арабская», «тайское»), not a country name («Таиланд»). */
const ADJECTIVE_END = /(ая|ое|ий|ие|ый|ые|ой)$/u;

/** Common words that a country stem catches ("того" is Togo, "грузовик" starts like Georgia). */
const COMMON_WORDS = new Set(['того', 'груз', 'кана']);
const COMMON_PREFIXES = [
  'грузов',
  'грузч',
  'костюм',
  'костёр',
  'костер',
  'канав',
  'канал',
  'индикат',
  'индивид',
  'индустр',
  'польз',
  'корен',
  'малин',
  'мальч',
];

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
  const stems = new Set<string>([...DEMONYM_STEMS, ...CITY_STEMS, ...LATIN_STEMS]);
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
  /**
   * `scriptContext`: the text is an option of a question about scripts, so a bare demonym
   * adjective («арабская») names a script and passes.
   */
  findPlaceWord: (text: string, opts?: { scriptContext?: boolean }) => string | null;
}

export function createPlaceGuard(): PlaceGuard {
  const stems = buildPlaceStems();
  return {
    findPlaceWord(text, opts = {}) {
      const ws = words(text);
      for (const [i, word] of ws.entries()) {
        if (CITY_WORDS.has(word)) return word;
        if (word.length < 3 || isCommonWord(word)) continue;
        if (!stems.some((stem) => word.startsWith(stem))) continue;
        if (isScriptName(ws, i)) continue;
        if (opts.scriptContext && ADJECTIVE_END.test(word)) continue;
        return word;
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
