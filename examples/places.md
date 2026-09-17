# Places and nearby search

Collections hold your own points with attributes: branches, warehouses, pickup lockers, service areas. Nearby search returns the closest ones within a radius, with distance and bearing.

## Create a collection and upload places

```bash
gcurl -X POST $GEO/v1/collections -d '{ "name": "branches", "description": "Stores and lockers" }'
gcurl -X PUT $GEO/v1/collections/branches/places -d '{
  "places": [
    { "id": "kadikoy",  "name": "Kadıköy",  "lat": 40.9903, "lng": 29.0252, "attrs": { "type": "store",  "parking": true,  "hours": "09-21" } },
    { "id": "besiktas", "name": "Beşiktaş", "lat": 41.0422, "lng": 29.0067, "attrs": { "type": "store",  "parking": false } },
    { "id": "taksim",   "name": "Taksim",   "lat": 41.0370, "lng": 28.9850, "attrs": { "type": "locker" } }
  ]
}'
```

```json
{ "created": 3, "updated": 0, "total": 3 }
```

Upserts by `id`, all or nothing: one bad row (`lat` out of range, empty name, duplicate id) rejects the batch with `400 INVALID_PLACE` and `details.index`. `attrs` is a free JSON object (up to 50 keys) returned as is and usable as a filter. A collection holds at most `MAX_POINTS` (5 000) places; larger sets belong in a real spatial database.

Sync from your system by re-sending the full list periodically (unchanged rows count as `updated`) and deleting what disappeared, or send only changes.

## Nearby

```bash
gcurl "$GEO/v1/collections/branches/nearby?lat=41.0082&lng=28.9784&radius=10&limit=5&filter.type=store"
```

```json
{
  "from": { "lat": 41.0082, "lng": 28.9784 }, "radiusKm": 10, "total": 2,
  "items": [
    { "id": "kadikoy",  "name": "Kadıköy",  "lat": 40.9903, "lng": 29.0252, "attrs": { "type": "store", "parking": true, "hours": "09-21" }, "updatedAt": "...", "distanceKm": 4.403, "bearing": 117 },
    { "id": "besiktas", "name": "Beşiktaş", "lat": 41.0422, "lng": 29.0067, "attrs": { "type": "store", "parking": false }, "updatedAt": "...", "distanceKm": 4.464, "bearing": 32 }
  ]
}
```

- `radius` in km, default 50, at most `MAX_RADIUS_KM` (500); `limit` 1 to 100 (default 10). `total` counts every match inside the radius, `items` the nearest `limit` of them.
- `filter.<key>=value` keeps places whose `attrs[key]` equals the value (string comparison, so `filter.parking=true` works).
- A bounding-box index narrows the candidates; the exact haversine distance decides. Boxes crossing the antimeridian are handled.

Combine with an [IP lookup](ip-lookup.md) for a first guess of the visitor's position, then with the browser's geolocation for an exact one.

## Browse, read, delete

```bash
gcurl "$GEO/v1/collections/branches/places?limit=50&offset=0"
gcurl $GEO/v1/collections/branches/places/taksim
gcurl -X DELETE $GEO/v1/collections/branches/places/taksim      # 204
gcurl -X POST $GEO/v1/collections/branches/clear                # { "removed": 2 }
gcurl -X PATCH $GEO/v1/collections/branches -d '{ "description": "Retail" }'
gcurl -X DELETE $GEO/v1/collections/branches                    # 204, places included
```
