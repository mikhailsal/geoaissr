import { expect, test } from 'bun:test';
import { createPlaceGuard, placeNamesIn } from './guard.ts';

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
  ]) {
    expect(guard.findPlaceWord(text)).toBeNull();
  }
});

test('place names in a transcription are found in Russian and in Latin script', () => {
  expect(placeNamesIn('Добро пожаловать в Японию')).toEqual([]);
  expect(placeNamesIn('Сделано в Японии, Франция')).toContain('Франция');
  expect(placeNamesIn('WELCOME TO BANGKOK')).toEqual(['bangkok']);
  expect(placeNamesIn('KEEP CLEAR')).toEqual([]);
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
