# Phone numbers

Normalization to E.164 from the calling-code table. No national numbering plans: the service knows which country a `+xx` prefix belongs to and enforces the E.164 length rule, not whether the subscriber number exists or has the right length for its operator.

```bash
gcurl "$GEO/v1/phone?number=%2B90%20(532)%20123%2045%2067"
```

```json
{ "input": "+90 (532) 123 45 67", "e164": "+905321234567", "valid": true, "reason": null, "country": "TR", "countries": ["TR"], "callingCode": "+90", "national": "5321234567" }
```

## National numbers

A number without `+` or `00` needs the country it was typed in:

```bash
gcurl "$GEO/v1/phone?number=0532%20123%2045%2067&country=TR"     # → +905321234567 (trunk 0 dropped)
gcurl "$GEO/v1/phone?number=(212)%20555-0100&country=US"         # → +12125550100
gcurl "$GEO/v1/phone?number=011%2044%2020%207946%200958&country=US"   # US international prefix 011 → +442079460958
```

Without a country the answer is `valid: false, reason: "no country and no international prefix"`. Use the country from the user's profile or from an [IP lookup](ip-lookup.md).

## Shared calling codes

`+1` is North America, `+7` Russia and Kazakhstan, `+44` the UK with Guernsey, Jersey and the Isle of Man. `countries` lists every candidate with the most likely first; pass `country` to prefer one you know:

```bash
gcurl "$GEO/v1/phone?number=%2B7%20495%20123%204567"               # country RU, countries [RU, KZ]
gcurl "$GEO/v1/phone?number=%2B7%20495%20123%204567&country=KZ"    # country KZ
gcurl "$GEO/v1/phone?number=%2B1%20268%20555%200100"               # country AG (Antigua's area code 268)
```

NANP area codes that belong to one territory (268, 809, 787, 876 …) are in the table, so Caribbean numbers resolve to their country rather than to the US.

## Invalid input

| Input | Result |
|---|---|
| `+90 12` | `valid: false`, `reason: "E.164 numbers have 8 to 15 digits"` |
| `+999 123 4567` | `valid: false`, `reason: "unknown calling code"` |
| `+90 532 ABC` | `400 INVALID_PHONE` (letters) |

## Batches

```bash
gcurl -X POST $GEO/v1/phone/batch -d '{ "numbers": ["+1 212 555 0100", "0532 123 45 67", "x"], "country": "TR" }'
```

Each entry carries `ok` and either `result` or `error`, up to `MAX_BATCH` entries.
