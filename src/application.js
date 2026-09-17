import { Config } from './config.js';
import { AuditClient } from '@atc-web/service-core/audit';
import { Lifecycle } from '@atc-web/service-core/lifecycle';
import { readServiceVersion } from '@atc-web/service-core/fastify';
import { Database } from './db.js';
import { IpLookup } from './domain/ip-lookup.js';
import { Phone } from './domain/phone.js';
import { PlacesService } from './domain/places-service.js';
import { Reference } from './domain/reference.js';
import { GeoApi } from './http/geo-api.js';
import { CollectionStore } from './store/collection-store.js';
import { PlaceStore } from './store/place-store.js';

/** Composition root: wires configuration, reference data, IP databases, storage, domain and HTTP; owns the process lifecycle. */
export class Application {
  /** @param {Config} config */
  constructor(config) {
    this.config = config;
    this.version = readServiceVersion(import.meta.url);
    this.audit = new AuditClient({ target: config.audit });
    this.db = new Database(config.dbPath, { backupDir: config.dbBackupDir });
    this.reference = Reference.load();
    this.phone = new Phone(this.reference);
    this.ipLookup = new IpLookup({ reference: this.reference, paths: config });
    this.collections = new CollectionStore(this.db);
    this.placeStore = new PlaceStore(this.db);
    this.places = new PlacesService({ db: this.db, collections: this.collections, places: this.placeStore, options: config });
    /** @type {import('fastify').FastifyInstance|null} */
    this.app = null;
    /** @type {(reason: string) => Promise<void>} */
    this.shutdown = async () => {};
  }

  /** Build from `process.env`; exits with a readable message on bad configuration. */
  static fromEnv() {
    try {
      return new Application(Config.fromEnv());
    } catch (err) {
      if (err instanceof Error && err.name === 'ConfigError') {
        console.error(`configuration error: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  }

  async start() {
    const { config } = this;
    const api = new GeoApi({ config, audit: this.audit, ipLookup: this.ipLookup, reference: this.reference, phone: this.phone, places: this.places, collections: this.collections, placeStore: this.placeStore, db: this.db, version: this.version });
    const app = await api.build();
    this.app = app;
    this.ipLookup.logger = app.log;
    this.ipLookup.tryLoad();
    const { shutdown } = Lifecycle.install({
      forceExitMs: 30_000,
      log: app.log,
      steps: [
        () => this.app?.close(),
        () => this.audit.close(),
        () => this.db.close(),
      ],
    });
    this.shutdown = shutdown;
    // Not a shutdown step: reloads the IP database in place, independent of the lifecycle above.
    process.on('SIGHUP', () => { app.log.info('SIGHUP: reloading IP database'); this.ipLookup.tryLoad(); });
    this.audit.logger = app.log;
    this.audit.start();
    await app.listen({ port: config.port, host: config.host });
    app.log.info({ tls: config.tls !== null, countries: this.reference.all.length, ipDatabase: this.ipLookup.info().city?.type ?? null, collections: this.collections.all().length }, config.tls ? 'serving HTTPS' : 'serving plain HTTP, terminate TLS at a reverse proxy');
    if (process.send) process.send('ready'); // PM2 wait_ready
  }

}
