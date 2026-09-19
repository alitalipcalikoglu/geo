import { readFileSync } from 'node:fs';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { AuditClient } from '@atc-web/service-core/audit';
import { createErrorHandler, jsonParser, registerInfo, registerOpenApi, registerProbes, registerRequestContext, requestOptions } from '@atc-web/service-core/fastify';
import { GeoError } from '../domain/errors.js';
import { PlacesService } from '../domain/places-service.js';
import { Reference } from '../domain/reference.js';
import { GeoPoint } from '../geo/geo-point.js';
import { ApiKeyAuth } from './api-key-auth.js';
import { Schemas } from './schemas.js';
import { Views } from './views.js';

/** @typedef {import('../config.js').Config} Config */
/** @typedef {import('fastify').FastifyInstance} FastifyInstance */
/** @typedef {import('fastify').FastifyRequest} FastifyRequest */

/** HTTP surface: lookups and reference data (read role), collections, places and database reload (write). */
export class GeoApi {
  static READY_CACHE_MS = 10_000;

  /**
   * @param {object} deps
   * @param {Config} deps.config
   * @param {import('../domain/ip-lookup.js').IpLookup} deps.ipLookup
   * @param {import('../domain/reference.js').Reference} deps.reference
   * @param {import('../domain/phone.js').Phone} deps.phone
   * @param {import('../domain/places-service.js').PlacesService} deps.places
   * @param {import('../store/collection-store.js').CollectionStore} deps.collections
   * @param {import('../store/place-store.js').PlaceStore} deps.placeStore
   * @param {import('../db.js').Database} deps.db
   * @param {string} deps.version
   * @param {import('../types.js').Logger} [deps.logger]
   * @param {import('@atc-web/service-core/audit').AuditClient} [deps.audit]
   */
  constructor({ config, audit, ipLookup, reference, phone, places, collections, placeStore, db, version, logger }) {
    this.config = config;
    this.audit = audit;
    this.ipLookup = ipLookup;
    this.reference = reference;
    this.phone = phone;
    this.places = places;
    this.collections = collections;
    this.placeStore = placeStore;
    this.db = db;
    this.version = version;
    this.logger = logger;
    this.auth = new ApiKeyAuth(config.apiKeys);
    /** @type {() => void} Set once `build()` registers the probes. */
    this.invalidateReady = () => {};
  }

