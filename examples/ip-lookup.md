# IP geolocation

```bash
gcurl "$GEO/v1/ip/81.5.6.7?lang=tr"
```

```json
{
  "ip": "81.5.6.7",
  "version": 4,
  "kind": "public",
  "found": true,
  "network": "81.5.6.7/8",
  "country": { "code": "TR", "name": "Türkiye", "eu": false, "callingCodes": ["+90"], "currency": "TRY" },
  "registeredCountry": { "code": "TR", "name": "Türkiye", "eu": false, "callingCodes": ["+90"], "currency": "TRY" },
  "continent": { "code": "AS", "name": "Asya" },
  "region": { "code": "34", "name": "İstanbul" },
  "city": { "name": "İstanbul" },
  "postal": "34000",
  "location": { "lat": 41.0138, "lng": 28.9497, "accuracyKm": 50 },
  "timezone": "Europe/Istanbul",
  "asn": { "number": 9121, "organization": "Turk Telekom", "network": "81.5.6.7/8" },
  "source": "GeoLite2-City"
}
```

- `kind` classifies the address before any database is consulted: `public`, `private` (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7), `loopback`, `link-local`, `multicast`, `reserved` (documentation and benchmark ranges), `unspecified`. Only `public` addresses are looked up; the others return `found: false` without touching the database.
- `network` is the address with the prefix length of the matching database entry.
- `country` is where the address is used; `registeredCountry` is where it was allocated (they differ for satellite providers and multinational networks). Country entries are enriched from the built-in reference table (EU membership, calling codes, currency), so a Country-only database still gives useful context.
- `region`, `city`, `postal`, `location` and `accuracyKm` exist with City databases; Country databases return `null` for them.
- `timezone` comes from the database, or from the reference table when the country has exactly one zone.
- `asn` is filled when `ASN_MMDB_PATH` is set.
- `lang` picks localized names when the database carries them (GeoLite2 ships de, en, es, fr, ja, pt-BR, ru, zh-CN) and for the country name through ICU; English is the fallback.
- IPv6 addresses work the same; IPv4-mapped IPv6 (`::ffff:81.5.6.7`) is normalized to IPv4.

## Not found

```json
{ "ip": "9.9.9.9", "version": 4, "kind": "public", "found": false, "network": null, "country": null, "...": null, "source": "GeoLite2-City" }
```

A public address the database does not know. `source` says which database answered.

## The caller's own address

```bash
gcurl $GEO/v1/ip/self
```

Looks up the address the request came from (`X-Forwarded-For` is honoured only with `TRUST_PROXY=true`). Handy for a "where am I" endpoint routed through the gateway.

## Batches

```bash
gcurl -X POST $GEO/v1/ip/batch -d '{ "ips": ["8.8.8.8", "not-an-ip", "10.0.0.1"], "lang": "en" }'
```

```json
{
  "items": [
    { "ip": "8.8.8.8", "ok": true, "result": { "found": true, "country": { "code": "US", "...": "..." }, "...": "..." } },
    { "ip": "not-an-ip", "ok": false, "error": { "code": "INVALID_IP", "message": "\"not-an-ip\" is not an IP address" } },
    { "ip": "10.0.0.1", "ok": true, "result": { "found": false, "kind": "private", "...": "..." } }
  ]
}
```

Up to `MAX_BATCH` (100) addresses; each entry succeeds or fails on its own.

## Without a database

With `MMDB_PATH` empty, public addresses answer `503 DATABASE_UNAVAILABLE`; classification of special ranges still works. `/ready` stays green (no database is a valid configuration); a configured file that fails to load turns `/ready` red.
