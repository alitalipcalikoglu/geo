/**
 * Shared JSDoc typedefs for the geo service. No runtime exports.
 */

/** @typedef {'read'|'write'|'readwrite'} KeyRole */

/**
 * @typedef {object} ApiKey
 * @property {string} id
 * @property {string} secret
 * @property {KeyRole} role
 */

/**
 * Plain values accepted by the `Config` constructor.
 * @typedef {object} ConfigValues
 * @property {number} port
 * @property {string} host
 * @property {string} logLevel
 * @property {boolean} trustProxy
 * @property {{ certPath: string, keyPath: string }|null} tls
 * @property {number} bodyLimit
 * @property {string} dbPath
 * @property {string} mmdbPath        City or country database; empty = no IP geolocation.
 * @property {string} asnMmdbPath     Optional ASN database.
 * @property {ApiKey[]} apiKeys
 * @property {number} rateLimitMax
 * @property {number} maxBatch
 * @property {number} maxPoints
 * @property {number} maxRadiusKm
 * @property {string} defaultLang
 */

/** @typedef {import('./config.js').Config} Config */

/**
 * @typedef {object} MmdbMetadata
 * @property {number} node_count
 * @property {number} record_size
 * @property {4|6} ip_version
 * @property {string} database_type
 * @property {string[]} [languages]
 * @property {number} build_epoch
 * @property {Record<string, string>} [description]
 */

/**
 * @typedef {object} Country
 * @property {string} alpha2
 * @property {string} alpha3
 * @property {string} numeric
 * @property {'AF'|'AN'|'AS'|'EU'|'NA'|'OC'|'SA'} continent
 * @property {string[]} callingCodes
 * @property {string|null} currency
 * @property {string[]} timezones
 * @property {boolean} eu
 */

/**
 * @typedef {object} PlaceInput
 * @property {string} id
 * @property {string} name
 * @property {number} lat
 * @property {number} lng
 * @property {Record<string, unknown>} [attrs]
 */

/**
 * @typedef {object} PlaceRow
 * @property {string} collection
 * @property {string} id
 * @property {string} name
 * @property {number} lat
 * @property {number} lng
 * @property {string} attrs        JSON object.
 * @property {number} updated_at
 */

/**
 * @typedef {object} CollectionRow
 * @property {string} name
 * @property {string} description
 * @property {string} created_by
 * @property {number} created_at
 * @property {number} updated_at
 */

/** @typedef {import('fastify').FastifyBaseLogger} Logger */

export {};
