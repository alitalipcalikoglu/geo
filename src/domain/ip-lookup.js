import { IpAddress } from '../geo/ip-address.js';
import { MmdbReader } from '../geo/mmdb.js';
import { GeoError } from './errors.js';

/**
 * IP geolocation over the configured MMDB files, normalised to one response shape whatever the
 * vendor (GeoLite2/GeoIP2 City, Country, DB-IP Lite, IPinfo). Reloadable at runtime.
 */
export class IpLookup {
  /**
   * @param {object} deps
   * @param {import('./reference.js').Reference} deps.reference
   * @param {{ mmdbPath: string, asnMmdbPath: string }} deps.paths
   * @param {import('../types.js').Logger} [deps.logger]
   * @param {(path: string) => MmdbReader} [deps.open]
   */
  constructor({ reference, paths, logger, open = MmdbReader.open }) {
    this.reference = reference;
    this.paths = paths;
    this.logger = logger;
    this.open = open;
    /** @type {MmdbReader|null} */ this.city = null;
    /** @type {MmdbReader|null} */ this.asn = null;
    /** @type {string|null} */ this.loadError = null;
    this.loadedAt = 0;
    /** Lookups since start by outcome. */
    this.counts = { hit: 0, miss: 0, special: 0 };
  }

  /** (Re)load the files named in the configuration. Throws when a configured file cannot be read; the previous readers stay. */
  load() {
    const city = this.paths.mmdbPath ? this.open(this.paths.mmdbPath) : null;
    const asn = this.paths.asnMmdbPath ? this.open(this.paths.asnMmdbPath) : null;
    this.city = city;
    this.asn = asn;
    this.loadError = null;
    this.loadedAt = Date.now();
    this.logger?.info({ city: city?.info().type ?? null, asn: asn?.info().type ?? null }, city ? 'IP database loaded' : 'no IP database configured');
  }

  /** Same as load() but records the failure instead of throwing (used at start-up). */
  tryLoad() {
    try { this.load(); } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      this.logger?.error({ err }, 'IP database failed to load');
    }
  }

  get available() {
    return this.city !== null;
  }

  info() {
    return { configured: Boolean(this.paths.mmdbPath), loaded: this.city !== null, error: this.loadError, loadedAt: this.loadedAt ? new Date(this.loadedAt).toISOString() : null, city: this.city?.info() ?? null, asn: this.asn?.info() ?? null, lookups: { ...this.counts } };
  }

  /**
   * @param {string} text
   * @param {string} lang
   */
  lookup(text, lang) {
    const ip = IpAddress.parse(text);
    if (!ip) throw new GeoError('INVALID_IP', `"${text}" is not an IP address`);
    const kind = IpAddress.classify(ip);
    const base = { ip: ip.text, version: ip.version, kind };
    if (kind !== 'public') { this.counts.special++; return { ...base, found: false, network: null, country: null, registeredCountry: null, continent: null, region: null, city: null, postal: null, location: null, timezone: null, asn: this.#asn(ip), source: null }; }
    if (!this.city) throw new GeoError('DATABASE_UNAVAILABLE', this.loadError ? `IP database failed to load: ${this.loadError}` : 'no IP database configured (MMDB_PATH)');
    const hit = this.city.lookup(ip.bytes, ip.version);
    if (!hit) { this.counts.miss++; return { ...base, found: false, network: null, country: null, registeredCountry: null, continent: null, region: null, city: null, postal: null, location: null, timezone: null, asn: this.#asn(ip), source: this.city.info().type }; }
    this.counts.hit++;
    const d = /** @type {any} */ (hit.data);
    const pick = (/** @type {any} */ names) => (names && typeof names === 'object' ? names[lang] ?? names[lang.split('-')[0]] ?? names.en ?? Object.values(names)[0] ?? null : typeof names === 'string' ? names : null);
    const countryCode = d.country?.iso_code ?? d.country_code ?? null;
    const country = countryCode ? this.#country(String(countryCode), d.country?.names, lang) : null;
    const region = d.subdivisions?.[0] ? { code: d.subdivisions[0].iso_code ?? null, name: pick(d.subdivisions[0].names) } : d.region ? { code: null, name: String(d.region) } : null;
    const cityName = pick(d.city?.names) ?? (typeof d.city === 'string' ? d.city : null);
    const loc = d.location;
    const tz = loc?.time_zone ?? d.timezone ?? (country && this.reference.byAlpha2.get(country.code)?.timezones.length === 1 ? this.reference.byAlpha2.get(country.code)?.timezones[0] : null) ?? null;
    return {
      ...base,
      found: true,
      network: `${ip.version === 4 ? ip.text : ip.text}/${hit.prefixLength}`,
      country,
      registeredCountry: d.registered_country?.iso_code ? this.#country(d.registered_country.iso_code, d.registered_country.names, lang) : null,
      continent: d.continent?.code ? { code: d.continent.code, name: pick(d.continent.names) ?? d.continent.code } : country ? { code: this.reference.byAlpha2.get(country.code)?.continent ?? null, name: null } : null,
      region,
      city: cityName ? { name: cityName } : null,
      postal: d.postal?.code ?? null,
      location: loc && typeof loc.latitude === 'number' ? { lat: loc.latitude, lng: loc.longitude, accuracyKm: loc.accuracy_radius ?? null } : null,
      timezone: tz,
      asn: this.#asn(ip),
      source: this.city.info().type,
    };
  }

  /** @param {string} code @param {unknown} names @param {string} lang */
  #country(code, names, lang) {
    const ref = this.reference.byAlpha2.get(code.toUpperCase());
    const name = this.reference.name('region', code.toUpperCase(), lang);
    return { code: code.toUpperCase(), name: name === code.toUpperCase() && names && typeof names === 'object' ? /** @type {any} */ (names).en ?? name : name, eu: ref?.eu ?? false, callingCodes: ref?.callingCodes.map((c) => `+${c}`) ?? [], currency: ref?.currency ?? null };
  }

  /** @param {{ bytes: Uint8Array, version: 4|6 }} ip */
  #asn(ip) {
    if (!this.asn) return null;
    const hit = /** @type {any} */ (this.asn.lookup(ip.bytes, ip.version));
    if (!hit) return null;
    const d = hit.data;
    const number = d.autonomous_system_number ?? (typeof d.asn === 'string' ? Number(d.asn.replace(/^AS/i, '')) : d.asn) ?? null;
    return { number: number === null ? null : Number(number), organization: d.autonomous_system_organization ?? d.name ?? d.organization ?? null, network: `${ip.version === 4 ? Array.from(ip.bytes.slice(12)).join('.') : IpAddress.format6(ip.bytes)}/${hit.prefixLength}` };
  }
}
