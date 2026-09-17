/** JSON Schemas for the HTTP surface. Coordinates and places are validated further in the domain layer. */
export class Schemas {
  static name = { type: 'string', pattern: '^[a-z0-9]+([.\\-_][a-z0-9]+)*$', maxLength: 80 };
  static id = { type: 'string', minLength: 1, maxLength: 200 };
  static lang = { type: 'string', minLength: 2, maxLength: 35, pattern: '^[A-Za-z0-9-]+$' };
  static ip = { type: 'string', minLength: 2, maxLength: 64 };
  static limit = { type: 'string', pattern: '^([1-9]|[1-9][0-9]|[1-9][0-9][0-9]|1000)$' };
  static offset = { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$' };
  static coord = { type: 'string', pattern: '^-?\\d{1,3}(\\.\\d+)?$' };
  static pair = { type: 'string', pattern: '^\\s*-?\\d{1,3}(\\.\\d+)?\\s*,\\s*-?\\d{1,3}(\\.\\d+)?\\s*$' };

  /**
   * @param {string[]} required
   * @param {Record<string, object>} properties
   */
  static body(required, properties) {
    return { type: 'object', additionalProperties: false, required, properties };
  }

  static langQuery = { type: 'object', additionalProperties: false, properties: { lang: Schemas.lang } };
  static ipParams = { type: 'object', properties: { ip: Schemas.ip }, required: ['ip'] };
  static ipBatch = Schemas.body(['ips'], { ips: { type: 'array', minItems: 1, maxItems: 1000, items: Schemas.ip }, lang: Schemas.lang });
  static countriesQuery = { type: 'object', additionalProperties: false, properties: { lang: Schemas.lang, q: { type: 'string', maxLength: 100 }, continent: { type: 'string', enum: ['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA', 'af', 'an', 'as', 'eu', 'na', 'oc', 'sa'] }, eu: { type: 'string', enum: ['true', 'false'] }, currency: { type: 'string', pattern: '^[A-Za-z]{3}$' } } };
  static codeParams = { type: 'object', properties: { code: { type: 'string', minLength: 2, maxLength: 3 } }, required: ['code'] };
  static timezonesQuery = { type: 'object', additionalProperties: false, properties: { lang: Schemas.lang, country: { type: 'string', minLength: 2, maxLength: 3 }, q: { type: 'string', maxLength: 100 } } };
  static phoneQuery = { type: 'object', additionalProperties: false, required: ['number'], properties: { number: { type: 'string', minLength: 1, maxLength: 40 }, country: { type: 'string', minLength: 2, maxLength: 3 } } };
  static phoneBatch = Schemas.body(['numbers'], { numbers: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string', minLength: 1, maxLength: 40 } }, country: { type: 'string', minLength: 2, maxLength: 3 } });
  static distanceQuery = { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: Schemas.pair, to: Schemas.pair } };

  static createCollection = Schemas.body(['name'], { name: Schemas.name, description: { type: 'string', maxLength: 500 } });
  static patchCollection = { type: 'object', additionalProperties: false, minProperties: 1, properties: { description: { type: 'string', maxLength: 500 } } };
  static place = { type: 'object', additionalProperties: false, required: ['id', 'name', 'lat', 'lng'], properties: { id: Schemas.id, name: { type: 'string', maxLength: 200 }, lat: { type: 'number' }, lng: { type: 'number' }, attrs: { type: 'object', maxProperties: 50 } } };
  static upsertPlaces = Schemas.body(['places'], { places: { type: 'array', minItems: 1, maxItems: 100_000, items: Schemas.place } });
  static nameParams = { type: 'object', properties: { name: Schemas.name }, required: ['name'] };
  static placeParams = { type: 'object', properties: { name: Schemas.name, id: Schemas.id }, required: ['name', 'id'] };
  static listQuery = { type: 'object', additionalProperties: false, properties: { limit: Schemas.limit, offset: Schemas.offset } };
  /** `?lat=&lng=&radius=&limit=&filter.<key>=v`. */
  static nearbyQuery = { type: 'object', additionalProperties: { type: 'string', maxLength: 200 }, required: ['lat', 'lng'], properties: { lat: Schemas.coord, lng: Schemas.coord, radius: { type: 'string', pattern: '^\\d{1,5}(\\.\\d+)?$' }, limit: { type: 'string', pattern: '^([1-9]|[1-9][0-9]|100)$' } } };
}
