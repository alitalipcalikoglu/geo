# IP databases

The service reads MaxMind DB (`.mmdb`) files with its own reader; no vendor library, no account needed at runtime. Any vendor using the format works:

| Database | Cost | Fields | Where |
|---|---|---|---|
| GeoLite2-City / GeoLite2-Country / GeoLite2-ASN | free, account required, weekly updates | city, subdivision, postal, coordinates, time zone, localized names | dev.maxmind.com |
| DB-IP Lite (city, country, asn) | free, CC BY 4.0, monthly | city, coordinates | db-ip.com/db/lite.php |
| IPinfo free country / ASN | free, account | country, ASN | ipinfo.io |
| GeoIP2 commercial | paid | as GeoLite2, higher accuracy | maxmind.com |

Accuracy is coarse by nature: city level is right most of the time for fixed lines, wrong for mobile carriers and VPNs. Use the result for defaults (language, currency, nearest branch), never for access control.

## Configure

```
MMDB_PATH=/var/lib/geo/GeoLite2-City.mmdb
ASN_MMDB_PATH=/var/lib/geo/GeoLite2-ASN.mmdb
# Optional: verify a file's SHA-256 before every (re)load. See "Checksum verification" below.
MMDB_SHA256=
ASN_MMDB_SHA256=
```

The whole file is read into memory at start (GeoLite2-City is about 70 MB, Country 6 MB); the PM2 file sets `max_memory_restart` accordingly.

## Inspect

```bash
gcurl $GEO/v1/database
```

```json
{
  "configured": true, "loaded": true, "error": null, "loadedAt": "2026-09-17T06:00:00.000Z",
  "city": { "type": "GeoLite2-City", "buildEpoch": 1758067200, "builtAt": "2026-09-17T00:00:00.000Z", "ipVersion": 6, "nodeCount": 4186010, "recordSize": 28, "languages": ["de", "en", "es", "fr", "ja", "pt-BR", "ru", "zh-CN"], "description": { "en": "GeoLite2 City database" }, "path": "/var/lib/geo/GeoLite2-City.mmdb", "sizeBytes": 71203941, "modifiedAt": "2026-09-17T05:58:11.000Z" },
  "asn": { "type": "GeoLite2-ASN", "...": "..." },
  "lookups": { "hit": 48210, "miss": 131, "special": 902 }
}
```

`builtAt` tells how stale the data is; alert when it is older than a month.

## Update in place

Never download straight onto the path the service already has open (`MMDB_PATH`/`ASN_MMDB_PATH`): a reader that is mid-open or mid-lookup on another thread of execution (or simply the next request, since the file is only read once at load time but a reload can race an in-flight download) could read a half-written file. Always download to a new path, verify it, then atomically replace the old file, and only then ask the service to reload:

```bash
# 1. Download to a NEW path next to the old one, never on top of it.
curl -sL -o /var/lib/geo/GeoLite2-City.mmdb.new "$DOWNLOAD_URL"

# 2. Verify its checksum against the value the vendor publishes for this build.
echo "$EXPECTED_SHA256  /var/lib/geo/GeoLite2-City.mmdb.new" | sha256sum -c -

# 3. Atomic replace: rename() on the same filesystem is atomic, so a concurrent open() of the
#    old path either sees the fully-old or fully-new file, never a partial write.
mv /var/lib/geo/GeoLite2-City.mmdb.new /var/lib/geo/GeoLite2-City.mmdb

# 4. Trigger a reload. The service re-verifies the checksum itself (if configured, see below),
#    re-validates the file structurally, and only swaps it in if every check passes.
gcurl -X POST $GEO/v1/database/reload      # write role
```

Or send `SIGHUP` to the process (`pm2 sendSignal SIGHUP geo`). A reload that fails (missing file, corrupt download, checksum mismatch, structural validation failure) keeps the previous database serving and reports the error in `/v1/database`; the manual `POST /v1/database/reload` also answers `409 DATABASE_RELOAD_FAILED` with the error message, so a deploy script can detect it directly instead of polling `/v1/database`. A failure at start-up makes `/ready` answer 503 until a reload succeeds. Schedule the download with the scheduler service (weekly `at`/cron job calling a small script on the host) and the reload call after it.

### Checksum verification before reload

Before a candidate file is opened as an MMDB at all, the service can verify its SHA-256 against a value the operator supplies out-of-band. Both mechanisms are optional and off by default (no behavior change for a deployment that configures neither); if both are present for a path, the environment variable wins.

- **Env var**: set `MMDB_SHA256` (and/or `ASN_MMDB_SHA256`) to the expected 64-character hex digest. The whole file's bytes must hash to exactly this value or the reload is rejected with a "checksum mismatch" error that names both the expected and actual digest (the file's own hash is not sensitive, so logging both is safe and saves an operator a manual `sha256sum` run to diagnose it).
- **Sidecar file**: drop `GeoLite2-City.mmdb.sha256` next to `GeoLite2-City.mmdb`, in the same format `sha256sum` itself produces (`<hex-digest>  <filename>\n`). Used automatically when present and no env var is set for that path.

```bash
sha256sum /var/lib/geo/GeoLite2-City.mmdb > /var/lib/geo/GeoLite2-City.mmdb.sha256
```

Either way, verification happens on the raw file bytes before the file is parsed as an MMDB, so a corrupted or tampered download is caught before any of the (more expensive) structural validation described below runs.

### What a reload validates before swapping the database in

A reload does not trust a file just because it opens: after metadata decodes, the candidate must also pass a lookup for a couple of fixed, well-known public addresses (not a specific expected answer, just that the lookup completes without a decoding error) before it replaces the database currently serving. Only once a candidate passes every check — checksum (if configured), structural decode, validation lookups — does it become the active database; a failure at any step leaves the previous, still-good database exactly as it was.

## Running without one

Leave `MMDB_PATH` empty. IP classification, countries, currencies, time zones, phone numbers, distances and places all work; `/v1/ip/*` answers `503 DATABASE_UNAVAILABLE` for public addresses.
