import { expect, test } from 'bun:test';
import { PLACE_MASK, createPlaceGuard, maskPlaceWords } from './guard.ts';

const guard = createPlaceGuard();

test('the guard blocks country names, their stems, demonyms and demonym script names', () => {
  expect(guard.findPlaceWord('надпись про Россию')).toBe('россию');
  expect(guard.findPlaceWord('индийская вывеска')).toBe('индийская');
  expect(guard.findPlaceWord('русский текст на щите')).toBe('русский');
  expect(guard.findPlaceWord('японская вывеска')).toBe('японская');
  expect(guard.findPlaceWord('грузинская надпись')).toBe('грузинская');
  expect(guard.findPlaceWord('тайская вывеска')).toBe('тайская');
  expect(guard.findPlaceWord('тамильская надпись')).toBe('тамильская');
});

test('the guard lets ordinary sign requests through', () => {
  for (const text of [
    'самая крупная вывеска',
    'номер машины слева',
    'дорожный знак впереди',
    'надпись на здании справа',
    'текст на автобусе',
    'табличка с номером дома',
    'номер грузовика',
    'маленькая табличка у двери',
    'после того знака',
    'кириллица на щите',
    'надпись на новой вывеске',
    'указатели и таблички с названиями',
    'почва и обочины: цвет',
    'дорожная разметка: цвет осевой и краевых линий',
  ]) {
    expect(guard.findPlaceWord(text)).toBeNull();
  }
});

test('the guard blocks large cities and English names, and lets script names through', () => {
  expect(guard.findPlaceWord('похоже на Париж')).toBe('париж');
  expect(guard.findPlaceWord('такси как в Нью-Йорке')).toBe('нью');
  expect(guard.findPlaceWord('Japanese sign')).toBe('japanese');
  expect(guard.findPlaceWord('английский текст')).toBe('английский');
  for (const text of [
    'грузинское письмо',
    'арабская вязь',
    'японская кана',
    'корейский хангыль',
    'Thai script',
    'канава у дороги',
    'индикаторы на светофоре',
    'пользуются ли мотоциклами',
  ]) {
    expect(guard.findPlaceWord(text)).toBeNull();
  }
});

test('a place word in the eyes own words is masked; copied text in «…» is kept', () => {
  const res = maskPlaceWords(guard, 'Японские дома и вывеска «Токио банк», рядом флаг Японии');
  expect(res.text).toBe('[…] дома и вывеска «Токио банк», рядом флаг […]');
  expect(res.masked).toEqual(['японские', 'японии']);
  expect(maskPlaceWords(guard, '«Добро пожаловать в Тбилиси»').masked).toEqual([]);
});

test('script names and ordinary scene words are not masked', () => {
  for (const text of [
    'вывеска: арабская вязь и латиница',
    'на северном кадре лесополоса, за лесом россыпь камней',
    'катафоты на столбиках, тень от камеры на асфальте',
    'плантация сахарного тростника, несколько марок машин',
    'канатная дорога на западном склоне',
    'надпись катаканой на вывеске, косой навес, рядом костёл с белёной стеной',
    'у причала стоят суда, на берегу следы костра',
    'Сторона движения: правая — машины стоят вдоль правого края',
    'Солнце: на юге, высоко',
    'Дорога идёт: на север и на юг; на севере видны дома',
  ]) {
    expect(maskPlaceWords(guard, text)).toEqual({ text, masked: [] });
  }
  expect(maskPlaceWords(guard, 'табличка как в Камеруне').masked).toEqual(['камеруне']);
  expect(maskPlaceWords(guard, 'Северная Корея').text).toBe('Северная […]');
});

// Value: protects=a long report cannot carry place names past the mask; fails_when=the mask stops after a fixed number of words and returns the rest in clear; why_new=the loop gave up after twenty passes; seam=none; no_claim=names the stem list does not know.
test('every place word of a long text is masked, however many there are', () => {
  const names = [
    'Японии, России, Индии, Франции, Германии, Италии, Испании, Польши, Швеции, Норвегии',
    'Финляндии, Греции, Турции, Египта, Кении, Бразилии, Аргентины, Чили, Перу, Мексики',
    'Канады, Австралии, Таиланда, Вьетнама, Монголии, Китая',
  ]
    .join(', ')
    .split(', ');
  expect(names.length).toBeGreaterThan(20);
  const res = maskPlaceWords(guard, `дома как в: ${names.join(', ')}.`);
  expect(res.text).toBe(`дома как в: ${names.map(() => '[…]').join(', ')}.`);
  expect(res.masked).toHaveLength(names.length);
});

