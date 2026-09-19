import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BRANCHES, READ_KEY, RW_KEY, WRITE_KEY, bearer, buildApp } from './helpers.js';

const json = (/** @type {import('light-my-request').Response} */ r) => JSON.parse(r.body);
const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('API: probes, auth and roles', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/ready' })).statusCode, 200);
  const spec = await app.inject({ url: '/openapi.yaml' });
  assert.equal(spec.body, readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
  assert.match(String(spec.headers['content-type']), /^text\/yaml/);
  assert.equal((await app.inject({ url: '/v1/countries' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/countries', headers: bearer(WRITE_KEY) })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/collections', headers: bearer(READ_KEY), payload: { name: 'a' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/database/reload', headers: bearer(READ_KEY) })).statusCode, 403);
  assert.equal((await app.inject({ url: '/metrics', headers: bearer(WRITE_KEY) })).statusCode, 403);
  assert.equal((await app.inject({ url: '/v1/nope', headers: bearer(RW_KEY) })).statusCode, 404);
});

test('API: readiness reflects a database that failed to load', async (t) => {
  const { app } = await buildApp({ MMDB_PATH: 'missing.mmdb' });
  t.after(() => app.close());
  const res = await app.inject({ url: '/ready' });
  assert.equal(res.statusCode, 503);
  assert.match(json(res).error, /IP database not loaded/);
  assert.equal((await app.inject({ url: '/v1/ip/8.8.8.8', headers: bearer(READ_KEY) })).statusCode, 503);
  assert.equal(json(await app.inject({ url: '/v1/ip/10.0.0.1', headers: bearer(READ_KEY) })).kind, 'private');
  const none = await buildApp({ MMDB_PATH: '', ASN_MMDB_PATH: '' });
  t.after(() => none.app.close());
  assert.equal((await none.app.inject({ url: '/ready' })).statusCode, 200, 'no database configured is a valid setup');
});

test('API: ip lookups, batch, self, database info and reload', async (t) => {
  const { app, ipLookup } = await buildApp();
  t.after(() => app.close());
  let res = await app.inject({ url: '/v1/ip/81.5.6.7?lang=tr', headers: bearer(READ_KEY) });
  assert.equal(res.statusCode, 200, res.body);
  let d = json(res);
  assert.deepEqual([d.ip, d.found, d.country.code, d.country.name, d.city.name, d.location.lat, d.timezone, d.asn.number], ['81.5.6.7', true, 'TR', 'Türkiye', 'İstanbul', 41.0138, 'Europe/Istanbul', 9121]);
  assert.equal((await app.inject({ url: '/v1/ip/81.5.6.7?lang=xx!', headers: bearer(READ_KEY) })).statusCode, 400, 'bad language tag rejected by schema');
  assert.equal(json(await app.inject({ url: '/v1/ip/81.5.6.7?lang=zz-ZZ', headers: bearer(READ_KEY) })).city.name, 'Istanbul', 'unknown but well-formed tag falls back to English');
  assert.equal((await app.inject({ url: '/v1/ip/300.1.1.1', headers: bearer(READ_KEY) })).statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/v1/ip/batch', headers: bearer(READ_KEY), payload: { ips: ['8.8.8.8', 'bad', '9.9.9.9'] } });
  d = json(res);
  assert.deepEqual([d.items[0].result.country.code, d.items[1].ok, d.items[1].error.code, d.items[2].result.found], ['US', false, 'INVALID_IP', false]);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/ip/batch', headers: bearer(READ_KEY), payload: { ips: ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'] } })).statusCode, 413);
  res = await app.inject({ url: '/v1/ip/self', headers: bearer(READ_KEY), remoteAddress: '81.9.9.9' });
  assert.equal(json(res).country.code, 'TR');
  res = await app.inject({ url: '/v1/database', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).loaded, json(res).city.type, json(res).city.builtAt, json(res).asn.type, json(res).lookups.hit], [true, 'Test-City', '2025-10-09T08:53:20.000Z', 'Test-ASN', 4]);
  ipLookup.paths = { mmdbPath: 'missing.mmdb', asnMmdbPath: '' };
  res = await app.inject({ method: 'POST', url: '/v1/database/reload', headers: bearer(WRITE_KEY) });
  assert.equal(res.statusCode, 409, 'a failed reload is reported, not an opaque 500');
  assert.deepEqual([json(res).error.code, json(res).error.message.includes('ENOENT') || json(res).error.message.includes('missing.mmdb')], ['DATABASE_RELOAD_FAILED', true]);
  assert.equal(json(await app.inject({ url: '/v1/ip/81.5.6.7', headers: bearer(READ_KEY) })).found, true, 'previous database still serves');
  res = await app.inject({ url: '/v1/database', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).loaded, json(res).error !== null, json(res).city.type], [true, true, 'Test-City'], 'the failure is recorded, but the previous city reader is still the one reported as loaded');
  ipLookup.paths = { mmdbPath: 'city.mmdb', asnMmdbPath: '' };
  res = await app.inject({ method: 'POST', url: '/v1/database/reload', headers: bearer(WRITE_KEY) });
  assert.deepEqual([res.statusCode, json(res).asn, json(res).error], [200, null, null], 'a subsequent successful reload clears the recorded error');
});

