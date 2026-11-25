import { REGION_COUNTRIES } from '../../../shared/regions.ts';
import { unlistedCountryNamesRu } from '../../maps/country-names.ts';

/**
 * Place-name and demonym guard of the Detective play style. It checks the brain's requests before
 * they reach the eyes (a request that names a place is refused) and masks place words in what the
 * eyes write outside quoted text. It is a heuristic: country names and their stems from
 * shared/regions, the names of the small territories the point maps reach, irregular demonyms,
 * large cities and English demonyms. A demonym right next to
 * a script noun names a script the eyes can see («грузинское письмо», «арабская вязь») and passes.
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

/**
 * Words inside the names of small territories that are ordinary words, first names, or too
 * close to an ordinary word even as a whole («Сен-Мартен» and «в марте», «Сан-Марино» and
 * «марина», «Кокосовые о-ва» and «кокосовые пальмы»).
 */
const TERRITORY_NAME_SKIP = new Set([
  'внешние',
  'малые',
  'южные',
  'северные',
  'территории',
  'федеративные',
  'сент',
  'синт',
  'рождества',
  'елены',
  'пьер',
  'томе',
  'кабо',
  'кука',
  'саба',
  'мартен',
  'марино',
  'майен',
  'кокосовые',
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
  // The country is in no region, so no name stem covers its cases: «из Китая», «в Китае».
  'китая',
  'китае',
  'китаю',
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
const COMMON_WORDS = new Set([
  'того',
  'груз',
  'кана',
  'марок',
  'лесом',
  'лесок',
  // Spike 3, Part C: «косой» is not Kosovo, «кость» is not Costa Rica.
  'косой',
  'косого',
  'косому',
  'косом',
  'косое',
  'кость',
  'кости',
  'костей',
  'костра',
  // «суда» are ships, not Sudan.
  'суда',
  'судам',
  'судами',
  'судах',
  // «кайма» is an edging (of a road sign, say), not the Cayman Islands.
  'кайма',
  'каймам',
  'каймами',
  'каймах',
]);
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
  // Words of a scene description (spike 3). The frames are named by compass points, and a
  // compass adjective alone names no place: «Северная Корея» is still caught by «Корея».
  'северн',
  'восточн',
  'южн',
  'западн',
  'центральн',
  'катаф',
  'катал',
  'канат',
  'сахарн',
  'лесоп',
  'лесос',
  'россып',
  'туник',
  // Added before the first paid call of Part C, from the reports of Part B: «катакана» names a
  // script and was masked as Qatar; the others are scene words with a country's stem.
  'катакан',
  'катам',
  'катан',
  'костел',
  'костёл',
  'костыл',
  'белизн',
  'белил',
];

/** «камера» in any case is the camera; «Камерун» is still caught. */
const CAMERA = /^камер(а|ы|е|у|ой|ами|ах)?$/u;

function isCommonWord(word: string): boolean {
  return (
    COMMON_WORDS.has(word) || CAMERA.test(word) || COMMON_PREFIXES.some((p) => word.startsWith(p))
  );
}

const LETTERS = /[a-zа-яё]+/gu;
/** Zero-width characters, soft hyphens and the like: invisible, yet they split a word in two. */
const FORMAT_CHARS = /\p{Cf}/gu;

/** NFKC folds fullwidth and other compatibility letters into the plain ones the stems use. */
function plainLetters(text: string): string {
  return text.normalize('NFKC').replace(FORMAT_CHARS, '');
}

function words(text: string): string[] {
  return plainLetters(text).toLowerCase().match(LETTERS) ?? [];
}

function stemOf(word: string): string {
  return word.length <= 5 ? word.slice(0, 4) : word.slice(0, word.length - 2);
}

/**
 * Stem of a word from the name of a small territory. These names are short and sit close to
 * ordinary words («Самоа» and «самолёт», «Монако» and «монастырь», «Мальта» and «мальчик»), so
 * the stem keeps more of the word than `stemOf` does: all of a short word, all but the last
 * letter of a longer one.
 */
function territoryStemOf(word: string): string {
  return word.length <= 5 ? word : word.slice(0, -1);
}

function buildPlaceStems(): string[] {
  const stems = new Set<string>([...DEMONYM_STEMS, ...CITY_STEMS, ...LATIN_STEMS]);
  for (const country of REGION_COUNTRIES) {
    for (const word of words(country.nameRu)) {
      if (word.length < 4 || GENERIC_NAME_WORDS.has(word)) continue;
      stems.add(stemOf(word));
    }
  }
  // The point maps reach countries the regions dataset has no polygon for.
  for (const name of unlistedCountryNamesRu()) {
    for (const word of words(name)) {
      if (word.length < 4 || GENERIC_NAME_WORDS.has(word) || TERRITORY_NAME_SKIP.has(word))
        continue;
      stems.add(territoryStemOf(word));
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

/** What `maskPlaceWords` puts in place of a place word. */
export const PLACE_MASK = '[…]';

const QUOTED = /«[^»]*»/gu;

function cutWord(text: string, word: string): string {
  return text.replace(new RegExp(`(?<![a-zа-яё])${word}(?![a-zа-яё])`, 'giu'), PLACE_MASK);
}

function maskSegment(guard: PlaceGuard, segment: string, masked: string[]): string {
  let out = segment;
  // Each pass masks every occurrence of one word, so the text loses a word until none is left.
  for (;;) {
    const word = guard.findPlaceWord(out);
    if (word === null) return out;
    masked.push(word);
    let next = cutWord(out, word);
    if (next === out) {
      // The word was written with invisible or fullwidth characters: cut it from the plain form.
      const plain = plainLetters(out);
      next = cutWord(plain, word);
      // Still there: the segment is dropped rather than passed on with the name in it.
      if (next === plain) return PLACE_MASK;
    }
    out = next;
  }
}

/**
 * Masks place names and demonyms in a text the eyes wrote in their own words (spike 3). Text
 * inside «…» is copied from the scene and stays as it is.
 */
export function maskPlaceWords(
  guard: PlaceGuard,
  text: string,
): { text: string; masked: string[] } {
  const masked: string[] = [];
  let out = '';
  let last = 0;
  for (const match of text.matchAll(QUOTED)) {
    out += maskSegment(guard, text.slice(last, match.index), masked) + match[0];
    last = match.index + match[0].length;
  }
  out += maskSegment(guard, text.slice(last), masked);
  return { text: out, masked };
}
