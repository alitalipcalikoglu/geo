import { ConfigError, EnvReader, parseApiKeys, parseAudit } from '@atc-web/service-core/config';

/** @typedef {import('./types.js').ApiKey} ApiKey */
/** @typedef {import('./types.js').KeyRole} KeyRole */

export { ConfigError };

/** Validated service configuration. Build with {@link Config.fromEnv}. */
export class Config {
  static MIN_SECRET_LENGTH = 32;
  static ROLES = ['read', 'write', 'readwrite'];

  /** @param {import('./types.js').ConfigValues} v */
  constructor(v) {
    this.port = v.port;
    this.host = v.host;
    this.logLevel = v.logLevel;
    this.trustProxy = v.trustProxy;
    this.tls = v.tls;
    this.audit = v.audit;
    this.bodyLimit = v.bodyLimit;
    this.dbPath = v.dbPath;
    this.dbBackupDir = v.dbBackupDir;
    this.mmdbPath = v.mmdbPath;
    this.asnMmdbPath = v.asnMmdbPath;
    this.mmdbSha256 = v.mmdbSha256;
    this.asnMmdbSha256 = v.asnMmdbSha256;
    this.apiKeys = v.apiKeys;
    this.rateLimitMax = v.rateLimitMax;
    this.maxBatch = v.maxBatch;
    this.maxPoints = v.maxPoints;
    this.maxRadiusKm = v.maxRadiusKm;
    this.defaultLang = v.defaultLang;
    Object.freeze(this);
  }

  /**
   * @param {NodeJS.ProcessEnv} [env]
   * @returns {Config}
   */
  static fromEnv(env = process.env) {
    const r = new EnvReader(env);

    const certPath = r.optional('TLS_CERT_PATH');
    const keyPath = r.optional('TLS_KEY_PATH');
    if (Boolean(certPath) !== Boolean(keyPath)) throw new ConfigError('TLS_CERT_PATH and TLS_KEY_PATH must be set together');

    return new Config({
      port: r.integer('PORT', 3012, { min: 0, max: 65535 }),
      host: r.optional('HOST') || '0.0.0.0',
      logLevel: r.optional('LOG_LEVEL') || 'info',
      trustProxy: r.boolean('TRUST_PROXY', false),
      tls: certPath ? { certPath, keyPath } : null,
      audit: parseAudit(r),
      bodyLimit: r.integer('BODY_LIMIT', 2_097_152, { min: 1_024 }),
      dbPath: r.optional('DB_PATH') || './data/geo.db',
      dbBackupDir: r.optional('DB_BACKUP_DIR') || undefined,
      mmdbPath: r.optional('MMDB_PATH'),
      asnMmdbPath: r.optional('ASN_MMDB_PATH'),
      mmdbSha256: Config.#parseSha256(r.optional('MMDB_SHA256'), 'MMDB_SHA256'),
      asnMmdbSha256: Config.#parseSha256(r.optional('ASN_MMDB_SHA256'), 'ASN_MMDB_SHA256'),
      apiKeys: Config.#parseApiKeys(r.required('GEO_API_KEYS')),
      rateLimitMax: r.integer('RATE_LIMIT_MAX', 3_000, { min: 1 }),
      maxBatch: r.integer('MAX_BATCH', 100, { min: 1, max: 1_000 }),
      maxPoints: r.integer('MAX_POINTS', 5_000, { min: 1, max: 100_000 }),
      maxRadiusKm: r.integer('MAX_RADIUS_KM', 500, { min: 1, max: 20_000 }),
      defaultLang: Config.#parseLang(r.optional('DEFAULT_LANG') || 'en'),
    });
  }

  /**
   * Parse `id:secret[:role]`. Role defaults to `readwrite`.
   * @param {string} raw
   * @returns {ApiKey[]}
   */
  static #parseApiKeys(raw) {
    return parseApiKeys(raw, 'GEO_API_KEYS', { roles: Config.ROLES, minSecretLength: Config.MIN_SECRET_LENGTH })
      .map(({ id, secret, role }) => ({ id, secret, role: /** @type {KeyRole} */ (role) }));
  }

  /** Optional 64-hex-char SHA-256 digest, lower-cased; empty string means "not configured". @param {string} raw @param {string} envName */
  static #parseSha256(raw, envName) {
    if (raw === '') return null;
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new ConfigError(`${envName} must be a 64-character SHA-256 hex digest`);
    return raw.toLowerCase();
  }

  /** BCP 47 tag that Intl accepts. @param {string} tag */
  static #parseLang(tag) {
    try {
      return new Intl.Locale(tag).toString();
    } catch {
      throw new ConfigError(`DEFAULT_LANG "${tag}" is not a valid language tag`);
    }
  }
}
