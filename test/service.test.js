import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GeoError } from '../src/domain/errors.js';
import { IpLookup } from '../src/domain/ip-lookup.js';
import { MmdbReader } from '../src/geo/mmdb.js';
import { BRANCHES, openTestMmdb, reference, testService } from './helpers.js';
import { cityDatabase } from './mmdb-writer.js';

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
  // reload() is the non-throwing form the HTTP route uses: it must report the outcome instead of
  // letting the caller find out only through a thrown error, and must still keep serving.
  const outcome = ipLookup.reload();
  assert.deepEqual([outcome.ok, outcome.error?.startsWith('ENOENT'), ipLookup.info().error?.startsWith('ENOENT'), ipLookup.available], [false, true, true, true]);
  ipLookup.paths = { mmdbPath: 'city.mmdb', asnMmdbPath: '' };
  const recovered = ipLookup.reload();
  assert.deepEqual([recovered.ok, recovered.error, ipLookup.info().error], [true, null, null], 'a successful reload clears the recorded error');
});

test('IpLookup: load-time validation rejects a candidate whose validation lookup throws, keeping the previous database serving', () => {
  const { ipLookup } = testService();
  const before = ipLookup.info();

  // A reader that opens "fine" (metadata decodes) but blows up on the fixed-IP validation lookup,
  // like a database whose node table or data section is corrupted past what metadata alone reveals.
  const brokenOpen = (/** @type {string} */ path) => {
    if (path !== 'broken.mmdb') return openTestMmdb(path);
    return { info: () => ({ type: 'Broken' }), lookup: () => { throw new Error('corrupted node table'); } };
  };
  ipLookup.open = /** @type {any} */ (brokenOpen);
  ipLookup.paths = { mmdbPath: 'broken.mmdb', asnMmdbPath: '' };
  const rejected = ipLookup.reload();
  assert.equal(rejected.ok, false);
  assert.match(rejected.error ?? '', /failed validation/);
  assert.deepEqual(ipLookup.info().city, before.city, 'the previous, still-good database keeps serving');
  assert.equal(ipLookup.info().error, rejected.error, 'info() reports the validation failure, not a half-applied new database');
  assert.equal(ipLookup.available, true);

  // A later good reload is not blocked by the earlier rejection.
  ipLookup.open = openTestMmdb;
  ipLookup.paths = { mmdbPath: 'city.mmdb', asnMmdbPath: '' };
  const recovered = ipLookup.reload();
  assert.deepEqual([recovered.ok, recovered.error, ipLookup.info().error], [true, null, null]);
});

test('IpLookup: checksum verification via MMDB_SHA256 and a sha256sum-format sidecar file, with the env var taking precedence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-mmdb-checksum-'));
  const path = join(dir, 'city.mmdb');
  const bytes = cityDatabase();
  writeFileSync(path, bytes);
  const goodHash = createHash('sha256').update(bytes).digest('hex');
  const badHash = '0'.repeat(64);
  try {
    const none = new IpLookup({ reference, paths: { mmdbPath: path, asnMmdbPath: '' }, open: MmdbReader.open });
    assert.deepEqual([none.reload().ok, none.available], [true, true], 'neither env var nor sidecar configured: no checksum-related failure');

    const goodEnv = new IpLookup({ reference, paths: { mmdbPath: path, asnMmdbPath: '', mmdbSha256: goodHash }, open: MmdbReader.open });
    assert.deepEqual([goodEnv.reload().ok, goodEnv.available], [true, true]);

    const badEnv = new IpLookup({ reference, paths: { mmdbPath: path, asnMmdbPath: '', mmdbSha256: badHash }, open: MmdbReader.open });
    const badOutcome = badEnv.reload();
    assert.deepEqual([badOutcome.ok, badEnv.available], [false, false]);
    assert.match(badOutcome.error ?? '', /checksum mismatch/);
    assert.match(badOutcome.error ?? '', new RegExp(goodHash), 'reports the actual digest for operators to compare');

    writeFileSync(`${path}.sha256`, `${goodHash}  city.mmdb\n`);
    const sidecarGood = new IpLookup({ reference, paths: { mmdbPath: path, asnMmdbPath: '' }, open: MmdbReader.open });
    assert.equal(sidecarGood.reload().ok, true, 'sidecar file in sha256sum format is honoured when no env var is set');

    writeFileSync(`${path}.sha256`, `${badHash}  city.mmdb\n`);
    const sidecarBad = new IpLookup({ reference, paths: { mmdbPath: path, asnMmdbPath: '' }, open: MmdbReader.open });
    assert.equal(sidecarBad.reload().ok, false);

    const precedence = new IpLookup({ reference, paths: { mmdbPath: path, asnMmdbPath: '', mmdbSha256: goodHash }, open: MmdbReader.open });
    assert.equal(precedence.reload().ok, true, 'MMDB_SHA256 is checked instead of the (mismatching) sidecar when both are present');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
