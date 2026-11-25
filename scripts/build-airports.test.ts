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
  const data = buildAirports(csv, 0);
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

// Value: protects=rows with a bad country code or out-of-range coordinates never reach the dataset; fails_when=either guard is removed;
// why_new=the existing fixture only drops rows by type, service and non-numeric coordinates; seam=none; no_claim=real OurAirports data (inline CSV)
test('buildAirports drops rows with a bad country code or out-of-range coordinates', () => {
  const csv = [
    '"id","type","name","latitude_deg","longitude_deg","iso_country","scheduled_service"',
    '1,"large_airport","Good",10,20,"de","yes"',
    '2,"large_airport","Three letters",11,21,"DEU","yes"',
    '3,"large_airport","No country",12,22,"","yes"',
    '4,"large_airport","Bad latitude",91,23,"FR","yes"',
    '5,"large_airport","Bad longitude",13,181,"FR","yes"',
  ].join('\n');
  expect(buildAirports(csv, 0).airports).toEqual({ DE: [[10, 20]] });
});

// Value: protects=the generator rejects an empty download and keeps a last row without a newline; fails_when=the empty check or the final flush is removed;
// why_new=existing tests always end the CSV with data followed by no check of the tail; seam=none; no_claim=real OurAirports data (inline CSV)
test('buildAirports fails on an empty CSV and parseCsv keeps a last row without a newline', () => {
  expect(() => buildAirports('')).toThrow('OurAirports CSV is empty');
  expect(parseCsv('a,b\n1,2')).toEqual([
    ['a', 'b'],
    ['1', '2'],
  ]);
});

// Value: protects=a row with a blank latitude or longitude is skipped instead of becoming 0; fails_when=the blank-text check is removed;
// why_new=the existing fixture only has a non-numeric coordinate, not a blank one; seam=none; no_claim=real OurAirports data (inline CSV)
test('buildAirports skips rows with a blank latitude or longitude', () => {
  const csv = [
    '"id","type","name","latitude_deg","longitude_deg","iso_country","scheduled_service"',
    '1,"large_airport","Good",10,20,"DE","yes"',
    '2,"large_airport","Blank latitude",,21,"DE","yes"',
    '3,"large_airport","Blank longitude",12,,"DE","yes"',
  ].join('\n');
  expect(buildAirports(csv, 0).airports).toEqual({ DE: [[10, 20]] });
});

// Value: protects=a download with far too few airports is rejected under the default threshold; fails_when=the minimum check is removed;
// why_new=every other test passes a zero threshold; seam=none; no_claim=real OurAirports data (inline CSV)
test('buildAirports throws when the result is smaller than the default minimum', () => {
  const csv = [
    '"id","type","name","latitude_deg","longitude_deg","iso_country","scheduled_service"',
    '1,"large_airport","Good",10,20,"DE","yes"',
  ].join('\n');
  expect(() => buildAirports(csv)).toThrow('expected at least 2000');
  expect(() => buildAirports(csv, 2)).toThrow('1 usable airports');
});

// Value: protects=a CSV cut inside a quoted field is reported instead of parsed silently; fails_when=the unterminated-quote check is removed;
// why_new=no existing test feeds an unterminated quote; seam=none; no_claim=real OurAirports data (inline CSV)
test('parseCsv throws on a CSV that ends inside a quoted field', () => {
  expect(() => parseCsv('a,b\n1,"unfinished')).toThrow('quoted field');
});
