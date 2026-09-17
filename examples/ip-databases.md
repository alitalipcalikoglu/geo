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

Download the new file next to the old one, move it over atomically, then reload:

```bash
curl -sL -o /var/lib/geo/GeoLite2-City.mmdb.new "$DOWNLOAD_URL"
mv /var/lib/geo/GeoLite2-City.mmdb.new /var/lib/geo/GeoLite2-City.mmdb
gcurl -X POST $GEO/v1/database/reload      # write role
```

Or send `SIGHUP` to the process (`pm2 sendSignal SIGHUP geo`). A reload that fails (missing file, corrupt download) keeps the previous database serving and reports the error in `/v1/database`; a failure at start-up makes `/ready` answer 503 until a reload succeeds. Schedule the download with the scheduler service (weekly `at`/cron job calling a small script on the host) and the reload call after it.

## Running without one

Leave `MMDB_PATH` empty. IP classification, countries, currencies, time zones, phone numbers, distances and places all work; `/v1/ip/*` answers `503 DATABASE_UNAVAILABLE` for public addresses.