test('API: reference data, phone and distance', async (t) => {
  const { app } = await buildApp({ DEFAULT_LANG: 'tr' });
  t.after(() => app.close());
  let res = await app.inject({ url: '/v1/countries?q=alm', headers: bearer(READ_KEY) });
  assert.deepEqual(json(res).items.map((/** @type {any} */ c) => [c.code, c.name]), [['DE', 'Almanya']], 'default language applies');
  assert.equal(json(await app.inject({ url: '/v1/countries?continent=EU&eu=true', headers: bearer(READ_KEY) })).items.length, 27);
  assert.equal((await app.inject({ url: '/v1/countries?continent=XX', headers: bearer(READ_KEY) })).statusCode, 400);
  res = await app.inject({ url: '/v1/countries/tur?lang=en', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).country.name, json(res).country.callingCodes], ['Türkiye', ['+90']]);
  assert.equal((await app.inject({ url: '/v1/countries/zz', headers: bearer(READ_KEY) })).statusCode, 404);
  res = await app.inject({ url: '/v1/currencies/eur?lang=en', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).currency.name, json(res).currency.decimals, json(res).currency.countries.includes('DE')], ['Euro', 2, true]);
  assert.ok(json(await app.inject({ url: '/v1/currencies', headers: bearer(READ_KEY) })).items.length > 150);
  res = await app.inject({ url: '/v1/timezones/Europe/Istanbul?lang=en', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).timezone.name, json(res).timezone.offset, json(res).timezone.countries], ['Europe/Istanbul', '+03:00', ['TR']]);
  assert.equal((await app.inject({ url: '/v1/timezones/Nowhere/City', headers: bearer(READ_KEY) })).statusCode, 404);
  assert.deepEqual(json(await app.inject({ url: '/v1/timezones?country=nz', headers: bearer(READ_KEY) })).items.map((/** @type {any} */ z) => z.name), ['Pacific/Auckland', 'Pacific/Chatham']);
  res = await app.inject({ url: '/v1/phone?number=' + encodeURIComponent('0532 123 45 67') + '&country=TR', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).e164, json(res).valid, json(res).country], ['+905321234567', true, 'TR']);
  assert.equal((await app.inject({ url: '/v1/phone?number=%2B90%20ABC', headers: bearer(READ_KEY) })).statusCode, 400);
  res = await app.inject({ method: 'POST', url: '/v1/phone/batch', headers: bearer(READ_KEY), payload: { numbers: ['+1 212 555 0100', 'x'], country: 'US' } });
  assert.deepEqual([json(res).items[0].result.e164, json(res).items[1].ok], ['+12125550100', false]);
  res = await app.inject({ url: '/v1/distance?from=41.0082,28.9784&to=39.9334,32.8597', headers: bearer(READ_KEY) });
  assert.deepEqual([Math.round(json(res).km), json(res).bearing, typeof json(res).mi], [349, 108.7, 'number']);
  assert.equal((await app.inject({ url: '/v1/distance?from=99,0&to=0,0', headers: bearer(READ_KEY) })).statusCode, 400);
});