  /** @returns {Promise<FastifyInstance>} */
  async build() {
    const { config } = this;
    const app = Fastify({
      ...(config.tls ? { https: { cert: readFileSync(config.tls.certPath), key: readFileSync(config.tls.keyPath), minVersion: 'TLSv1.2' } } : {}),
      ...requestOptions({ logger: this.logger, logLevel: config.logLevel }),
      trustProxy: config.trustProxy,
      bodyLimit: config.bodyLimit,
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    registerRequestContext(app, { trustProxy: config.trustProxy });
    app.decorateRequest('apiKey', /** @type {any} */ (null));
    jsonParser(app);
    app.setErrorHandler(createErrorHandler(GeoError));
    app.addHook('onSend', AuditClient.hook(this.audit));
    app.setNotFoundHandler((_request, reply) => {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'route not found' } });
    });
    app.addHook('onSend', async (_request, reply) => {
      reply.header('x-content-type-options', 'nosniff');
      reply.header('cache-control', 'no-store');
    });
    const { invalidate } = registerProbes(app, () => {
      this.db.ping();
      if (this.ipLookup.paths.mmdbPath && !this.ipLookup.available) throw new Error(`IP database not loaded: ${this.ipLookup.loadError ?? 'unknown'}`);
    }, { cacheMs: GeoApi.READY_CACHE_MS });
    this.invalidateReady = invalidate;
    registerOpenApi(app, new URL('../../openapi.yaml', import.meta.url));
    registerInfo(app, {
      service: 'geo',
      version: this.version,
      capabilities: ['ip-lookup', 'phone-normalize', 'distance', 'place-search', 'manual-reload'],
      schemaVersion: this.db.schemaVersion,
    });
    await app.register((api) => this.#registerV1(api), { prefix: '/v1' });
    await app.register((ops) => this.#registerMetrics(ops));
    return app;
  }


  /** @param {FastifyInstance} api */
  async #registerV1(api) {
    api.addHook('onRequest', this.auth.hook);
    await api.register(rateLimit, {
      max: this.config.rateLimitMax,
      timeWindow: '1 minute',
      keyGenerator: (request) => request.apiKey.id,
      errorResponseBuilder: (_request, context) => Object.assign(new Error(`rate limit exceeded, retry in ${context.after}`), { statusCode: 429, code: 'RATE_LIMITED' }),
    });
    const ref = this.reference;
    const read = { preValidation: ApiKeyAuth.require('read') };
    const write = { preValidation: ApiKeyAuth.require('write') };
    const query = (/** @type {FastifyRequest} */ r) => /** @type {Record<string, string|undefined>} */ (r.query);
    const lang = (/** @type {FastifyRequest} */ r, /** @type {string} */ fromBody = '') => Reference.lang(fromBody || query(r).lang, this.config.defaultLang);
    const name = (/** @type {FastifyRequest} */ r) => /** @type {{ name: string }} */ (r.params).name;
    const batch = (/** @type {unknown[]} */ items) => { if (items.length > this.config.maxBatch) throw new GeoError('BATCH_TOO_LARGE', `at most ${this.config.maxBatch} items per batch`); };
    const attempt = (/** @type {() => unknown} */ fn) => { try { return { ok: true, result: fn() }; } catch (err) { if (err instanceof GeoError) return { ok: false, error: { code: err.code, message: err.message } }; throw err; } };

    // ---- ip
    api.get('/ip/self', { ...read, schema: { querystring: Schemas.langQuery } }, async (request) => this.ipLookup.lookup(request.ip, lang(request)));
    api.get('/ip/:ip', { ...read, schema: { params: Schemas.ipParams, querystring: Schemas.langQuery } }, async (request) => this.ipLookup.lookup(/** @type {{ ip: string }} */ (request.params).ip, lang(request)));
    api.post('/ip/batch', { ...read, schema: { body: Schemas.ipBatch } }, async (request) => {
      const b = /** @type {{ ips: string[], lang?: string }} */ (request.body);
      batch(b.ips);
      const l = lang(request, b.lang);
      return { items: b.ips.map((ip) => ({ ip, ...attempt(() => this.ipLookup.lookup(ip, l)) })) };
    });
    api.get('/database', read, async () => this.ipLookup.info());
    api.post('/database/reload', { config: { audit: AuditClient.route('geo.database.reload', () => null, (_r, b) => ({ type: b?.city?.type ?? null })) }, ...write }, async () => {
      const outcome = this.ipLookup.reload();
      this.invalidateReady(); // force the next /ready to re-check rather than serve a cached verdict from before the reload
      if (!outcome.ok) throw new GeoError('DATABASE_RELOAD_FAILED', `IP database failed to reload: ${outcome.error}`);
      return this.ipLookup.info();
    });

    // ---- reference
    api.get('/countries', { ...read, schema: { querystring: Schemas.countriesQuery } }, async (request) => {
      const q = query(request);
      return { items: ref.countries({ q: q.q, continent: q.continent, eu: q.eu === undefined ? undefined : q.eu === 'true', currency: q.currency }, lang(request)) };
    });
    api.get('/countries/:code', { ...read, schema: { params: Schemas.codeParams, querystring: Schemas.langQuery } }, async (request) => ({ country: ref.countryView(ref.requireCountry(/** @type {{ code: string }} */ (request.params).code), lang(request)) }));
    api.get('/currencies', { ...read, schema: { querystring: Schemas.langQuery } }, async (request) => ({ items: ref.currencies(lang(request)) }));
    api.get('/currencies/:code', { ...read, schema: { params: Schemas.codeParams, querystring: Schemas.langQuery } }, async (request) => ({ currency: ref.currency(/** @type {{ code: string }} */ (request.params).code, lang(request)) }));
    api.get('/timezones', { ...read, schema: { querystring: Schemas.timezonesQuery } }, async (request) => { const q = query(request); return { items: ref.timezones({ country: q.country, q: q.q }, Date.now(), lang(request)) }; });
    api.get('/timezones/*', { ...read, schema: { querystring: Schemas.langQuery } }, async (request) => ({ timezone: ref.timezone(/** @type {{ '*': string }} */ (request.params)['*'], Date.now(), lang(request)) }));
    api.get('/phone', { ...read, schema: { querystring: Schemas.phoneQuery } }, async (request) => { const q = query(request); return this.phone.normalize(/** @type {string} */ (q.number), { country: q.country }); });
    api.post('/phone/batch', { ...read, schema: { body: Schemas.phoneBatch } }, async (request) => {
      const b = /** @type {{ numbers: string[], country?: string }} */ (request.body);
      batch(b.numbers);
      return { items: b.numbers.map((number) => ({ number, ...attempt(() => this.phone.normalize(number, { country: b.country })) })) };
    });
    api.get('/distance', { ...read, schema: { querystring: Schemas.distanceQuery } }, async (request) => {
      const q = query(request);
      const from = GeoPoint.parse(/** @type {string} */ (q.from));
      const to = GeoPoint.parse(/** @type {string} */ (q.to));
      const km = GeoPoint.distanceKm(from, to);
      return { from, to, km: Math.round(km * 1000) / 1000, m: Math.round(km * 1000), mi: Math.round(km * 0.621371 * 1000) / 1000, bearing: Math.round(GeoPoint.bearing(from, to) * 10) / 10 };
    });

    // ---- places
    const view = (/** @type {import('../types.js').CollectionRow} */ c, /** @type {Map<string, number>} */ counts) => Views.collection(c, counts.get(c.name) ?? 0);
    api.get('/collections', read, async () => { const counts = this.collections.counts(); return { items: this.collections.all().map((c) => view(c, counts)) }; });
    api.post('/collections', { config: { audit: AuditClient.route('geo.collection.create', (_r, b) => ({ type: 'collection', id: b.collection.name })) }, ...write, schema: { body: Schemas.createCollection } }, async (request, reply) => {
      const row = this.places.createCollection(/** @type {any} */ (request.body), request.apiKey.id);
      reply.header('location', `/v1/collections/${row.name}`);
      return reply.code(201).send({ collection: Views.collection(row, 0) });
    });
    api.get('/collections/:name', { ...read, schema: { params: Schemas.nameParams } }, async (request) => ({ collection: view(this.collections.require(name(request)), this.collections.counts()) }));
    api.patch('/collections/:name', { config: { audit: AuditClient.route('geo.collection.update', (r) => ({ type: 'collection', id: /** @type {any} */ (r.params).name }), (r) => ({ patch: r.body })) }, ...write, schema: { params: Schemas.nameParams, body: Schemas.patchCollection } }, async (request) => ({ collection: view(this.places.updateCollection(name(request), /** @type {any} */ (request.body)), this.collections.counts()) }));
    api.delete('/collections/:name', { config: { audit: AuditClient.route('geo.collection.delete', (r) => ({ type: 'collection', id: /** @type {any} */ (r.params).name })) }, ...write, schema: { params: Schemas.nameParams } }, async (request, reply) => { this.places.removeCollection(name(request)); return reply.code(204).send(); });
    api.post('/collections/:name/clear', { config: { audit: AuditClient.route('geo.collection.clear', (r) => ({ type: 'collection', id: /** @type {any} */ (r.params).name }), (_r, b) => ({ removed: b?.removed })) }, ...write, schema: { params: Schemas.nameParams } }, async (request) => ({ removed: this.places.clear(name(request)) }));
    api.put('/collections/:name/places', { config: { audit: AuditClient.route('geo.places.upsert', (r) => ({ type: 'collection', id: /** @type {any} */ (r.params).name }), (_r, b) => ({ created: b?.created, updated: b?.updated })) }, ...write, schema: { params: Schemas.nameParams, body: Schemas.upsertPlaces } }, async (request) => this.places.upsert(name(request), /** @type {{ places: any[] }} */ (request.body).places));
    api.get('/collections/:name/places', { ...read, schema: { params: Schemas.nameParams, querystring: Schemas.listQuery } }, async (request) => {
      const q = query(request);
      const n = name(request);
      this.collections.require(n);
      const limit = Number(q.limit ?? 50);
      const offset = Number(q.offset ?? 0);
      return { items: this.placeStore.list(n, limit, offset).map(PlacesService.view), total: this.placeStore.count(n), limit, offset };
    });
    api.get('/collections/:name/places/:id', { ...read, schema: { params: Schemas.placeParams } }, async (request) => ({ place: PlacesService.view(this.places.get(name(request), /** @type {{ id: string }} */ (request.params).id)) }));
    api.delete('/collections/:name/places/:id', { config: { audit: AuditClient.route('geo.place.delete', (r) => ({ type: 'place', id: /** @type {any} */ (r.params).id }), (r) => ({ collection: /** @type {any} */ (r.params).name })) }, ...write, schema: { params: Schemas.placeParams } }, async (request, reply) => { this.places.remove(name(request), /** @type {{ id: string }} */ (request.params).id); return reply.code(204).send(); });
    api.get('/collections/:name/nearby', { ...read, schema: { params: Schemas.nameParams, querystring: Schemas.nearbyQuery } }, async (request) => {
      const q = query(request);
      /** @type {Record<string, string>} */ const filter = {};
      for (const [k, v] of Object.entries(q)) if (k.startsWith('filter.') && v !== undefined) filter[k.slice(7)] = v;
      return this.places.nearby(name(request), GeoPoint.validate(q.lat, q.lng), { radiusKm: q.radius ? Number(q.radius) : undefined, limit: q.limit ? Number(q.limit) : undefined, filter });
    });

    api.get('/stats', read, async () => {
      const counts = this.collections.counts();
      const items = this.collections.all().map((c) => view(c, counts));
      return { database: this.ipLookup.info(), countries: ref.all.length, collections: items.length, places: this.placeStore.total(), dbBytes: this.db.sizeBytes(), items: items.map((c) => ({ name: c.name, places: c.places, updatedAt: c.updatedAt })) };
    });
  }

