import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MmdbFormatError } from '../src/domain/errors.js';
import { IpAddress } from '../src/geo/ip-address.js';
import { MmdbReader } from '../src/geo/mmdb.js';
import { cityDatabase } from './mmdb-writer.js';

const look = (/** @type {MmdbReader} */ r, /** @type {string} */ ip) => { const p = /** @type {any} */ (IpAddress.parse(ip)); return r.lookup(p.bytes, p.version); };

test('IpAddress: parsing, canonical text and classification', () => {
  assert.deepEqual(IpAddress.parse('::ffff:10.0.0.1'), { version: 4, bytes: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 1]), text: '10.0.0.1' });
  assert.equal(IpAddress.parse('2A02:6B8:0000:0:0:0:2:242')?.text, '2a02:6b8::2:242');
  assert.equal(IpAddress.parse('1:0:0:1:0:0:0:1')?.text, '1:0:0:1::1');
  assert.equal(IpAddress.parse('300.1.1.1'), null);
  assert.equal(IpAddress.parse('abc'), null);
  const kinds = ['8.8.8.8', '10.1.2.3', '172.31.9.9', '192.168.0.1', '127.0.0.1', '169.254.1.1', '224.0.0.1', '203.0.113.9', '0.0.0.0', '::1', 'fd12::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::', '2a02:6b8::1'].map((s) => IpAddress.classify(/** @type {any} */ (IpAddress.parse(s))));
  assert.deepEqual(kinds, ['public', 'private', 'private', 'private', 'loopback', 'link-local', 'multicast', 'reserved', 'unspecified', 'loopback', 'private', 'link-local', 'multicast', 'reserved', 'unspecified', 'public']);
});

for (const recordSize of /** @type {const} */ ([24, 28, 32])) {
  test(`MmdbReader: IPv6 tree with record size ${recordSize}, IPv4 lookups, pointers, misses`, () => {
    const r = new MmdbReader(cityDatabase({ recordSize }));
    assert.deepEqual([r.metadata.database_type, r.metadata.ip_version, r.metadata.record_size, r.metadata.languages], ['Test-City', 6, recordSize, ['en', 'tr']]);
    const tr = look(r, '81.5.6.7');
    assert.equal(tr?.prefixLength, 8);
    const d = /** @type {any} */ (tr?.data);
    assert.deepEqual([d.country.iso_code, d.city.names.tr, d.subdivisions[0].iso_code, d.location.latitude, d.location.accuracy_radius, d.location.time_zone, d.traits.is_anonymous_proxy], ['TR', 'İstanbul', '34', 41.0138, 50, 'Europe/Istanbul', false]);
    assert.equal(d.registered_country.names.en, 'Turkey', 'pointer to a repeated string resolves');
    assert.equal(/** @type {any} */ (look(r, '8.8.8.8')?.data).country.iso_code, 'US');
    assert.equal(look(r, '8.8.9.1'), null, 'outside the /24');
    assert.equal(look(r, '9.9.9.9'), null);
    const ru = look(r, '2a02:6b8::2:242');
    assert.deepEqual([ru?.prefixLength, /** @type {any} */ (ru?.data).city.names.en], [32, 'Moscow']);
    assert.equal(look(r, '2001:db8::1'), null);
    assert.equal(look(r, '::ffff:81.1.1.1')?.prefixLength, 8, 'mapped IPv4 walks the IPv4 subtree');
    assert.match(r.info().builtAt, /^2025-/);
  });
}

test('MmdbReader: IPv4-only tree answers IPv4 and refuses IPv6', () => {
  const r = new MmdbReader(cityDatabase({ ipVersion: 4 }));
  assert.equal(/** @type {any} */ (look(r, '81.200.1.1')?.data).country.iso_code, 'TR');
  assert.equal(look(r, '2a02:6b8::1'), null);
  assert.throws(() => new MmdbReader(Buffer.from('nope')), /metadata marker missing/);
});

