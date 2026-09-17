import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeoError } from '../src/domain/errors.js';
import { BRANCHES, testService } from './helpers.js';

test('IpLookup: normalised results, special ranges, ASN, misses, reload failures', () => {
  const { ipLookup } = testService();
  const tr = ipLookup.lookup('81.5.6.7', 'tr');
  assert.deepEqual([tr.found, tr.kind, tr.network, tr.country?.code, tr.country?.name, tr.country?.callingCodes, tr.region, tr.city, tr.postal, tr.location, tr.timezone, tr.asn, tr.source], [true, 'public', '81.5.6.7/8', 'TR', 'Türkiye', ['+90'], { code: '34', name: 'İstanbul' }, { name: 'İstanbul' }, '34000', { lat: 41.0138, lng: 28.9497, accuracyKm: 50 }, 'Europe/Istanbul', { number: 9121, organization: 'Turk Telekom', network: '81.5.6.7/8' }, 'Test-City']);
  assert.equal(ipLookup.lookup('81.5.6.7', 'en').city?.name, 'Istanbul');
  assert.equal(ipLookup.lookup('81.5.6.7', 'de').city?.name, 'Istanbul', 'unknown language falls back to English');
  const priv = ipLookup.lookup('10.1.2.3', 'en');
  assert.deepEqual([priv.found, priv.kind, priv.country, priv.asn], [false, 'private', null, null]);
  const miss = ipLookup.lookup('9.9.9.9', 'en');
  assert.deepEqual([miss.found, miss.kind, miss.country, miss.source], [false, 'public', null, 'Test-City']);
  const ru = ipLookup.lookup('2a02:6b8::2:242', 'en');
  assert.deepEqual([ru.network, ru.country?.code, ru.city?.name, ru.continent?.code, ru.timezone], ['2a02:6b8::2:242/32', 'RU', 'Moscow', 'EU', 'Europe/Moscow']);
  assert.equal(ipLookup.lookup('2001:4860::8888', 'en').timezone, null, 'no zone in data and several zones for the country');
  assert.throws(() => ipLookup.lookup('not-an-ip', 'en'), (e) => e instanceof GeoError && e.code === 'INVALID_IP');
  assert.deepEqual(ipLookup.info().lookups, { hit: 5, miss: 1, special: 1 });
  assert.deepEqual([ipLookup.info().loaded, ipLookup.info().city?.type, ipLookup.info().asn?.type], [true, 'Test-City', 'Test-ASN']);

  const broken = testService({ MMDB_PATH: 'missing.mmdb' });
  assert.deepEqual([broken.ipLookup.available, broken.ipLookup.info().error?.startsWith('ENOENT')], [false, true]);
  assert.throws(() => broken.ipLookup.lookup('8.8.8.8', 'en'), (e) => e instanceof GeoError && e.code === 'DATABASE_UNAVAILABLE');
  assert.equal(broken.ipLookup.lookup('127.0.0.1', 'en').kind, 'loopback', 'classification needs no database');
  const none = testService({ MMDB_PATH: '', ASN_MMDB_PATH: '' });
  assert.deepEqual([none.ipLookup.info().configured, none.ipLookup.info().loaded], [false, false]);
  assert.throws(() => none.ipLookup.lookup('8.8.8.8', 'en'), /MMDB_PATH/);
  ipLookup.paths = { mmdbPath: 'missing.mmdb', asnMmdbPath: '' };
  assert.throws(() => ipLookup.load(), /ENOENT/);
  assert.equal(ipLookup.available, true, 'failed reload keeps the previous database');
});

test('PlacesService: collections, all-or-nothing upserts, nearby with filters and limits', () => {
  const { places, placeStore, collections, clock } = testService();
  places.createCollection({ name: 'branches', description: 'Stores and lockers' }, 'loader');
  assert.throws(() => places.createCollection({ name: 'branches' }, 'loader'), (e) => e instanceof GeoError && e.code === 'COLLECTION_EXISTS');
  assert.deepEqual(places.upsert('branches', BRANCHES), { created: 4, updated: 0, total: 4 });
  clock.t += 1000;
  assert.deepEqual(places.upsert('branches', [{ ...BRANCHES[0], name: 'Kadıköy Merkez' }]), { created: 0, updated: 1, total: 4 });
  assert.equal(places.get('branches', 'kadikoy').name, 'Kadıköy Merkez');
  assert.throws(() => places.upsert('branches', [{ id: 'a', name: 'A', lat: 1, lng: 1 }, { id: 'a', name: 'B', lat: 1, lng: 1 }]), (e) => e instanceof GeoError && e.code === 'INVALID_PLACE' && /twice/.test(e.message));
  assert.throws(() => places.upsert('branches', [{ id: 'x', name: 'X', lat: 91, lng: 1 }]), (e) => e instanceof GeoError && e.code === 'INVALID_PLACE' && e.details?.index === 0);
  assert.throws(() => places.upsert('branches', [{ id: 'y', name: ' ', lat: 1, lng: 1 }]), /empty name/);
  assert.throws(() => places.upsert('branches', [{ id: 'p5', name: 'P5', lat: 1, lng: 1 }, { id: 'p6', name: 'P6', lat: 1, lng: 1 }, { id: 'p7', name: 'P7', lat: 1, lng: 1 }]), (e) => e instanceof GeoError && e.code === 'BATCH_TOO_LARGE');
  assert.equal(placeStore.count('branches'), 4, 'failed batch left nothing behind');
  assert.throws(() => places.upsert('nope', BRANCHES), (e) => e instanceof GeoError && e.code === 'COLLECTION_NOT_FOUND');

  const from = { lat: 41.0082, lng: 28.9784 }; // Sultanahmet
  const near = places.nearby('branches', from, { radiusKm: 10 });
  assert.deepEqual([near.total, near.items.map((p) => p.id), near.items[0].distanceKm < 4, near.items[0].bearing], [3, ['taksim', 'kadikoy', 'besiktas'], true, 10]);
  assert.deepEqual(places.nearby('branches', from, { radiusKm: 10, filter: { type: 'store', parking: 'true' } }).items.map((p) => p.id), ['kadikoy']);
  assert.deepEqual(places.nearby('branches', from, { radiusKm: 10, limit: 1 }).items.map((p) => p.id), ['taksim']);
  assert.equal(places.nearby('branches', from, { radiusKm: 500 }).total, 4);
  assert.equal(places.nearby('branches', { lat: 0, lng: 179.9 }, { radiusKm: 50 }).total, 0, 'antimeridian box splits without error');
  assert.throws(() => places.nearby('branches', from, { radiusKm: 501 }), (e) => e instanceof GeoError && e.code === 'INVALID_COORDINATES');

  places.remove('branches', 'ankara');
  assert.throws(() => places.remove('branches', 'ankara'), (e) => e instanceof GeoError && e.code === 'PLACE_NOT_FOUND');
  assert.equal(places.clear('branches'), 3);
  places.upsert('branches', BRANCHES.slice(0, 1));
  places.removeCollection('branches');
  assert.deepEqual([collections.all().length, placeStore.total()], [0, 0], 'cascade');
});