  /** @param {FastifyInstance} ops */
  #registerMetrics(ops) {
    ops.addHook('onRequest', this.auth.hook);
    ops.get('/metrics', { logLevel: 'warn', preValidation: ApiKeyAuth.require('read') }, async (_request, reply) => {
      const info = this.ipLookup.info();
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return [
        '# HELP geo_ip_lookups_total IP lookups since process start, by result (hit, miss, special).',
        '# TYPE geo_ip_lookups_total counter',
        ...Object.entries(info.lookups).map(([k, v]) => `geo_ip_lookups_total{result="${k}"} ${v}`),
        '# HELP geo_database_loaded 1 when an IP database is loaded.',
        '# TYPE geo_database_loaded gauge',
        `geo_database_loaded ${info.loaded ? 1 : 0}`,
        '# HELP geo_database_build_epoch Build time of the loaded IP database, seconds since epoch (0 when none).',
        '# TYPE geo_database_build_epoch gauge',
        `geo_database_build_epoch ${info.city?.buildEpoch ?? 0}`,
        '# HELP geo_collections Place collections.',
        '# TYPE geo_collections gauge',
        `geo_collections ${this.collections.all().length}`,
        '# HELP geo_places_total Places in every collection.',
        '# TYPE geo_places_total gauge',
        `geo_places_total ${this.placeStore.total()}`,
        '# HELP geo_db_bytes Database size.',
        '# TYPE geo_db_bytes gauge',
        `geo_db_bytes ${this.db.sizeBytes()}`,
        '# HELP geo_process_uptime_seconds Process uptime.',
        '# TYPE geo_process_uptime_seconds gauge',
        `geo_process_uptime_seconds ${process.uptime().toFixed(0)}`,
        '',
      ].join('\n');
    });
  }
}
