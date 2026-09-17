import { GeoError } from './errors.js';

/**
 * E.164 normalisation from the calling-code table: strips formatting, resolves the country from
 * the longest matching calling code (or from a given default country for national numbers) and
 * checks the E.164 length rule. National numbering plans are not modelled: a number that has a
 * known calling code and 8 to 15 digits is `valid`; whether the subscriber part exists is not known.
 */
export class Phone {
  /** @param {import('./reference.js').Reference} ref */
  constructor(ref) {
    this.ref = ref;
  }

  /**
   * @param {string} input
   * @param {{ country?: string }} [o] Default country for numbers without a + or 00 prefix.
   */
  normalize(input, o = {}) {
    const raw = input.trim();
    if (!raw) throw new GeoError('INVALID_PHONE', 'number is empty');
    let digits = raw.replace(/[\s().\-‐-―]/g, '');
    let international = false;
    if (digits.startsWith('+')) { international = true; digits = digits.slice(1); }
    else if (digits.startsWith('00')) { international = true; digits = digits.slice(2); }
    else if (digits.startsWith('011') && o.country && this.ref.country(o.country)?.callingCodes.includes('1')) { international = true; digits = digits.slice(3); }
    if (!/^\d+$/.test(digits)) throw new GeoError('INVALID_PHONE', 'number contains characters other than digits, spaces, parentheses, dots and dashes');
    let callingCode = '';
    /** @type {string[]} */ let countries = [];
    if (!international) {
      if (!o.country) return { input: raw, e164: null, valid: false, reason: 'no country and no international prefix', country: null, countries: [], callingCode: null, national: digits };
      const c = this.ref.requireCountry(o.country);
      if (c.callingCodes.length === 0) return { input: raw, e164: null, valid: false, reason: `no calling code for ${c.alpha2}`, country: c.alpha2, countries: [c.alpha2], callingCode: null, national: digits };
      callingCode = c.callingCodes[0];
      countries = [c.alpha2];
      // Trunk prefix 0 (most plans) is dropped; NANP and a few plans have none.
      if (digits.startsWith('0') && callingCode !== '1') digits = digits.replace(/^0+/, '');
      // NANP: a national number written with the country code already (1 555 ...) stays as is.
      if (callingCode === '1' && digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
      digits = callingCode + digits;
    } else {
      for (let len = Math.min(this.ref.maxCallingCodeLength, digits.length); len >= 1; len--) {
        const list = this.ref.byCallingCode.get(digits.slice(0, len));
        if (list) { callingCode = digits.slice(0, len); countries = list; break; }
      }
      if (!callingCode) return { input: raw, e164: `+${digits}`, valid: false, reason: 'unknown calling code', country: null, countries: [], callingCode: null, national: digits };
      // A country given by the caller wins among countries sharing the code (US/CA, RU/KZ, GB/GG/JE/IM).
      if (o.country) { const c = this.ref.country(o.country); if (c && countries.includes(c.alpha2)) countries = [c.alpha2, ...countries.filter((x) => x !== c.alpha2)]; }
    }
    const national = digits.slice(callingCode.length);
    const valid = digits.length >= 8 && digits.length <= 15 && national.length >= 4;
    return { input: raw, e164: `+${digits}`, valid, reason: valid ? null : 'E.164 numbers have 8 to 15 digits', country: countries[0] ?? null, countries, callingCode: `+${callingCode}`, national };
  }
}
