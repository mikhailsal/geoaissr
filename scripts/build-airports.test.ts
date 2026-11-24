import { expect, test } from 'bun:test';
import { buildAirports, parseCsv } from './build-airports.ts';

test('parseCsv keeps commas, doubled quotes and line breaks inside quoted fields', () => {
  expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([
    ['a', 'b'],
    ['x, y', 'say "hi"\nthere'],
  ]);
});

test('buildAirports keeps large and medium airports with scheduled service', () => {
  const csv = [
    '"id","type","name","latitude_deg","longitude_deg","iso_country","scheduled_service"',
    '1,"large_airport","Big, International",55.972599,37.4146,"RU","yes"',
    '2,"medium_airport","Regional",59.800301,30.262501,"RU","yes"',
    '3,"medium_airport","No flights",10,10,"NG","no"',
    '4,"small_airport","Grass strip",20,20,"US","yes"',
    '5,"heliport","Roof",30,30,"US","yes"',
    '6,"large_airport","Broken row",not-a-number,40,"FR","yes"',
  ].join('\n');
  const data = buildAirports(csv);
  expect(data.airports).toEqual({
    RU: [
      [55.9726, 37.4146],
      [59.8003, 30.2625],
    ],
  });
});

test('buildAirports reports a missing column by name', () => {
  expect(() => buildAirports('"id","type"\n1,"large_airport"\n')).toThrow('latitude_deg');
});
