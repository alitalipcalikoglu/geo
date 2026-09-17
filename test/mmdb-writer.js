import { IpAddress } from '../src/geo/ip-address.js';
import { MmdbReader } from '../src/geo/mmdb.js';

/**
 * Minimal MMDB writer for tests: builds the search tree, a data section with pointer reuse for
 * repeated strings, and the metadata block. Enough of the format to exercise every reader path.
 * @typedef {{ left: Node|null, right: Node|null, data: unknown }} Node
 */
export class MmdbWriter {
  /** @param {{ ipVersion?: 4|6, recordSize?: 24|28|32, databaseType?: string, languages?: string[], buildEpoch?: number }} [o] */
  constructor(o = {}) {
    this.ipVersion = o.ipVersion ?? 6;
    this.recordSize = o.recordSize ?? 24;
    this.databaseType = o.databaseType ?? 'Test-City';
    this.languages = o.languages ?? ['en'];
    this.buildEpoch = o.buildEpoch ?? 1_760_000_000;
    /** @type {Node} */
    this.root = { left: null, right: null, data: undefined };
  }

  /** @param {string} cidr @param {unknown} data */
  add(cidr, data) {
    const [addr, prefixText] = cidr.split('/');
    const ip = /** @type {NonNullable<ReturnType<typeof IpAddress.parse>>} */ (IpAddress.parse(addr));
    const prefix = Number(prefixText);
    // An IPv6 tree holds IPv4 under 96 zero bits, so those bits are part of the path.
    const start = this.ipVersion === 6 ? 0 : 96;
    const end = (ip.version === 4 ? 96 : 0) + prefix;
    let node = this.root;
    for (let i = start; i < end; i++) {
      const bit = (ip.bytes[i >> 3] >> (7 - (i & 7))) & 1;
      const key = bit ? 'right' : 'left';
      if (!node[key]) node[key] = { left: null, right: null, data: undefined };
      node = /** @type {Node} */ (node[key]);
    }
    if (node === this.root) throw new Error(`${cidr} does not fit an IPv${this.ipVersion} tree`);
    node.data = data;
    return this;
  }

  build() {
    /** @type {Node[]} */
    const nodes = [];
    const walk = (/** @type {Node} */ n) => { if (n.data !== undefined) return; nodes.push(n); if (n.left) walk(n.left); if (n.right) walk(n.right); };
    walk(this.root);
    const index = new Map(nodes.map((n, i) => [n, i]));
    const nodeCount = nodes.length;
    /** @type {Uint8Array[]} */ const data = [];
    /** @type {Map<string, number>} */ const strings = new Map();
    let dataLen = 0;
    /** @type {Map<unknown, number>} */ const dataOffsets = new Map();
    const encode = (/** @type {unknown} */ v) => {
      const chunk = this.#encode(v, strings, dataLen);
      const off = dataLen;
      data.push(chunk); dataLen += chunk.length;
      return off;
    };
    for (const n of nodes) for (const child of [n.left, n.right]) if (child && child.data !== undefined && !dataOffsets.has(child)) dataOffsets.set(child, encode(child.data));
    const nodeBytes = (this.recordSize * 2) / 8;
    const tree = Buffer.alloc(nodeCount * nodeBytes);
    const record = (/** @type {Node|null} */ child) => (child === null ? nodeCount : child.data !== undefined ? /** @type {number} */ (dataOffsets.get(child)) + nodeCount + 16 : /** @type {number} */ (index.get(child)));
    nodes.forEach((n, i) => {
      const l = record(n.left);
      const r = record(n.right);
      const base = i * nodeBytes;
      if (this.recordSize === 24) { tree.writeUIntBE(l, base, 3); tree.writeUIntBE(r, base + 3, 3); }
      else if (this.recordSize === 28) { tree.writeUIntBE(l & 0xffffff, base, 3); tree[base + 3] = ((l >> 24) << 4) | (r >> 24); tree.writeUIntBE(r & 0xffffff, base + 4, 3); }
      else { tree.writeUInt32BE(l, base); tree.writeUInt32BE(r, base + 4); }
    });
    const meta = this.#encode({ node_count: nodeCount, record_size: this.recordSize, ip_version: this.ipVersion, database_type: this.databaseType, languages: this.languages, binary_format_major_version: 2, binary_format_minor_version: 0, build_epoch: this.buildEpoch, description: { en: 'test database' } }, /** @type {any} */ ({ get: () => undefined, set() {} }), 0); // no pointers outside the data section
    return Buffer.concat([tree, Buffer.alloc(16), ...data, MmdbReader.METADATA_MARKER, meta]);
  }

