import { readFileSync } from 'node:fs';
import { GeoError } from './errors.js';

/** @typedef {import('../types.js').Country} Country */

/**
 * Countries, currencies and time zones. Facts that Node's ICU does not carry (calling codes,
 * currency per country, primary zones, continents, EU membership) come from data/countries.json;
 * names, symbols and offsets come from Intl so they follow the runtime's locale data.
 */
export class Reference {
  static CONTINENTS = { AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America' };
  /** Preferred country when several share a calling code. @type {Record<string, string>} */
  static PRIMARY_BY_CODE = { 1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 47: 'NO', 61: 'AU', 64: 'NZ', 212: 'MA', 262: 'RE', 358: 'FI', 500: 'FK', 590: 'GP', 599: 'CW' };

  /** @param {Country[]} countries */
  constructor(countries) {
    /** @type {Country[]} */
    this.all = countries;
    this.byAlpha2 = new Map(countries.map((c) => [c.alpha2, c]));
    this.byAlpha3 = new Map(countries.map((c) => [c.alpha3, c]));
    this.byNumeric = new Map(countries.map((c) => [c.numeric, c]));
    /** @type {Map<string, string[]>} calling code → alpha2 list, primary first */
    this.byCallingCode = new Map();
    for (const c of countries) for (const code of c.callingCodes) {
      const list = this.byCallingCode.get(code) ?? [];
      if (Reference.PRIMARY_BY_CODE[code] === c.alpha2) list.unshift(c.alpha2); else list.push(c.alpha2);
      this.byCallingCode.set(code, list);
    }
    this.maxCallingCodeLength = Math.max(...[...this.byCallingCode.keys()].map((k) => k.length));
    /** @type {Map<string, string[]>} currency → alpha2 list */
    this.byCurrency = new Map();
    for (const c of countries) if (c.currency) this.byCurrency.set(c.currency, [...(this.byCurrency.get(c.currency) ?? []), c.alpha2]);
    /** @type {Map<string, string[]>} time zone → alpha2 list */
    this.byTimezone = new Map();
    for (const c of countries) for (const z of c.timezones) this.byTimezone.set(z, [...(this.byTimezone.get(z) ?? []), c.alpha2]);
    // ICU lists older canonical names (Asia/Calcutta); the table uses current IANA names (Asia/Kolkata). Both resolve.
    this.timezoneNames = [...new Set([...Intl.supportedValuesOf('timeZone'), ...this.byTimezone.keys()])].sort();
    /** @type {Map<string, Intl.DisplayNames>} */
    this.displayNames = new Map();
  }

  /** Load the bundled table. @param {string} [path] */
  static load(path = new URL('../data/countries.json', import.meta.url).pathname) {
    const rows = /** @type {[string, string, string, Country['continent'], string[], string|null, string[], boolean][]} */ (JSON.parse(readFileSync(path, 'utf8')));
    return new Reference(rows.map(([alpha2, alpha3, numeric, continent, callingCodes, currency, timezones, eu]) => ({ alpha2, alpha3, numeric, continent, callingCodes, currency, timezones, eu })));
  }

  /**
   * Localized name through Intl; falls back to English, then to the code.
   * @param {'region'|'currency'|'language'} type
   * @param {string} code
   * @param {string} lang
   */
  name(type, code, lang) {
    for (const l of [lang, 'en']) {
      const key = `${type}:${l}`;
      let dn = this.displayNames.get(key);
      if (!dn) {
        try { dn = new Intl.DisplayNames([l], { type, fallback: 'none' }); } catch { continue; }
        this.displayNames.set(key, dn);
      }
      try {
        const n = dn.of(code);
        if (n) return n;
      } catch { /* unknown code for this type */ }
    }
    return code;
  }

  /** Validate a BCP 47 tag; falls back to `fallback` when invalid. @param {string|undefined} tag @param {string} fallback */
  static lang(tag, fallback) {
    if (!tag) return fallback;
    try { return new Intl.Locale(tag).toString(); } catch { return fallback; }
  }

  // ---- countries

  /** Find by alpha-2, alpha-3 or numeric code, case-insensitive. @param {string} code */
  country(code) {
    const c = code.trim().toUpperCase();
    return this.byAlpha2.get(c) ?? this.byAlpha3.get(c) ?? this.byNumeric.get(c.padStart(3, '0'));
  }

  /** @param {string} code */
  requireCountry(code) {
    const c = this.country(code);
    if (!c) throw new GeoError('COUNTRY_NOT_FOUND', `country "${code}" not found`);
    return c;
  }

  /** @param {Country} c @param {string} lang */
  countryView(c, lang) {
    return {
      code: c.alpha2, alpha3: c.alpha3, numeric: c.numeric, name: this.name('region', c.alpha2, lang),
      continent: { code: c.continent, name: Reference.CONTINENTS[c.continent] }, eu: c.eu,
      callingCodes: c.callingCodes.map((x) => `+${x}`), currency: c.currency ? { code: c.currency, name: this.name('currency', c.currency, lang) } : null,
      timezones: c.timezones, flag: Reference.flag(c.alpha2),
    };
  }

  /** Regional indicator symbols. @param {string} alpha2 */
  static flag(alpha2) {
    return String.fromCodePoint(...[...alpha2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  }

  /**
   * Countries, optionally filtered by a name/code prefix or a continent.
   * @param {{ q?: string, continent?: string, eu?: boolean, currency?: string }} filter
   * @param {string} lang
   */
  countries(filter, lang) {
    const q = filter.q ? Reference.fold(filter.q) : '';
    return this.all
      .filter((c) => !filter.continent || c.continent === filter.continent.toUpperCase())
      .filter((c) => filter.eu === undefined || c.eu === filter.eu)
      .filter((c) => !filter.currency || c.currency === filter.currency.toUpperCase())
      .map((c) => this.countryView(c, lang))
      .filter((v) => !q || Reference.fold(v.name).includes(q) || v.code.toLowerCase().startsWith(q) || v.alpha3.toLowerCase().startsWith(q))
      .sort((a, b) => a.name.localeCompare(b.name, lang));
  }

  /** Case, accents and Turkish i folded for matching. @param {string} s */
  static fold(s) {
    return s.normalize('NFD').replace(/\p{M}+/gu, '').replace(/ı/g, 'i').replace(/I/g, 'i').toLowerCase().trim();
  }

  // ---- currencies

  /** @param {string} code @param {string} lang */
  currencyView(code, lang) {
    const c = code.toUpperCase();
    let decimals = 2;
    let symbol = c;
    try {
      const nf = new Intl.NumberFormat(lang, { style: 'currency', currency: c });
      decimals = nf.resolvedOptions().maximumFractionDigits ?? 2;
      symbol = nf.formatToParts(1).find((p) => p.type === 'currency')?.value ?? c;
    } catch { /* unknown to ICU: keep defaults */ }
    return { code: c, name: this.name('currency', c, lang), symbol, decimals, countries: this.byCurrency.get(c) ?? [] };
  }

  /** @param {string} code @param {string} lang */
  currency(code, lang) {
    const c = code.trim().toUpperCase();
    if (!this.byCurrency.has(c)) throw new GeoError('CURRENCY_NOT_FOUND', `currency "${code}" is not used by any country`);
    return this.currencyView(c, lang);
  }

  /** @param {string} lang */
  currencies(lang) {
    return [...this.byCurrency.keys()].sort().map((c) => this.currencyView(c, lang));
  }

  // ---- time zones

  /**
   * @param {string} name IANA name.
   * @param {number} now ms
   * @param {string} lang
   */
  timezoneView(name, now, lang) {
    const date = new Date(now);
    const offsetMin = Reference.offsetMinutes(name, date);
    const jan = Reference.offsetMinutes(name, new Date(Date.UTC(date.getUTCFullYear(), 0, 1)));
    const jul = Reference.offsetMinutes(name, new Date(Date.UTC(date.getUTCFullYear(), 6, 1)));
    const abbr = new Intl.DateTimeFormat('en-US', { timeZone: name, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? '';
    let longName = name;
    try { longName = new Intl.DateTimeFormat(lang, { timeZone: name, timeZoneName: 'long' }).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? name; } catch { /* keep name */ }
    return { name, offset: Reference.formatOffset(offsetMin), offsetMinutes: offsetMin, abbreviation: abbr, longName, dst: jan !== jul && offsetMin === Math.max(jan, jul), observesDst: jan !== jul, localTime: new Date(now + offsetMin * 60_000).toISOString().slice(0, 19), countries: this.byTimezone.get(name) ?? [] };
  }

  /** @param {string} name @param {number} now @param {string} lang */
  timezone(name, now, lang) {
    const wanted = name.trim();
    const canonical = this.timezoneNames.find((z) => z.toLowerCase() === wanted.toLowerCase());
    if (canonical) return this.timezoneView(canonical, now, lang);
    try {
      const resolved = new Intl.DateTimeFormat('en', { timeZone: wanted }).resolvedOptions().timeZone;
      return this.timezoneView(resolved, now, lang);
    } catch {
      throw new GeoError('TIMEZONE_NOT_FOUND', `time zone "${name}" not found`);
    }
  }

  /**
   * @param {{ country?: string, q?: string }} filter
   * @param {number} now
   * @param {string} lang
   */
  timezones(filter, now, lang) {
    let names = this.timezoneNames;
    if (filter.country) names = this.requireCountry(filter.country).timezones;
    if (filter.q) { const q = filter.q.toLowerCase(); names = names.filter((z) => z.toLowerCase().includes(q)); }
    return names.map((z) => this.timezoneView(z, now, lang));
  }

  /** Minutes east of UTC for a zone at an instant. @param {string} zone @param {Date} date */
  static offsetMinutes(zone, date) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(date);
    const get = (/** @type {string} */ t) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - date.getTime()) / 60_000);
  }

  /** `+03:00`. @param {number} min */
  static formatOffset(min) {
    const sign = min < 0 ? '-' : '+';
    const a = Math.abs(min);
    return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  }
}
