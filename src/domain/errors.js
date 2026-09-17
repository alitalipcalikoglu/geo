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
