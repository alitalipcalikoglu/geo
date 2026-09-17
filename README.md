# geo

Geo and reference lookups for the other services and your applications: IP address to country, city, coordinates, time zone and ASN from a MaxMind DB file read with a built-in reader (GeoLite2, DB-IP, IPinfo, GeoIP2), 249 countries with localized names, calling codes, currencies and time zones, currency symbols and decimals, zone offsets and DST right now, E.164 phone normalization, great-circle distance, and your own place collections with nearby search. HTTP only.

Runtime dependencies: `fastify`, `@fastify/rate-limit`. Storage is SQLite via `node:sqlite` (built into Node 22.13+); names and offsets come from Node's ICU. The folder is self-contained: copy it to any host with Node 22 and run.

## Run

```bash
cp .env.example .env        # set GEO_API_KEYS; MMDB_PATH for IP geolocation
npm ci
npm run dev
```

Production with PM2 (reads `./.env` through Node's `--env-file`):

```bash
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

Production with Docker (mount the database directory and the MMDB files):

```bash
docker build -t atc-geo .
docker run -p 3012:3012 -v geo-data:/data -v /var/lib/geo:/mmdb:ro -e MMDB_PATH=/mmdb/GeoLite2-City.mmdb --env-file .env atc-geo
```

Tests and type check:

```bash
npm test
npm run typecheck
```

## Model

- **IP lookup** classifies the address first (`public`, `private`, `loopback`, `link-local`, `multicast`, `reserved`, `unspecified`) and consults the database only for public ones. Results have one shape whatever the vendor: country (enriched with calling codes, currency, EU flag), registered country, continent, region, city, postal code, coordinates with accuracy radius, time zone, ASN. Databases reload in place (`POST /v1/database/reload` or `SIGHUP`); a failed reload keeps the previous data.
- **Reference data**: countries (alpha-2, alpha-3, numeric, continent, EU, calling codes, currency, primary IANA zones, flag), currencies (name, symbol, decimals, users), time zones (offset, abbreviation, DST state, local time, countries). Names in any language ICU knows.
- **Phone**: E.164 normalization from the calling-code table with trunk-prefix handling and shared-code disambiguation; length validity only, no national plans.
- **Distance**: haversine km/m/mi and bearing.
- **Places**: named collections of `{ id, name, lat, lng, attrs }`, upserted all-or-nothing; nearby search within a radius with attribute filters, nearest first.
- **Keys** are `id:secret[:role]` with roles `read`, `write`, `readwrite`.

## Boundaries

**Purpose:** IP geolocation, phone normalization, distance, and place-collection lookups.

**Responsibilities:** IP/ASN lookup via MMDB; E.164 phone normalization; distance calculation; place collection CRUD and nearby search; manual and SIGHUP-triggered MMDB reload.

**Non-responsibilities:** not authoritative for the MMDB data itself — it consumes a third-party database file and does not maintain or verify its accuracy; reload has no checksum/integrity verification today (a real gap, tracked as a pre-existing item, not fixed here). Place collections are a convenience store, not a general-purpose geospatial database.

## API

Errors are JSON: `{ "error": { "code", "message", "details?" } }`. `lang` (BCP 47) is accepted by every reference endpoint.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health`, `/ready` | none | Liveness; readiness (database, IP database when configured; cached 10 s). |
| GET | `/v1/ip/:ip`, `/v1/ip/self` | read | Geolocation of an address, or of the caller. |
| POST | `/v1/ip/batch` | read | `{ ips: [...], lang? }` → per-address results or errors. |
| GET / POST | `/v1/database`, `/v1/database/reload` | read / write | Loaded databases, build dates, lookup counters; reload the files. |
| GET | `/v1/countries`, `/v1/countries/:code` | read | `q`, `continent`, `eu`, `currency`, `lang`; one country by alpha-2, alpha-3 or numeric code. |
| GET | `/v1/currencies`, `/v1/currencies/:code` | read | Currencies in use with symbol, decimals, countries. |
| GET | `/v1/timezones`, `/v1/timezones/:name` | read | `country`, `q`; one zone with current offset and DST state. |
| GET / POST | `/v1/phone`, `/v1/phone/batch` | read | `number`, `country?` → E.164, country candidates, validity. |
| GET | `/v1/distance` | read | `from=lat,lng&to=lat,lng` → km, m, mi, bearing. |
| GET / POST | `/v1/collections` | read / write | Collections with place counts; `{ name, description? }` → `201`. |
| GET / PATCH / DELETE | `/v1/collections/:name` | read / write | One collection; description; delete with its places. |
| POST | `/v1/collections/:name/clear` | write | Remove every place → `{ removed }`. |
| PUT / GET | `/v1/collections/:name/places` | write / read | `{ places: [...] }` upsert → `{ created, updated, total }`; browse (`limit`, `offset`). |
| GET / DELETE | `/v1/collections/:name/places/:id` | read / write | One place; delete. |
| GET | `/v1/collections/:name/nearby` | read | `lat`, `lng`, `radius` (km), `limit`, `filter.<key>=v` → nearest places with distance and bearing. |
| GET | `/v1/stats` | read | Database info, counts, sizes. |
| GET | `/metrics` | read | Prometheus text: lookups by result, database loaded and build epoch, collections, places, database size, uptime. |

Examples for every feature, with requests and responses: [examples/README.md](examples/README.md).

## Configuration

Environment only; see [.env.example](.env.example). Required: `GEO_API_KEYS`. IP geolocation needs `MMDB_PATH` (and optionally `ASN_MMDB_PATH`); see [examples/ip-databases.md](examples/ip-databases.md) for free databases. Notable: `DEFAULT_LANG`, `MAX_BATCH`, `MAX_POINTS`, `MAX_RADIUS_KM`, `RATE_LIMIT_MAX`, `TRUST_PROXY` (needed for `/v1/ip/self` behind a proxy), `TLS_CERT_PATH` / `TLS_KEY_PATH`.

## Layout

```
src/
  config.js                 Config.fromEnv, key parsing
  db.js                     SQLite connection, migrations, transactions (collections, places)
  application.js            composition root, lifecycle, SIGHUP reload
  geo/ip-address.js         IPv4/IPv6 parsing to 16 bytes, special-range classification (node:net BlockList)
  geo/mmdb.js               MaxMind DB reader: search tree, data section, pointers, metadata
  geo/geo-point.js          coordinate validation, haversine, bearing, bounding boxes
  domain/ip-lookup.js       normalised geolocation over city/country and ASN databases, reload
  domain/reference.js       countries, currencies, time zones over data/countries.json + Intl
  domain/phone.js           E.164 normalisation
  domain/places-service.js  collections, all-or-nothing upserts, nearby search
  data/countries.json       249 rows: codes, continent, calling codes, currency, zones, EU
  store/                    CollectionStore, PlaceStore
  http/geo-api.js           Fastify routes, error mapping, probes, metrics
  http/api-key-auth.js      constant-time bearer auth, roles
test/                       node:test suites; test/mmdb-writer.js builds MMDB files for the reader tests
examples/                   one walkthrough per feature
```

## Out of scope

- Geocoding and address normalization (street address to coordinates and back): needs a map dataset or a provider; call one from your application and store the result in a place collection if you need nearby search on it.
- Time zone from coordinates: needs zone polygons. The IP lookup returns the zone when the database carries it; otherwise use the country's zones.
- National phone numbering plans (operator prefixes, exact lengths): the service validates E.164 shape and country only.
- Spatial queries beyond radius search (polygons, routing): use PostGIS or a routing engine.

## Audit events

With `AUDIT_URL` and `AUDIT_API_KEY` set, every completed write request is forwarded to the audit service as one event (`success`, or `denied` on 403) with the calling key as actor, the affected entity as target, client IP, user agent and request id. Events are buffered and sent in batches; the audit service being down never fails a request. Actions: see [examples/audit-events.md](examples/audit-events.md).

## Scaling model

Single-node stateful for place collections (one process owns the SQLite file); the IP/reference
lookups are read-only and in-memory once loaded, which would scale independently if ever split out
— it is not split out today, so the service as a whole is classified single-node.

## Observability

Accepts an inbound `X-Request-Id` unconditionally and logs it via Fastify's default request
logging. Does not parse or forward `traceparent`.

## Backup / restore

Back up the database (place collections); the MMDB file is a vendor download, not this service's
own state, and is not part of the backup. Use `stack backup`/`stack restore` from the workspace
root (see `stack/docs/UPGRADE.md`) to do this consistently alongside the rest of the stack. On
every start, before applying a pending migration to an existing database, the service itself also
snapshots the file to `DB_PATH.pre-v<N>-<timestamp>` (directory overridable with
`DB_BACKUP_DIR`) — a manual last resort if `stack restore` is unavailable.

**Rollback limitations:** none of the migrations are reversible; to roll back, restore the
pre-migration copy (or a `stack backup` snapshot taken before the upgrade) and run the previous
version of this service against it.

See [docs/READINESS.md](docs/READINESS.md) for the full contract.

## License

MIT, Ali Talip CALIKOGLU.