// Value: protects=a place name written with invisible or fullwidth characters is still caught; fails_when=a zero-width space, a soft hyphen or fullwidth letters carry a name to the brain; why_new=the guard matched plain letters only; seam=none; no_claim=lookalike letters of another alphabet and scripts other than Latin and Cyrillic (TODOS.md).
test('invisible characters and fullwidth letters do not hide a place name', () => {
  expect(guard.findPlaceWord('флаг Япо\u200bнии')).toBe('японии');
  expect(guard.findPlaceWord('надпись Ｊａｐａｎ')).toBe('japan');
  expect(maskPlaceWords(guard, 'флаг Япо\u200bнии на доме').text).toBe('флаг […] на доме');
  expect(maskPlaceWords(guard, 'флаг Япо\u00adнии, вывеска Ｒｕｓｓｉａ').text).toBe(
    'флаг […], вывеска […]',
  );
  // Copied text keeps its place: only the eyes' own words are masked.
  expect(maskPlaceWords(guard, 'дома как в Япо\u200bнии, вывеска «Токио банк»').text).toBe(
    'дома как в […], вывеска «Токио банк»',
  );
  expect(guard.findPlaceWord('как в Китае')).toBe('китае');
});

// Value: protects=the guard catches the island and city states the point maps reach, in the cases a sentence uses; fails_when=the names of countries without a polygon stop feeding the guard;
// why_new=the guard only knew the countries of the regions dataset, and the airports and capitals maps go beyond it; seam=none; no_claim=names of cities and airports themselves
test('the guard blocks the small states and territories of the point maps', () => {
  expect(guard.findPlaceWord('похоже на Сингапур')).toBe('сингапур');
  expect(guard.findPlaceWord('вывеска как на Мальте')).toBe('мальте');
  expect(guard.findPlaceWord('такси как в Гонконге')).toBe('гонконге');
  expect(guard.findPlaceWord('пляж как на Мальдивах')).toBe('мальдивах');
  expect(guard.findPlaceWord('это Монако')).toBe('монако');
  expect(guard.findPlaceWord('остров Маврикий')).toBe('маврикий');
  expect(guard.findPlaceWord('номера как в Бахрейне')).toBe('бахрейне');
  expect(guard.findPlaceWord('андоррский флаг')).toBe('андоррский');
  expect(guard.findPlaceWord('флаг Самоа')).toBe('самоа');
  expect(guard.findPlaceWord('Каймановы острова')).toBe('каймановы');
});

// Value: protects=a territory whose every word is too ordinary to block alone is still blocked when written whole, and masked in what the eyes write; fails_when=the brain can name San Marino or Christmas Island to its partner word for word;
// why_new=the territory names were matched word by word only, and these names have no word of their own; seam=none; no_claim=every spelling of a name (the dictionary form and its cases)
test('the guard blocks a territory name made of ordinary words when it is written whole', () => {
  expect(guard.findPlaceWord('флаг Сан-Марино')).toBe('марино');
  expect(guard.findPlaceWord('похоже на Сен-Мартен')).toBe('мартен');
  expect(guard.findPlaceWord('аэропорт Синт-Мартена')).toBe('мартена');
  expect(guard.findPlaceWord('это остров Рождества')).toBe('рождества');
  expect(guard.findPlaceWord('пляж на островах Кука')).toBe('кука');
  expect(guard.findPlaceWord('остров Святой Елены')).toBe('елены');
  expect(guard.findPlaceWord('номера как на острове Мэн')).toBe('мэн');
  expect(guard.findPlaceWord('Кокосовые острова')).toBe('кокосовые');
  expect(maskPlaceWords(guard, 'вывеска, как в Сан-Марино').text).toBe(
    `вывеска, как в Сан-${PLACE_MASK}`,
  );
  for (const text of ['остров на реке', 'праздник Рождества', 'сан у священника', 'мэн в шляпе']) {
    expect(guard.findPlaceWord(text)).toBeNull();
  }
});

// Value: protects=a territory name is caught in the short spelling the dataset itself uses; fails_when=only the full words are matched, so «о-в Мэн» reaches the eyes and comes back unmasked;
// why_new=the whole-name match expanded the dictionary side only; seam=none; no_claim=other ways to shorten a name (the dataset's own spelling)
test('the guard blocks a territory name in the short spelling of the dataset', () => {
  expect(guard.findPlaceWord('номера как на о-в Мэн')).toBe('мэн');
  expect(guard.findPlaceWord('Кокосовые о-ва')).toBe('кокосовые');
  expect(guard.findPlaceWord('флаг о-ва Кука')).toBe('кука');
  expect(maskPlaceWords(guard, 'паром на о-в Мэн').text).toBe(`паром на о-в ${PLACE_MASK}`);
  for (const text of ['о-в на реке', 'вид на о-ва', 'мэн в шляпе']) {
    expect(guard.findPlaceWord(text)).toBeNull();
  }
});

// Value: protects=ordinary words that start like a small territory's name still pass; fails_when=the territory stems get as short as the country stems and mask scene words;
// why_new=the territory names are new to the guard; seam=none; no_claim=every word of the language (the listed ones)
test('ordinary words that look like a small territory pass the guard', () => {
  for (const text of [
    'самолёт над полем',
    'монастырь на холме',
    'мальчик у дороги',
    'в сентябре и в марте',
    'кокосовые пальмы',
    'красная кайма на знаке',
    'знаки с белыми каймами',
    'пристань и марина',
    'комод, тумба и стул',
    'внешние стены и малые окна',
    'южные и северные склоны',
  ]) {
    expect(guard.findPlaceWord(text)).toBeNull();
  }
});
