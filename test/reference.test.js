import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeoError } from '../src/domain/errors.js';
import { Phone } from '../src/domain/phone.js';
import { Reference } from '../src/domain/reference.js';
import { GeoPoint } from '../src/geo/geo-point.js';
import { reference as ref } from './helpers.js';

test('Reference: table is complete and consistent', () => {
  assert.equal(ref.all.length, 249);
  for (const c of ref.all) {
    assert.match(c.alpha2, /^[A-Z]{2}$/); assert.match(c.alpha3, /^[A-Z]{3}$/); assert.match(c.numeric, /^\d{3}$/);
    assert.ok(Reference.CONTINENTS[c.continent], `${c.alpha2} continent`);
    for (const z of c.timezones) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: z }), `${c.alpha2} zone ${z}`);
    assert.notEqual(ref.name('region', c.alpha2, 'en'), c.alpha2, `${c.alpha2} has an ICU name`);
    if (c.currency) assert.notEqual(ref.name('currency', c.currency, 'en'), c.currency, `${c.alpha2} currency ${c.currency} has an ICU name`);
  }
  assert.equal(ref.all.filter((c) => c.eu).length, 27);
});

test('Reference: countries by any code, localized names, filters and search', () => {
  const tr = ref.countryView(ref.requireCountry('tur'), 'tr');
  assert.deepEqual([tr.code, tr.alpha3, tr.numeric, tr.name, tr.continent.code, tr.callingCodes, tr.currency, tr.timezones, tr.flag, tr.eu], ['TR', 'TUR', '792', 'Türkiye', 'AS', ['+90'], { code: 'TRY', name: 'Türk lirası' }, ['Europe/Istanbul'], '🇹🇷', false]);
  assert.equal(ref.country('276')?.alpha2, 'DE');
  assert.equal(ref.country('20')?.alpha2, 'AD', 'numeric codes are zero-padded');
  assert.throws(() => ref.requireCountry('ZZ'), (e) => e instanceof GeoError && e.code === 'COUNTRY_NOT_FOUND');
  assert.deepEqual(ref.countries({ q: 'türk' }, 'en').map((c) => c.code), ['TR', 'TM', 'TC'], 'accent and dotless i folded');
  assert.deepEqual(ref.countries({ q: 'deu' }, 'en').map((c) => c.code), ['DE'], 'alpha-3 prefix');
  assert.equal(ref.countries({ continent: 'eu', eu: true }, 'en').length, 27);
  assert.deepEqual(ref.countries({ currency: 'xof' }, 'en').map((c) => c.code), ['BJ', 'BF', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG']);
  assert.equal(ref.countries({}, 'de')[0].name, 'Afghanistan');
});

test('Reference: currencies and time zones through Intl', () => {
  assert.deepEqual(ref.currency('try', 'en'), { code: 'TRY', name: 'Turkish Lira', symbol: 'TRY', decimals: 2, countries: ['TR'] });
  assert.deepEqual([ref.currency('JPY', 'en').decimals, ref.currency('BHD', 'en').decimals, ref.currency('EUR', 'de').symbol], [0, 3, '€']);
  assert.throws(() => ref.currency('XYZ', 'en'), (e) => e instanceof GeoError && e.code === 'CURRENCY_NOT_FOUND');
  assert.ok(ref.currencies('en').length > 150);
  const winter = Date.UTC(2026, 0, 15, 12);
  const summer = Date.UTC(2026, 6, 15, 12);
  const ny = ref.timezone('America/New_York', summer, 'en');
  assert.deepEqual([ny.offset, ny.offsetMinutes, ny.abbreviation, ny.dst, ny.observesDst, ny.localTime, ny.countries], ['-04:00', -240, 'EDT', true, true, '2026-07-15T08:00:00', ['US']]);
  assert.deepEqual([ref.timezone('America/New_York', winter, 'en').offset, ref.timezone('America/New_York', winter, 'en').dst], ['-05:00', false]);
  assert.deepEqual([ref.timezone('europe/istanbul', summer, 'tr').offset, ref.timezone('Europe/Istanbul', summer, 'tr').observesDst], ['+03:00', false]);
  assert.equal(ref.timezone('Asia/Kolkata', summer, 'en').offset, '+05:30');
  assert.equal(ref.timezone('Europe/Kiev', summer, 'en').name, 'Europe/Kiev', 'aliases resolve');
  assert.throws(() => ref.timezone('Mars/Olympus', summer, 'en'), (e) => e instanceof GeoError && e.code === 'TIMEZONE_NOT_FOUND');
  assert.deepEqual(ref.timezones({ country: 'pt' }, summer, 'en').map((z) => z.name), ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores']);
  assert.ok(ref.timezones({ q: 'istanbul' }, summer, 'en').length === 1);
  assert.deepEqual(ref.timezones({}, summer, 'en').length > 400, true);
  assert.equal(Reference.formatOffset(-570), '-09:30');
});

test('Phone: E.164 normalisation and country resolution', () => {
  const p = new Phone(ref);
  assert.deepEqual(p.normalize('+90 (532) 123 45 67'), { input: '+90 (532) 123 45 67', e164: '+905321234567', valid: true, reason: null, country: 'TR', countries: ['TR'], callingCode: '+90', national: '5321234567' });
  assert.deepEqual([p.normalize('0532 123 45 67', { country: 'tr' }).e164, p.normalize('00 90 532 123 45 67').e164, p.normalize('532-123-4567', { country: 'TR' }).e164], ['+905321234567', '+905321234567', '+905321234567']);
  const us = p.normalize('+1 212 555 0100');
  assert.deepEqual([us.country, us.countries.slice(0, 2), us.callingCode, us.national], ['US', ['US', 'CA'], '+1', '2125550100']);
  assert.deepEqual([p.normalize('(212) 555-0100', { country: 'US' }).e164, p.normalize('1 212 555 0100', { country: 'US' }).e164, p.normalize('011 44 20 7946 0958', { country: 'US' }).e164], ['+12125550100', '+12125550100', '+442079460958']);
  assert.deepEqual([p.normalize('+1 268 555 0100').country, p.normalize('+1 809 555 0100').country, p.normalize('+7 495 123 4567').country, p.normalize('+7 495 123 4567', { country: 'KZ' }).country], ['AG', 'DO', 'RU', 'KZ']);
  assert.deepEqual([p.normalize('+44 1481 700000').country, p.normalize('+44 1481 700000', { country: 'gg' }).country], ['GB', 'GG']);
  const short = p.normalize('+90 12');
  assert.deepEqual([short.valid, short.reason, short.e164], [false, 'E.164 numbers have 8 to 15 digits', '+9012']);
  assert.deepEqual([p.normalize('+999 123 4567').valid, p.normalize('+999 123 4567').reason], [false, 'unknown calling code']);
  assert.deepEqual([p.normalize('532 123 45 67').valid, p.normalize('532 123 45 67').reason], [false, 'no country and no international prefix']);
  assert.throws(() => p.normalize('+90 532 ABC'), (e) => e instanceof GeoError && e.code === 'INVALID_PHONE');
  assert.throws(() => p.normalize('   '), (e) => e instanceof GeoError && e.code === 'INVALID_PHONE');
  assert.throws(() => p.normalize('123', { country: 'ZZ' }), (e) => e instanceof GeoError && e.code === 'COUNTRY_NOT_FOUND');
});

test('GeoPoint: validation, distance, bearing, bounding box', () => {
  const ist = { lat: 41.0082, lng: 28.9784 };
  const ank = { lat: 39.9334, lng: 32.8597 };
  assert.equal(Math.round(GeoPoint.distanceKm(ist, ank)), 349);
  assert.equal(Math.round(GeoPoint.bearing(ist, ank)), 109);
  assert.equal(GeoPoint.distanceKm(ist, ist), 0);
  assert.deepEqual(GeoPoint.parse(' 41.0082 , 28.9784 '), ist);
  for (const bad of ['91,0', '0,181', 'x,y', '1,2,3']) assert.throws(() => GeoPoint.parse(bad), (e) => e instanceof GeoError && e.code === 'INVALID_COORDINATES');
  const box = GeoPoint.boundingBox(ist, 10);
  assert.ok(box.minLat < ist.lat && box.maxLat > ist.lat && box.maxLat - box.minLat < 0.2 && box.maxLng - box.minLng > box.maxLat - box.minLat);
  assert.deepEqual(GeoPoint.boundingBox({ lat: 89.9, lng: 0 }, 100).maxLng, 180, 'near the pole the box spans every longitude');
});