  /** @param {number} type @param {number} size */
  static #ctrl(type, size) {
    const sizeBytes = size < 29 ? [size] : size < 285 ? [29, size - 29] : [30, (size - 285) >> 8, (size - 285) & 0xff];
    const first = sizeBytes[0];
    return type <= 7 ? Buffer.from([(type << 5) | first, ...sizeBytes.slice(1)]) : Buffer.from([first, type - 7, ...sizeBytes.slice(1)]);
  }

  /**
   * @param {unknown} v
   * @param {Map<string, number>} strings Offsets of strings already written (pointer reuse).
   * @param {number} at Offset where this value will start.
   * @returns {Buffer}
   */
  #encode(v, strings, at) {
    if (typeof v === 'string') {
      const seen = strings.get(v);
      if (seen !== undefined) return seen < 2048 ? Buffer.from([(1 << 5) | (seen >> 8), seen & 0xff]) : Buffer.from([(1 << 5) | (1 << 3) | ((seen - 2048) >> 16), ((seen - 2048) >> 8) & 0xff, (seen - 2048) & 0xff]);
      strings.set(v, at);
      const s = Buffer.from(v, 'utf8');
      return Buffer.concat([MmdbWriter.#ctrl(2, s.length), s]);
    }
    if (typeof v === 'boolean') return MmdbWriter.#ctrl(14, v ? 1 : 0);
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) { const b = Buffer.alloc(8); b.writeDoubleBE(v); return Buffer.concat([MmdbWriter.#ctrl(3, 8), b]); }
      if (v < 0) { const b = Buffer.alloc(4); b.writeInt32BE(v); return Buffer.concat([MmdbWriter.#ctrl(8, 4), b]); }
      if (v < 65536) { const b = Buffer.alloc(2); b.writeUInt16BE(v); return Buffer.concat([MmdbWriter.#ctrl(5, 2), b]); }
      const b = Buffer.alloc(4); b.writeUInt32BE(v); return Buffer.concat([MmdbWriter.#ctrl(6, 4), b]);
    }
    if (Array.isArray(v)) {
      /** @type {Uint8Array[]} */ const parts = [MmdbWriter.#ctrl(11, v.length)];
      let off = at + parts[0].length;
      for (const item of v) { const c = this.#encode(item, strings, off); parts.push(c); off += c.length; }
      return Buffer.concat(parts);
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v);
      /** @type {Uint8Array[]} */ const parts = [MmdbWriter.#ctrl(7, entries.length)];
      let off = at + parts[0].length;
      for (const [k, val] of entries) {
        const kc = this.#encode(k, strings, off); parts.push(kc); off += kc.length;
        const vc = this.#encode(val, strings, off); parts.push(vc); off += vc.length;
      }
      return Buffer.concat(parts);
    }
    throw new Error(`cannot encode ${typeof v}`);
  }
}

/** A City-style database with a few networks. @param {Partial<ConstructorParameters<typeof MmdbWriter>[0]>} [o] */
export function cityDatabase(o = {}) {
  const w = new MmdbWriter({ databaseType: 'Test-City', languages: ['en', 'tr'], ...o });
  w.add('81.0.0.0/8', { continent: { code: 'EU', names: { en: 'Europe', tr: 'Avrupa' } }, country: { iso_code: 'TR', names: { en: 'Turkey', tr: 'Türkiye' }, is_in_european_union: false }, registered_country: { iso_code: 'TR', names: { en: 'Turkey' } }, subdivisions: [{ iso_code: '34', names: { en: 'Istanbul', tr: 'İstanbul' } }], city: { names: { en: 'Istanbul', tr: 'İstanbul' } }, postal: { code: '34000' }, location: { latitude: 41.0138, longitude: 28.9497, accuracy_radius: 50, time_zone: 'Europe/Istanbul' }, traits: { is_anonymous_proxy: false } });
  w.add('8.8.8.0/24', { continent: { code: 'NA', names: { en: 'North America' } }, country: { iso_code: 'US', names: { en: 'United States' } }, location: { latitude: 37.751, longitude: -97.822, accuracy_radius: 1000, time_zone: 'America/Chicago' } });
  if (o.ipVersion !== 4) w.add('2a02:6b8::/32', { continent: { code: 'EU', names: { en: 'Europe' } }, country: { iso_code: 'RU', names: { en: 'Russia' } }, city: { names: { en: 'Moscow' } }, location: { latitude: 55.75, longitude: 37.62, accuracy_radius: 200, time_zone: 'Europe/Moscow' } });
  if (o.ipVersion !== 4) w.add('2001:4860::/32', { country: { iso_code: 'US', names: { en: 'United States' } } });
  return w.build();
}

/** An ASN database. */
export function asnDatabase() {
  const w = new MmdbWriter({ databaseType: 'Test-ASN' });
  w.add('8.8.8.0/24', { autonomous_system_number: 15169, autonomous_system_organization: 'GOOGLE' });
  w.add('81.0.0.0/8', { autonomous_system_number: 9121, autonomous_system_organization: 'Turk Telekom' });
  return w.build();
}
