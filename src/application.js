import { Config } from './config.js';
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
    this.db = new Database(config.dbPath);
    this.reference = Reference.load();
    this.phone = new Phone(this.reference);
    this.ipLookup = new IpLookup({ reference: this.reference, paths: config });
    this.collections = new CollectionStore(this.db);
    this.placeStore = new PlaceStore(this.db);
    this.places = new PlacesService({ db: this.db, collections: this.collections, places: this.placeStore, options: config });
    /** @type {import('fastify').FastifyInstance|null} */
    this.app = null;
    this.shuttingDown = false;
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
    const api = new GeoApi({ config, ipLookup: this.ipLookup, reference: this.reference, phone: this.phone, places: this.places, collections: this.collections, placeStore: this.placeStore, db: this.db });
    const app = await api.build();
    this.app = app;
    this.ipLookup.logger = app.log;
    this.ipLookup.tryLoad();
    this.#installSignalHandlers(app.log);
    await app.listen({ port: config.port, host: config.host });
    app.log.info({ tls: config.tls !== null, countries: this.reference.all.length, ipDatabase: this.ipLookup.info().city?.type ?? null, collections: this.collections.all().length }, config.tls ? 'serving HTTPS' : 'serving plain HTTP, terminate TLS at a reverse proxy');
    if (process.send) process.send('ready'); // PM2 wait_ready
  }

  /** @param {string} reason */
  async shutdown(reason) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const log = /** @type {import('./types.js').Logger} */ (this.app?.log ?? console);
    log.info({ reason }, 'shutting down');
    const forceExit = setTimeout(() => {
      log.error('shutdown timed out, exiting');
      process.exit(1);
    }, 30_000).unref();
    try {
      await this.app?.close();
      this.db.close();
      clearTimeout(forceExit);
      log.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  }

  /** @param {import('./types.js').Logger} log */
  #installSignalHandlers(log) {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGHUP', () => { log.info('SIGHUP: reloading IP database'); this.ipLookup.tryLoad(); });
    process.on('unhandledRejection', (reason) => {
      log.fatal({ err: reason }, 'unhandled rejection');
      this.shutdown('unhandledRejection');
    });
    process.on('uncaughtException', (err) => {
      log.fatal({ err }, 'uncaught exception');
      process.exit(1);
    });
  }
}
