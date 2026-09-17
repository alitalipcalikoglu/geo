# API keys and roles

`GEO_API_KEYS` lists callers as `id:secret[:role]`, comma separated.

```
GEO_API_KEYS=console:9f2c…,shop-backend:41ab…:read,importer:c07e…:write
```

| Role | May call |
|---|---|
| `read` | IP lookups, reference data, phone, distance, nearby, browsing places, `/metrics` |
| `write` | Collections and places (create, upload, delete, clear), database reload |
| `readwrite` (default) | Everything |

Applications get `read`; the job that syncs branches gets `write`; the console gets `readwrite`.

## The service's own rate limit

`RATE_LIMIT_MAX` (3 000 per minute per key) protects the service; a gateway doing an IP lookup per request may need more, or should cache by address for a few minutes. Exceeding it answers `429 RATE_LIMITED` with `retry-after`.

## Error codes

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body or query does not match the schema (`details` lists the paths) |
| 400 | `INVALID_JSON` | Body is not JSON |
| 400 | `INVALID_IP` | Not an IPv4 or IPv6 address |
| 400 | `INVALID_COORDINATES` | Latitude or longitude out of range, bad `lat,lng`, radius out of range |
| 400 | `INVALID_PHONE` | Empty number or characters other than digits and separators |
| 400 | `INVALID_PLACE` | A place in an upload is bad (`details.index`) |
| 401 | `UNAUTHORIZED` | Missing or unknown bearer secret |
| 403 | `FORBIDDEN` | Role does not allow the call |
| 404 | `COUNTRY_NOT_FOUND`, `CURRENCY_NOT_FOUND`, `TIMEZONE_NOT_FOUND`, `COLLECTION_NOT_FOUND`, `PLACE_NOT_FOUND`, `NOT_FOUND` | Unknown code, name, collection, place or route |
| 409 | `COLLECTION_EXISTS` | Name taken |
| 413 | `BATCH_TOO_LARGE` | More than `MAX_BATCH` items, or a collection over `MAX_POINTS` |
| 429 | `RATE_LIMITED` | The service's own per-key limit |
| 409 | `DATABASE_RELOAD_FAILED` | POST /v1/database/reload could not read the configured file; the previous database keeps serving |
| 503 | `DATABASE_UNAVAILABLE` | IP lookup without a loaded database |
