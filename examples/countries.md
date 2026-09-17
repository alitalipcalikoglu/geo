# Countries

249 ISO 3166-1 entries with alpha-2, alpha-3 and numeric codes, continent, EU membership, calling codes, currency and primary IANA time zones. Names come from the runtime's ICU data in the requested language.

```bash
gcurl "$GEO/v1/countries/tr?lang=tr"
```

```json
{
  "country": {
    "code": "TR", "alpha3": "TUR", "numeric": "792", "name": "Türkiye",
    "continent": { "code": "AS", "name": "Asia" }, "eu": false,
    "callingCodes": ["+90"], "currency": { "code": "TRY", "name": "Türk lirası" },
    "timezones": ["Europe/Istanbul"], "flag": "🇹🇷"
  }
}
```

Any of the three codes works in the path (`tr`, `TUR`, `792`).

## Lists

```bash
gcurl "$GEO/v1/countries?lang=en"                 # every country, sorted by name in that language
gcurl "$GEO/v1/countries?continent=EU&eu=true"    # the 27 EU members
gcurl "$GEO/v1/countries?currency=XOF"            # West African CFA franc users
gcurl "$GEO/v1/countries?q=türk&lang=en"          # name or code prefix; accents and Turkish i are folded
```

`q` matches the localized name (substring, folded) and the alpha-2 / alpha-3 prefix, so a country picker can search in the user's language.

## A country picker

```js
const res = await fetch(`/api/geo/countries?lang=${navigator.language}`);
const { items } = await res.json();
select.replaceChildren(...items.map((c) => new Option(`${c.flag} ${c.name} (${c.callingCodes[0] ?? ''})`, c.code)));
```

Cache the list for a day: it changes with ICU updates, not with traffic.

## Where the facts come from

Calling codes, currencies, continents, EU membership and primary zones are in `src/data/countries.json` (one line per country). Multi-zone countries list their main zones (the United States lists seven, Russia fourteen); zones for small territories follow the IANA database. Names, currency symbols and zone offsets come from Intl, so they follow Node's ICU version. Kosovo has no ISO code and is not listed.
