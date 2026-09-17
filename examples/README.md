# geo examples

Scenario-driven walkthroughs of every feature. Requests to `/v1/*` need `Authorization: Bearer <secret>` from `GEO_API_KEYS`. Base URL below is `http://localhost:3012`.

| Example | Shows |
|---|---|
| [IP geolocation](ip-lookup.md) | One IP, batches, the caller's own IP, special ranges, languages, what each field means |
| [IP databases](ip-databases.md) | Getting a free MMDB file, configuring it, updating it in place, the ASN database, running without one |
| [Countries](countries.md) | Codes, localized names, calling codes, currency, time zones, filters and search |
| [Currencies and time zones](currencies-and-timezones.md) | Symbols and decimals, offsets and DST right now, zones of a country |
| [Phone numbers](phone.md) | E.164 normalization, national numbers with a default country, shared calling codes, batches |
| [Distance](distance.md) | Great-circle distance and bearing between two points |
| [Places and nearby search](places.md) | Uploading your own points, nearest branches within a radius, attribute filters |
| [API keys and roles](keys-and-roles.md) | Read, write, readwrite; error codes |
| [Operations](operations.md) | Health, readiness, metrics, environment, memory, PM2, Docker, backups |
| [Audit events](audit-events.md) | Which write actions are forwarded to the audit service, event shape, configuration |

Set up once for the examples:

```bash
export GEO=http://localhost:3012
export KEY=<a readwrite secret from GEO_API_KEYS>
alias gcurl='curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json"'
```
