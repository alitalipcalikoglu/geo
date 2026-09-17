/**
 * Domain error with a stable machine-readable code and the HTTP status the API maps it to.
 */
export class GeoError extends Error {
  /** @type {Record<string, number>} */
  static STATUS = {
    INVALID_IP: 400,
    INVALID_COORDINATES: 400,
    INVALID_PHONE: 400,
    INVALID_PLACE: 400,
    BATCH_TOO_LARGE: 413,
    COUNTRY_NOT_FOUND: 404,
    CURRENCY_NOT_FOUND: 404,
    TIMEZONE_NOT_FOUND: 404,
    COLLECTION_NOT_FOUND: 404,
    COLLECTION_EXISTS: 409,
    PLACE_NOT_FOUND: 404,
    DATABASE_UNAVAILABLE: 503,
    DATABASE_RELOAD_FAILED: 409,
    FORBIDDEN: 403,
  };

  /**
   * @param {keyof typeof GeoError.STATUS} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
    this.statusCode = GeoError.STATUS[code];
    this.details = details;
  }
}

/**
 * A malformed or truncated MMDB file (or a value inside one) failed a bounds/structural check.
 * Never a client-facing error: it is thrown while opening or reading a database file, always
 * before a request is in flight, and `IpLookup.load()`/`reload()` catch it exactly like any other
 * open failure (ENOENT, bad record size, ...) and turn it into `loadError`/`{ok:false}`. No HTTP
 * status mapping, unlike {@link GeoError}, because it never surfaces through the HTTP layer.
 */
export class MmdbFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'MmdbFormatError';
    this.code = 'MMDB_FORMAT_ERROR';
  }
}
