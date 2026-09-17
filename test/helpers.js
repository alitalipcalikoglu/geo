import { readFileSync } from 'node:fs';
import { Config } from '../src/config.js';
import { Database } from '../src/db.js';
import { IpLookup } from '../src/domain/ip-lookup.js';
import { Phone } from '../src/domain/phone.js';
import { PlacesService } from '../src/domain/places-service.js';
import { Reference } from '../src/domain/reference.js';
import { MmdbReader } from '../src/geo/mmdb.js';
import { GeoApi } from '../src/http/geo-api.js';
import { CollectionStore } from '../src/store/collection-store.js';
import { PlaceStore } from '../src/store/place-store.js';
import { asnDatabase, cityDatabase } from './mmdb-writer.js';

export const RW_KEY = 'k'.repeat(40);
export const READ_KEY = 'r'.repeat(40);
export const WRITE_KEY = 'w'.repeat(40);

/** @param {Record<string, string>} [overrides] */
export function testEnv(overrides = {}) {
  return {
    PORT: '0',
    GEO_API_KEYS: `console:${RW_KEY},site:${READ_KEY}:read,loader:${WRITE_KEY}:write`,
    DB_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    MMDB_PATH: 'city.mmdb',
    ASN_MMDB_PATH: 'asn.mmdb',
    MAX_BATCH: '3',
    MAX_POINTS: '6',
    ...overrides,
  };
}

/** @param {Record<string, string>} [overrides] */
export function testConfig(overrides) {
  return Config.fromEnv(testEnv(overrides));
}

/** In-memory MMDB "files" by name. @param {string} path */
export function openTestMmdb(path) {
  if (path === 'city.mmdb') return new MmdbReader(cityDatabase(), { path, sizeBytes: 1234, mtimeMs: Date.parse('2026-09-01T00:00:00Z') });
  if (path === 'asn.mmdb') return new MmdbReader(asnDatabase(), { path });
  throw new Error(`ENOENT: no such file, open '${path}'`);
}

export const reference = Reference.load();

/** The service's own version, as `readServiceVersion` would resolve it in production. */
export const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** Wired domain objects over an in-memory database with a fixed clock. @param {Record<string, string>} [overrides] */
export function testService(overrides) {
  const config = testConfig(overrides);
  const clock = { t: Date.parse('2026-09-17T10:00:00Z') };
  const db = new Database(':memory:');
  const collections = new CollectionStore(db);
  const placeStore = new PlaceStore(db);
  const places = new PlacesService({ db, collections, places: placeStore, options: config, now: () => clock.t });
  const ipLookup = new IpLookup({ reference, paths: config, open: openTestMmdb });
  ipLookup.tryLoad();
  return { config, db, collections, placeStore, places, ipLookup, reference, phone: new Phone(reference), clock, version };
}

/** Fully wired Fastify app. @param {Record<string, string>} [overrides] @param {object} [deps] Extra constructor deps, e.g. an AuditClient. */
export async function buildApp(overrides, deps = {}) {
  const t = testService(overrides);
  const app = await new GeoApi({ ...t, ...deps, logger: /** @type {any} */ ({ info() {}, warn() {}, error() {}, fatal() {}, debug() {}, trace() {}, child() { return this; } }) }).build();
  await app.ready();
  return { app, ...t };
}

/** @param {string} key */
export function bearer(key) {
  return { authorization: `Bearer ${key}` };
}

/** Istanbul-area sample places. @type {import('../src/types.js').PlaceInput[]} */
export const BRANCHES = [
  { id: 'kadikoy', name: 'Kadıköy', lat: 40.9903, lng: 29.0252, attrs: { type: 'store', parking: true } },
  { id: 'besiktas', name: 'Beşiktaş', lat: 41.0422, lng: 29.0067, attrs: { type: 'store', parking: false } },
  { id: 'taksim', name: 'Taksim', lat: 41.0370, lng: 28.9850, attrs: { type: 'locker' } },
  { id: 'ankara', name: 'Ankara Kızılay', lat: 39.9208, lng: 32.8541, attrs: { type: 'store' } },
];