test('API: collections, places, nearby, stats, metrics', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  let res = await app.inject({ method: 'POST', url: '/v1/collections', headers: bearer(WRITE_KEY), payload: { name: 'branches', description: 'Stores' } });
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual([res.headers.location, json(res).collection.places, json(res).collection.createdBy], ['/v1/collections/branches', 0, 'loader']);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/collections', headers: bearer(WRITE_KEY), payload: { name: 'branches' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/collections', headers: bearer(WRITE_KEY), payload: { name: 'Bad Name' } })).statusCode, 400);
  res = await app.inject({ method: 'PUT', url: '/v1/collections/branches/places', headers: bearer(WRITE_KEY), payload: { places: BRANCHES } });
  assert.deepEqual([res.statusCode, json(res)], [200, { created: 4, updated: 0, total: 4 }]);
  res = await app.inject({ method: 'PUT', url: '/v1/collections/branches/places', headers: bearer(WRITE_KEY), payload: { places: [{ id: 'x', name: 'X', lat: 95, lng: 0 }] } });
  assert.deepEqual([res.statusCode, json(res).error.code, json(res).error.details], [400, 'INVALID_PLACE', { index: 0 }]);
  assert.equal((await app.inject({ method: 'PUT', url: '/v1/collections/branches/places', headers: bearer(WRITE_KEY), payload: { places: [{ id: 'x', name: 'X', lat: 1, lng: 1, extra: 1 }] } })).statusCode, 400);
  res = await app.inject({ url: '/v1/collections/branches/places?limit=2&offset=1', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).total, json(res).items.map((/** @type {any} */ p) => p.id)], [4, ['besiktas', 'kadikoy']]);
  assert.equal(json(await app.inject({ url: '/v1/collections/branches/places/taksim', headers: bearer(READ_KEY) })).place.attrs.type, 'locker');
  res = await app.inject({ url: '/v1/collections/branches/nearby?lat=41.0082&lng=28.9784&radius=10&limit=2&filter.type=store', headers: bearer(READ_KEY) });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual([json(res).total, json(res).items.map((/** @type {any} */ p) => p.id), json(res).items[0].distanceKm > 4], [2, ['kadikoy', 'besiktas'], true]);
  assert.equal((await app.inject({ url: '/v1/collections/branches/nearby?lat=41&lng=28&radius=9999', headers: bearer(READ_KEY) })).statusCode, 400);
  assert.equal((await app.inject({ url: '/v1/collections/branches/nearby?lng=28', headers: bearer(READ_KEY) })).statusCode, 400);
  assert.equal((await app.inject({ url: '/v1/collections/nope/nearby?lat=41&lng=28', headers: bearer(READ_KEY) })).statusCode, 404);
  res = await app.inject({ method: 'PATCH', url: '/v1/collections/branches', headers: bearer(WRITE_KEY), payload: { description: 'Stores and lockers' } });
  assert.deepEqual([json(res).collection.description, json(res).collection.places], ['Stores and lockers', 4]);
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/collections/branches/places/ankara', headers: bearer(WRITE_KEY) })).statusCode, 204);
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/collections/branches/places/ankara', headers: bearer(WRITE_KEY) })).statusCode, 404);
  res = await app.inject({ url: '/v1/stats', headers: bearer(READ_KEY) });
  assert.deepEqual([json(res).countries, json(res).collections, json(res).places, json(res).database.loaded, json(res).items[0].name], [249, 1, 3, true, 'branches']);
  const metrics = await app.inject({ url: '/metrics', headers: bearer(READ_KEY) });
  assert.match(metrics.body, /geo_places_total 3\n/);
  assert.match(metrics.body, /geo_database_loaded 1\n/);
  assert.deepEqual(json(await app.inject({ method: 'POST', url: '/v1/collections/branches/clear', headers: { ...bearer(WRITE_KEY), 'content-type': 'application/json' } })), { removed: 3 });
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/collections/branches', headers: bearer(WRITE_KEY) })).statusCode, 204);
  assert.equal((await app.inject({ url: '/v1/collections/branches', headers: bearer(READ_KEY) })).statusCode, 404);
});

test('API: /v1/info', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const res = await app.inject({ url: '/v1/info' });
  assert.equal(res.statusCode, 200);
  const body = json(res);
  assert.equal(typeof body.schemaVersion, 'number');
  assert.equal(typeof body.serviceCore, 'string');
  assert.deepEqual(body, {
    service: 'geo',
    version: pkgVersion,
    apiVersion: 'v1',
    capabilities: ['ip-lookup', 'phone-normalize', 'distance', 'place-search', 'manual-reload'],
    schemaVersion: body.schemaVersion,
    serviceCore: body.serviceCore,
  });
});
