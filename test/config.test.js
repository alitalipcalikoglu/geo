import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config, ConfigError } from '../src/config.js';
import { testEnv } from './helpers.js';

test('Config: defaults and key roles', () => {
  const c = Config.fromEnv(testEnv());
  assert.deepEqual(c.apiKeys.map((k) => [k.id, k.role]), [['console', 'readwrite'], ['site', 'read'], ['loader', 'write']]);
  assert.deepEqual([c.port, c.mmdbPath, c.asnMmdbPath, c.maxBatch, c.maxPoints, c.maxRadiusKm, c.defaultLang, c.bodyLimit], [0, 'city.mmdb', 'asn.mmdb', 3, 6, 500, 'en', 2_097_152]);
  assert.equal(Config.fromEnv(testEnv({ DEFAULT_LANG: 'tr-TR' })).defaultLang, 'tr-TR');
  assert.ok(Object.isFrozen(c));
});

test('Config: rejects bad input', () => {
  const bad = (/** @type {Record<string,string>} */ o, /** @type {RegExp} */ re) => assert.throws(() => Config.fromEnv(testEnv(o)), (e) => e instanceof ConfigError && re.test(e.message));
  bad({ GEO_API_KEYS: '' }, /GEO_API_KEYS is required/);
  bad({ GEO_API_KEYS: 'a:short' }, /at least 32/);
  bad({ GEO_API_KEYS: `a:${'a'.repeat(40)}:owner` }, /one of read, write, readwrite/);
  bad({ GEO_API_KEYS: `a:${'a'.repeat(40)}:read:extra` }, /id:secret\[:role\]/);
  bad({ DEFAULT_LANG: 'no such lang!' }, /valid language tag/);
  bad({ MAX_RADIUS_KM: '0' }, />= 1/);
  bad({ TLS_CERT_PATH: '/x.pem' }, /must be set together/);
  bad({ MMDB_SHA256: 'not-hex' }, /MMDB_SHA256 must be a 64-character SHA-256 hex digest/);
  bad({ MMDB_SHA256: 'a'.repeat(63) }, /MMDB_SHA256 must be a 64-character SHA-256 hex digest/);
  bad({ ASN_MMDB_SHA256: 'a'.repeat(65) }, /ASN_MMDB_SHA256 must be a 64-character SHA-256 hex digest/);
});

test('Config: MMDB_SHA256/ASN_MMDB_SHA256 are optional and lower-cased', () => {
  assert.deepEqual([Config.fromEnv(testEnv()).mmdbSha256, Config.fromEnv(testEnv()).asnMmdbSha256], [null, null]);
  const hex = 'A'.repeat(64);
  const c = Config.fromEnv(testEnv({ MMDB_SHA256: hex, ASN_MMDB_SHA256: hex }));
  assert.deepEqual([c.mmdbSha256, c.asnMmdbSha256], ['a'.repeat(64), 'a'.repeat(64)]);
});
