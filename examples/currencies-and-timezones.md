# Currencies and time zones

## Currencies

Every ISO 4217 code used by at least one country, with the countries using it:

```bash
gcurl "$GEO/v1/currencies/try?lang=tr"
```

```json
{ "currency": { "code": "TRY", "name": "Türk lirası", "symbol": "₺", "decimals": 2, "countries": ["TR"] } }
```

`decimals` is the minor-unit count for formatting and for storing amounts as integers (JPY 0, BHD 3). `symbol` is what `Intl.NumberFormat` prints in that language (`TRY` in English, `₺` in Turkish). The full list:

```bash
gcurl "$GEO/v1/currencies?lang=en"
```

## Time zones

```bash
gcurl "$GEO/v1/timezones/Europe/Istanbul?lang=en"
```

```json
{
  "timezone": {
    "name": "Europe/Istanbul", "offset": "+03:00", "offsetMinutes": 180, "abbreviation": "GMT+3",
    "longName": "Turkey Standard Time", "dst": false, "observesDst": false,
    "localTime": "2026-09-17T09:00:00", "countries": ["TR"]
  }
}
```

- `offset` is the offset right now; `dst` says whether daylight saving is in effect right now; `observesDst` whether the zone switches at all this year.
- `localTime` is the wall-clock time at the moment of the call.
- Aliases resolve (`Europe/Kiev` and `Europe/Kyiv`, `Asia/Calcutta` and `Asia/Kolkata`); the response echoes the name it resolved to.

Zones of a country, or a search:

```bash
gcurl "$GEO/v1/timezones?country=PT"        # Europe/Lisbon, Atlantic/Madeira, Atlantic/Azores
gcurl "$GEO/v1/timezones?q=america/arg"     # substring on the name
gcurl "$GEO/v1/timezones"                   # every zone ICU knows (400+)
```

Offsets are computed for the instant of the request, so a scheduler can ask "what is 09:00 in the user's zone" once a day and stay correct across DST changes.
