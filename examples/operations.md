# Operations

## Probes

```bash
curl -s $GEO/health   # {"status":"ok"}
curl -s $GEO/ready    # {"status":"ok"}; 503 when SQLite fails or a configured MMDB_PATH is not loaded (cached 10 s)
```

## Metrics

```bash
gcurl $GEO/metrics
```

```
geo_ip_lookups_total{result="hit"} 48210
geo_ip_lookups_total{result="miss"} 131
geo_ip_lookups_total{result="special"} 902
geo_database_loaded 1
geo_database_build_epoch 1758067200
geo_collections 2
geo_places_total 340
geo_db_bytes 262144
geo_process_uptime_seconds 86400
```

Alert on `geo_database_loaded == 0` when a database is configured, and on `time() - geo_database_build_epoch > 45 days`.

## Environment

Required: `GEO_API_KEYS`. Optional but usual: `MMDB_PATH`, `ASN_MMDB_PATH`. Full list with defaults: [.env.example](../.env.example). `DEFAULT_LANG` picks the language of names when a request has no `lang`.

## Memory

The MMDB files are held in memory: budget file size plus about 100 MB for Node. `ecosystem.config.cjs` restarts the process above 600 MB; raise it when using commercial City databases.

## Process manager

```bash
cp .env.example .env && $EDITOR .env
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
pm2 sendSignal SIGHUP geo      # reload the IP databases after replacing the files
```

## Docker

```bash
docker build -t atc-geo .
docker run -d -p 3012:3012 -v geo-data:/data -v /var/lib/geo:/mmdb:ro -e MMDB_PATH=/mmdb/GeoLite2-City.mmdb --env-file .env atc-geo
```

## Backups

```bash
sqlite3 data/geo.db ".backup 'geo-$(date +%F).db'"
```

The database holds collections and places only; the IP databases are downloads and the reference table ships with the code.

## Updating reference data

`src/data/countries.json` is a plain table; edit and restart when a country changes currency or a zone is added. Names, symbols and offsets follow the Node/ICU version, so upgrading Node refreshes them.
