import { expect, test } from 'bun:test';
import { createPlaceGuard, maskPlaceWords } from './guard.ts';

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