// --- Malformed/truncated corpus -------------------------------------------------------------
//
// Every case below must throw MmdbFormatError, never a generic RangeError and never a silent
// `undefined`/garbage return. Two techniques build the malformed inputs:
//  - Direct corruption: overwrite a real node-table record's bytes in a valid buffer so it decodes
//    to a value that resolves outside the buffer.
//  - Trailer redirection: append hand-crafted bytes to the very end of a valid buffer (after its
//    metadata, which is unaffected since `lastIndexOf` finds it regardless of what follows) and
//    redirect one tree record to point at them, so `lookup()` decodes exactly those bytes. This is
//    the only way to exercise a fixed-size read (e.g. a `double`) genuinely running past the end of
//    the buffer: once anything else follows a value in the file, a fixed-size read into it succeeds
//    (with wrong data) rather than throwing, since bounds-checking has no notion of "data section
//    end", only of the physical end of the buffer.

/** Re-walks the tree exactly like `MmdbReader#lookup`/`#record` (duplicated here for tests, same reason `MmdbWriter.add` duplicates the bit-walk) to find the (node, side) whose record is the hit for `ipText`. @param {MmdbReader} r @param {string} ipText */
function findHitRecord(r, ipText) {
  const ip = /** @type {NonNullable<ReturnType<typeof IpAddress.parse>>} */ (IpAddress.parse(ipText));
  const totalBits = ip.version === 4 ? 32 : 128;
  let bitIndex = ip.version === 4 ? 96 : 0;
  let node = ip.version === 4 && r.metadata.ip_version === 6 ? r.ipv4Start : 0;
  const readRecord = (/** @type {number} */ n, /** @type {number} */ side) => {
    const base = n * r.nodeBytes;
    const b = r.buf;
    if (r.recordSize === 24) { const o = base + side * 3; return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]; }
    if (r.recordSize === 28) {
      if (side === 0) return ((b[base + 3] & 0xf0) << 20) | (b[base] << 16) | (b[base + 1] << 8) | b[base + 2];
      return ((b[base + 3] & 0x0f) << 24) | (b[base + 4] << 16) | (b[base + 5] << 8) | b[base + 6];
    }
    return b.readUInt32BE(base + side * 4);
  };
  for (let bit = 0; bit < totalBits; bit++, bitIndex++) {
    const side = (ip.bytes[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
    const record = readRecord(node, side);
    if (record > r.nodeCount) return { node, side };
    node = record;
  }
  throw new Error(`${ipText} never reaches a leaf in this test tree`);
}

/** Writes a raw node-table record value (inverse of `findHitRecord`'s `readRecord`). @param {Buffer} buf @param {MmdbReader} r @param {number} node @param {number} side @param {number} value */
function writeRecord(buf, r, node, side, value) {
  const base = node * r.nodeBytes;
  if (r.recordSize === 24) { buf.writeUIntBE(value, base + side * 3, 3); return; }
  if (r.recordSize === 28) {
    if (side === 0) { buf.writeUIntBE(value & 0xffffff, base, 3); buf[base + 3] = (buf[base + 3] & 0x0f) | (((value >> 24) & 0x0f) << 4); }
    else { buf[base + 3] = (buf[base + 3] & 0xf0) | ((value >> 24) & 0x0f); buf.writeUIntBE(value & 0xffffff, base + 4, 3); }
    return;
  }
  buf.writeUInt32BE(value, base + side * 4);
}

/** Builds a reader whose `lookup(ipText)` decodes exactly `trailerBytes`, by redirecting that IP's tree record to freshly appended trailer bytes. @param {MmdbReader} probe @param {Buffer} goodBuf @param {string} ipText @param {readonly number[]} trailerBytes */
function readerWithTrailer(probe, goodBuf, ipText, trailerBytes) {
  const { node, side } = findHitRecord(probe, ipText);
  const trailerOffset = goodBuf.length;
  const full = Buffer.concat([goodBuf, Buffer.from(trailerBytes)]);
  writeRecord(full, probe, node, side, probe.nodeCount + MmdbReader.DATA_SEPARATOR + (trailerOffset - probe.dataStart));
  return new MmdbReader(full);
}

const throwsFormatError = (/** @type {() => unknown} */ fn) => assert.throws(fn, (e) => e instanceof MmdbFormatError && !(e instanceof RangeError));

test('MmdbReader: file truncated right after the metadata marker has no metadata bytes', () => {
  throwsFormatError(() => new MmdbReader(Buffer.from(MmdbReader.METADATA_MARKER)));
});

test('MmdbReader: file truncated mid-metadata-decode', () => {
  const good = cityDatabase();
  for (const cut of [1, 3, 8]) throwsFormatError(() => new MmdbReader(good.subarray(0, good.length - cut)));
});

test('MmdbReader: a node-table record pointing outside the buffer throws on lookup, not construction', () => {
  const good = cityDatabase({ recordSize: 24 });
  const probe = new MmdbReader(good);
  const { node, side } = findHitRecord(probe, '8.8.8.8');
  const corrupted = Buffer.from(good);
  writeRecord(corrupted, probe, node, side, 0xffffff); // max 24-bit value: way past nodeCount, way past the buffer once treated as a data offset
  const bad = new MmdbReader(corrupted); // metadata untouched: constructs fine
  throwsFormatError(() => look(bad, '8.8.8.8'));
});

for (const [ss, trailer] of /** @type {const} */ ([[0, [0x27, 0xff]], [1, [0x2f, 0xff, 0xff]], [2, [0x37, 0xff, 0xff, 0xff]], [3, [0x38, 0xff, 0xff, 0xff, 0xff]]])) {
  test(`MmdbReader: a pointer (ss=${ss}) resolving outside the data section throws`, () => {
    const good = cityDatabase({ recordSize: 24 });
    const probe = new MmdbReader(good);
    const bad = readerWithTrailer(probe, good, '8.8.8.8', trailer);
    throwsFormatError(() => look(bad, '8.8.8.8'));
  });
}

for (const [label, trailer] of /** @type {const} */ ([['size=29', [0x5d, 0xff]], ['size=30', [0x5e, 0xff, 0xff]], ['size=31', [0x5f, 0xff, 0xff, 0xff]]])) {
  test(`MmdbReader: a string control byte with extended ${label} declaring more bytes than remain throws`, () => {
    const good = cityDatabase({ recordSize: 24 });
    const probe = new MmdbReader(good);
    const bad = readerWithTrailer(probe, good, '8.8.8.8', trailer);
    throwsFormatError(() => look(bad, '8.8.8.8'));
  });
}

test('MmdbReader: a map declaring more entries than the buffer could hold throws before decoding any of them', () => {
  const good = cityDatabase({ recordSize: 24 });
  const probe = new MmdbReader(good);
  const bad = readerWithTrailer(probe, good, '8.8.8.8', [0xe5]); // type=7 (map), size=5, then nothing
  throwsFormatError(() => look(bad, '8.8.8.8'));
});

test('MmdbReader: an array declaring more entries than the buffer could hold throws before decoding any of them', () => {
  const good = cityDatabase({ recordSize: 24 });
  const probe = new MmdbReader(good);
  const bad = readerWithTrailer(probe, good, '8.8.8.8', [0x05, 0x04]); // extended type=11 (array), size=5, then nothing
  throwsFormatError(() => look(bad, '8.8.8.8'));
});

for (const [label, trailer] of /** @type {const} */ ([
  ['string', [0x45]], // type=2, size=5
  ['bytes', [0x83]], // type=4, size=3
  ['double', [0x68]], // type=3, size=8 (fixed, size byte is ignored but written for realism)
  ['float', [0x00, 0x08]], // extended type=15, size=0
  ['unsigned integer', [0xa2]], // type=5, size=2
  ['64-bit integer', [0x08, 0x02]], // extended type=9, size=8
])) {
  test(`MmdbReader: a ${label} whose declared size runs past the end of the buffer throws`, () => {
    const good = cityDatabase({ recordSize: 24 });
    const probe = new MmdbReader(good);
    const bad = readerWithTrailer(probe, good, '8.8.8.8', trailer);
    throwsFormatError(() => look(bad, '8.8.8.8'));
  });
}
