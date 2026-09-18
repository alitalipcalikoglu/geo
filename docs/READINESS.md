# geo readiness contract

## Purpose

IP geolocation (own MaxMind DB reader over GeoLite2/GeoIP2/DB-IP/IPinfo-format files, no vendor
library), 249-country reference data (calling codes, currencies, time zones), currency and time
zone lookups via ICU, E.164 phone normalisation, great-circle distance, and your own named place
collections with radius search. Out of scope: geocoding, tz-from-coordinates (needs zone polygons),
national phone numbering plans, spatial queries beyond radius search.

## Dependencies

audit (`AUDIT_URL`/`AUDIT_API_KEY`), optional, both-or-neither. Nothing else — the MMDB files and
`data/countries.json` are local files, not a network dependency.

## Persistence

SQLite (`DB_PATH`): `collections` and `places` only (place data you upload) — standard migration
mechanism. The MMDB files (`MMDB_PATH`, optional; `ASN_MMDB_PATH`, optional) are read entirely into
memory at load time (`readFileSync` into a `Buffer`); `data/countries.json` (bundled with the code)
is a plain, versioned JSON table, not written to at runtime.

## Health endpoint

`GET /health`: static `{"status":"ok"}`.

## Readiness endpoint

`GET /ready`: `db.ping()` **and**, when `MMDB_PATH` is configured, that the IP database is actually
loaded. Cached 10 s. Read-only.

## Graceful shutdown

SIGTERM/SIGINT → `app.close()` → flush the audit forwarder → close the database → exit. Force-exit
30 s; PM2 `kill_timeout` 35 000 ms. `SIGHUP` is handled separately, not as a shutdown signal: it
triggers a database reload (below), the process keeps running.

## Resource limits

`MAX_BATCH` (IPs/phone numbers per batch call), `MAX_POINTS` (places per collection),
`MAX_RADIUS_KM` (largest radius a nearby query may ask for). `max_memory_restart`: 600M — the MMDB
file is held entirely in memory (a GeoLite2-City file is roughly 70 MB; larger commercial databases
need a correspondingly higher ceiling, noted in `ecosystem.config.cjs`).

## Timeouts

None of its own — every lookup is served from in-memory data or the local SQLite file; there is no
outbound call in the request path (the audit forwarder is fire-and-forget, off the request path).

## Retry policy

None: the MMDB read path is synchronous and in-memory, nothing to retry. A manual database reload
(`POST /v1/database/reload`) is a one-shot operation the caller repeats if it wants to try again.

## Idempotency

`PUT /v1/collections/:name/places` upserts by place `id`, all-or-nothing per call (one bad row
rejects the whole batch, nothing partially written). A database reload is naturally idempotent:
reloading the same file twice leaves the same data loaded.

## Backup

Place collections (the database) only — the MMDB files are a vendor download, not this service's
own state, and `data/countries.json` ships with the code.

## Restore

Restore the database and restart; separately ensure the MMDB file at `MMDB_PATH` is present (it is
not part of the database backup).

## Metrics

`GET /metrics`: `geo_collections`, `geo_places_total`, `geo_db_bytes`, `geo_database_loaded`,
`geo_database_build_epoch` are computed live (durable, or in the build-epoch case, a fact about the
loaded file, not a counter). `geo_ip_lookups_total{result}` is a process-local counter since start.

## Logging

Fastify's default request logging (`requestIdHeader: 'x-request-id'`, accepted unconditionally).
Redacts `authorization`.

## Tracing

Accepts an inbound `X-Request-Id` unconditionally. Also parses an inbound `traceparent` via
`@atc-web/service-core`'s `registerRequestContext`, trust-gated on `TRUST_PROXY` (same boundary as
`X-Forwarded-*`): trusted, the caller's trace-id is continued with a fresh span-id; untrusted or
malformed, a fresh trace is started. Both `traceId`/`spanId` are logged on every request line. See
[OBSERVABILITY.md](../../stack/docs/OBSERVABILITY.md).

## Security model

API keys (`id:secret[:role]`, roles `read`/`write`/`readwrite`; write covers collections, places,
and database reload). No checksum or signature verification of the MMDB file before loading it —
operator-supplied file is trusted as-is (the reader validates the file's own internal format
metadata marker, but not its provenance). No secret rotation beyond changing the key list.

## Scaling model

**A for lookups and reference data** (in-memory, read-only once loaded — any number of instances
could serve identical answers from identical files with no coordination), **B for place
collections** (one process owns the SQLite file). Overall classified **B** because one process owns
both, and there is no supported way to run the SQLite-backed half on more than one instance today.

## Single-node / multi-node guarantees

One process per database file, matching every other stateful service here; the read-only, in-memory
half (IP/reference lookups) would be safe to scale independently if it were ever split out, but it
is not split out today — `docs/READINESS.md`'s classification is for the service as shipped.

## Known failure modes

- A configured but unreadable/corrupt MMDB file at startup: recorded as a load error, `/ready`
  answers 503 for the "loaded" check, IP lookups answer `503 DATABASE_UNAVAILABLE`; every other
  feature (reference data, phone, distance, places) is unaffected.
- Manual reload failure (bad new file): as of Stage 0, `POST /v1/database/reload` answers
  `409 DATABASE_RELOAD_FAILED` with the reason, the previous, still-working database keeps serving
  — before Stage 0 this path threw an opaque 500 and left the recorded error stale, contradicting
  what the docs already claimed.
- MMDB decoder given a truncated-but-not-obviously-invalid file: the reader has no exhaustive
  bounds checking against every offset it reads (`src/geo/mmdb.js`) — a crafted or corrupted file
  could throw at lookup time rather than at load time; low risk in practice since the file is
  operator-supplied, not attacker-controlled, but noted as a known gap, not fixed in this stage.
- Two instances pointed at the same database file: unsupported; avoid.
