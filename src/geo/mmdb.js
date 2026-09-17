import { readFileSync, statSync } from 'node:fs';
import { MmdbFormatError } from '../domain/errors.js';

/**
 * Reader for MaxMind DB files (GeoLite2, GeoIP2, DB-IP, IPinfo free databases). The whole file is
 * held in memory; lookups walk the binary search tree bit by bit and decode the data section on
 * demand. Format: https://maxmind.github.io/MaxMind-DB/ (no dependency needed).
 *
 * Every read of `this.buf` goes through {@link #requireBytes}/{@link #u8} first, so a truncated or
 * corrupted file fails deterministically with {@link MmdbFormatError} instead of silently reading
 * `undefined` (plain indexing), a native `RangeError` (`readUInt32BE`/`readDoubleBE`/...), or
 * clamped garbage (`toString`/`subarray`) depending on which line happened to touch the bad offset.
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
    if (start < 0) throw new MmdbFormatError('not an MMDB file: metadata marker missing');
    this.metadata = /** @type {import('../types.js').MmdbMetadata} */ (this.#decode(start + MmdbReader.METADATA_MARKER.length, 0).value);
    const m = this.metadata;
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new MmdbFormatError('MMDB metadata block did not decode to a map');
    if (!Number.isInteger(m.node_count) || m.node_count < 0) throw new MmdbFormatError(`MMDB metadata node_count is invalid: ${m.node_count}`);
    if (![24, 28, 32].includes(m.record_size)) throw new MmdbFormatError(`unsupported record size ${m.record_size}`);
    if (m.ip_version !== 4 && m.ip_version !== 6) throw new MmdbFormatError(`unsupported ip_version ${m.ip_version}`);
    this.nodeCount = m.node_count;
    this.recordSize = m.record_size;
    this.nodeBytes = (m.record_size * 2) / 8;
    this.dataStart = this.nodeCount * this.nodeBytes + MmdbReader.DATA_SEPARATOR;
    if (this.dataStart > buf.length) throw new MmdbFormatError(`node table (${this.nodeCount} nodes) plus separator needs ${this.dataStart} bytes, buffer has ${buf.length}`);
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

  /**
   * Bounds-check one read before it happens: `offset` must be non-negative and `offset + n` must
   * not run past the buffer. The single choke point every read site below goes through, so a check
   * added here can never be skipped by a path that forgot its own.
   * @param {number} offset @param {number} n @param {string} what
   */
  #requireBytes(offset, n, what) {
    if (offset < 0 || n < 0 || offset + n > this.buf.length) throw new MmdbFormatError(`truncated MMDB data: ${what} at offset ${offset} needs ${n} byte(s), buffer has ${this.buf.length}`);
  }

  /** @param {number} offset @param {string} what */
  #u8(offset, what) {
    this.#requireBytes(offset, 1, what);
    return this.buf[offset];
  }

  /** @param {number} node @param {number} side 0 left, 1 right */
  #record(node, side) {
    const base = node * this.nodeBytes;
    const b = this.buf;
    if (this.recordSize === 24) {
      this.#requireBytes(base, 6, `node ${node} record`);
      const o = base + side * 3;
      return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
    }
    if (this.recordSize === 28) {
      this.#requireBytes(base, 7, `node ${node} record`);
      if (side === 0) return ((b[base + 3] & 0xf0) << 20) | (b[base] << 16) | (b[base + 1] << 8) | b[base + 2];
      return ((b[base + 3] & 0x0f) << 24) | (b[base + 4] << 16) | (b[base + 5] << 8) | b[base + 6];
    }
    this.#requireBytes(base, 8, `node ${node} record`);
    return b.readUInt32BE(base + side * 4);
  }

  /**
   * Decode one value at `offset`. Returns the value and the offset after it.
   * @param {number} offset
   * @param {number} depth
   * @returns {{ value: any, next: number }}
   */
  #decode(offset, depth) {
    if (depth > 64) throw new MmdbFormatError('MMDB data nesting too deep');
    const b = this.buf;
    const ctrl = this.#u8(offset, 'control byte');
    offset += 1;
    let type = ctrl >> 5;
    if (type === 0) { type = this.#u8(offset, 'extended type byte') + 7; offset += 1; }
    let size = ctrl & 0x1f;
    if (type === 1) {
      // Pointer: ss selects the width, vvv are the top bits.
      const ss = (size >> 3) & 3;
      const vvv = size & 7;
      let p;
      if (ss === 0) { p = (vvv << 8) | this.#u8(offset, 'pointer byte'); offset += 1; }
      else if (ss === 1) { this.#requireBytes(offset, 2, 'pointer bytes'); p = ((vvv << 16) | (b[offset] << 8) | b[offset + 1]) + 2048; offset += 2; }
      else if (ss === 2) { this.#requireBytes(offset, 3, 'pointer bytes'); p = ((vvv << 24) | (b[offset] << 16) | (b[offset + 1] << 8) | b[offset + 2]) + 526336; offset += 3; }
      else { this.#requireBytes(offset, 4, 'pointer bytes'); p = b.readUInt32BE(offset); offset += 4; }
      const target = this.dataStart + p;
      if (target < 0) throw new MmdbFormatError(`pointer at data offset resolves to negative offset ${target}`);
      return { value: this.#decode(target, depth + 1).value, next: offset };
    }
    if (size === 29) { size = 29 + this.#u8(offset, 'extended size byte'); offset += 1; }
    else if (size === 30) { this.#requireBytes(offset, 2, 'extended size bytes'); size = 285 + ((b[offset] << 8) | b[offset + 1]); offset += 2; }
    else if (size === 31) { this.#requireBytes(offset, 3, 'extended size bytes'); size = 65821 + ((b[offset] << 16) | (b[offset + 1] << 8) | b[offset + 2]); offset += 3; }
    switch (type) {
      case 2: this.#requireBytes(offset, size, 'string'); return { value: b.toString('utf8', offset, offset + size), next: offset + size };
      case 3: this.#requireBytes(offset, 8, 'double'); return { value: b.readDoubleBE(offset), next: offset + 8 };
      case 4: this.#requireBytes(offset, size, 'byte array'); return { value: b.subarray(offset, offset + size), next: offset + size };
      case 5: case 6: case 8: {
        this.#requireBytes(offset, size, 'integer');
        let n = 0;
        for (let i = 0; i < size; i++) n = n * 256 + b[offset + i];
        if (type === 8 && size === 4 && n >= 2 ** 31) n -= 2 ** 32;
        return { value: n, next: offset + size };
      }
      case 9: case 10: {
        this.#requireBytes(offset, size, 'big integer');
        let n = 0n;
        for (let i = 0; i < size; i++) n = (n << 8n) | BigInt(b[offset + i]);
        return { value: n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString(), next: offset + size };
      }
      case 7: {
        // Upfront fast-fail: a map needs at least 2 bytes per entry (a key control byte + a value
        // control byte), so a corrupted size that could never fit the remaining buffer is rejected
        // before the loop runs at all, rather than after size-many bounds-checked reads. Per-read
        // checks below are already sufficient for correctness (the loop can never read past the
        // buffer either way); this is purely a fail-fast/perf nicety for an absurd declared size.
        const remaining = b.length - offset;
        if (size * 2 > remaining) throw new MmdbFormatError(`map at offset ${offset} declares ${size} entries, needs at least ${size * 2} bytes but only ${remaining} remain`);
        /** @type {Record<string, unknown>} */ const map = {};
        for (let i = 0; i < size; i++) {
          const k = this.#decode(offset, depth + 1);
          const v = this.#decode(k.next, depth + 1);
          map[String(k.value)] = v.value;
          offset = v.next;
        }
        return { value: map, next: offset };
      }
      case 11: {
        const remaining = b.length - offset;
        if (size > remaining) throw new MmdbFormatError(`array at offset ${offset} declares ${size} entries, needs at least ${size} bytes but only ${remaining} remain`);
        const arr = [];
        for (let i = 0; i < size; i++) { const v = this.#decode(offset, depth + 1); arr.push(v.value); offset = v.next; }
        return { value: arr, next: offset };
      }
      case 12: return { value: null, next: offset }; // data cache container: not used by lookups
      case 13: return { value: null, next: offset }; // end marker
      case 14: return { value: size !== 0, next: offset };
      case 15: this.#requireBytes(offset, 4, 'float'); return { value: b.readFloatBE(offset), next: offset + 4 };
      default: throw new MmdbFormatError(`unknown MMDB data type ${type}`);
    }
  }
}
