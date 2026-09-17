import assert from 'node:assert/strict';
import { test } from 'node:test';
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
