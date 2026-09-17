import { readFileSync, statSync } from 'node:fs';

/**
 * Reader for MaxMind DB files (GeoLite2, GeoIP2, DB-IP, IPinfo free databases). The whole file is
 * held in memory; lookups walk the binary search tree bit by bit and decode the data section on
 * demand. Format: https://maxmind.github.io/MaxMind-DB/ (no dependency needed).
 */
export class MmdbReader {
  static METADATA_MARKER = Buffer.from('\xab\xcd\xefMaxMind.com', 'latin1');
  static DATA_SEPARATOR = 16;

  /**
   * @param {Buffer} buf
   * @param {{ path?: string, mtimeMs?: number, sizeBytes?: number }} [file]
   */
  constructor(buf, file = {}) {
    this.buf = buf;
    this.file = file;
    const start = buf.lastIndexOf(MmdbReader.METADATA_MARKER, buf.length - 1);
    if (start < 0) throw new Error('not an MMDB file: metadata marker missing');
    this.metadata = /** @type {import('../types.js').MmdbMetadata} */ (this.#decode(start + MmdbReader.METADATA_MARKER.length, 0).value);
    const m = this.metadata;
    if (![24, 28, 32].includes(m.record_size)) throw new Error(`unsupported record size ${m.record_size}`);
    this.nodeCount = m.node_count;
    this.recordSize = m.record_size;
    this.nodeBytes = (m.record_size * 2) / 8;
    this.dataStart = this.nodeCount * this.nodeBytes + MmdbReader.DATA_SEPARATOR;
    this.ipv4Start = m.ip_version === 6 ? this.#ipv4StartNode() : 0;
  }

  /** @param {string} path */
  static open(path) {
    const st = statSync(path);
    return new MmdbReader(readFileSync(path), { path, mtimeMs: st.mtimeMs, sizeBytes: st.size });
  }

  /** Info for operators. */
  info() {
    const m = this.metadata;
    return { type: m.database_type, buildEpoch: m.build_epoch, builtAt: new Date(m.build_epoch * 1000).toISOString(), ipVersion: m.ip_version, nodeCount: m.node_count, recordSize: m.record_size, languages: m.languages ?? [], description: m.description ?? {}, path: this.file.path ?? null, sizeBytes: this.file.sizeBytes ?? this.buf.length, modifiedAt: this.file.mtimeMs ? new Date(this.file.mtimeMs).toISOString() : null };
  }

  /**
   * @param {Uint8Array} bytes 16-byte address (IPv4 as ::a.b.c.d).
   * @param {4|6} version
   * @returns {{ data: unknown, prefixLength: number }|null}
   */
  lookup(bytes, version) {
    if (version === 6 && this.metadata.ip_version === 4) return null;
    let node = 0;
    let bit = 0;
    const totalBits = version === 4 ? 32 : 128;
    let bitIndex = version === 4 ? 96 : 0; // IPv4 lives under the first 96 zero bits of an IPv6 tree.
    if (version === 4 && this.metadata.ip_version === 6) { node = this.ipv4Start; if (node >= this.nodeCount) return null; }
    for (; bit < totalBits; bit++, bitIndex++) {
      const b = (bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
      const record = this.#record(node, b);
      if (record === this.nodeCount) return null;
      if (record > this.nodeCount) return { data: this.#decode(this.dataStart + (record - this.nodeCount - MmdbReader.DATA_SEPARATOR), 0).value, prefixLength: bit + 1 };
      node = record;
    }
    return null;
  }

  #ipv4StartNode() {
    let node = 0;
    for (let i = 0; i < 96 && node < this.nodeCount; i++) node = this.#record(node, 0);
    return node;
  }

  /** @param {number} node @param {number} side 0 left, 1 right */
  #record(node, side) {
    const base = node * this.nodeBytes;
    const b = this.buf;
    if (this.recordSize === 24) { const o = base + side * 3; return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]; }
    if (this.recordSize === 28) {
      if (side === 0) return ((b[base + 3] & 0xf0) << 20) | (b[base] << 16) | (b[base + 1] << 8) | b[base + 2];
      return ((b[base + 3] & 0x0f) << 24) | (b[base + 4] << 16) | (b[base + 5] << 8) | b[base + 6];
    }
    return b.readUInt32BE(base + side * 4);
  }

  /**
   * Decode one value at `offset`. Returns the value and the offset after it.
   * @param {number} offset
   * @param {number} depth
   * @returns {{ value: any, next: number }}
   */
  #decode(offset, depth) {
    if (depth > 64) throw new Error('MMDB data nesting too deep');
    const b = this.buf;
    const ctrl = b[offset++];
    let type = ctrl >> 5;
    if (type === 0) type = b[offset++] + 7;
    let size = ctrl & 0x1f;
    if (type === 1) {
      // Pointer: ss selects the width, vvv are the top bits.
      const ss = (size >> 3) & 3;
      const vvv = size & 7;
      let p;
      if (ss === 0) { p = (vvv << 8) | b[offset]; offset += 1; }
      else if (ss === 1) { p = ((vvv << 16) | (b[offset] << 8) | b[offset + 1]) + 2048; offset += 2; }
      else if (ss === 2) { p = ((vvv << 24) | (b[offset] << 16) | (b[offset + 1] << 8) | b[offset + 2]) + 526336; offset += 3; }
      else { p = b.readUInt32BE(offset); offset += 4; }
      return { value: this.#decode(this.dataStart + p, depth + 1).value, next: offset };
    }
    if (size === 29) { size = 29 + b[offset]; offset += 1; }
    else if (size === 30) { size = 285 + ((b[offset] << 8) | b[offset + 1]); offset += 2; }
    else if (size === 31) { size = 65821 + ((b[offset] << 16) | (b[offset + 1] << 8) | b[offset + 2]); offset += 3; }
    switch (type) {
      case 2: return { value: b.toString('utf8', offset, offset + size), next: offset + size };
      case 3: return { value: b.readDoubleBE(offset), next: offset + 8 };
      case 4: return { value: b.subarray(offset, offset + size), next: offset + size };
      case 5: case 6: case 8: { let n = 0; for (let i = 0; i < size; i++) n = n * 256 + b[offset + i]; if (type === 8 && size === 4 && n >= 2 ** 31) n -= 2 ** 32; return { value: n, next: offset + size }; }
      case 9: case 10: { let n = 0n; for (let i = 0; i < size; i++) n = (n << 8n) | BigInt(b[offset + i]); return { value: n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString(), next: offset + size }; }
      case 7: {
        /** @type {Record<string, unknown>} */ const map = {};
        for (let i = 0; i < size; i++) {
          const k = this.#decode(offset, depth + 1);
          const v = this.#decode(k.next, depth + 1);
          map[String(k.value)] = v.value;
          offset = v.next;
        }
        return { value: map, next: offset };
      }
      case 11: { const arr = []; for (let i = 0; i < size; i++) { const v = this.#decode(offset, depth + 1); arr.push(v.value); offset = v.next; } return { value: arr, next: offset }; }
      case 12: return { value: null, next: offset }; // data cache container: not used by lookups
      case 13: return { value: null, next: offset }; // end marker
      case 14: return { value: size !== 0, next: offset };
      case 15: return { value: b.readFloatBE(offset), next: offset + 4 };
      default: throw new Error(`unknown MMDB data type ${type}`);
    }
  }
}
