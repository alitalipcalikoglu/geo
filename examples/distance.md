# Distance

Great-circle distance on a sphere (radius 6371.0088 km, haversine) and the initial bearing:

```bash
gcurl "$GEO/v1/distance?from=41.0082,28.9784&to=39.9334,32.8597"
```

```json
{ "from": { "lat": 41.0082, "lng": 28.9784 }, "to": { "lat": 39.9334, "lng": 32.8597 }, "km": 349.313, "m": 349313, "mi": 217.058, "bearing": 108.7 }
```

Good to about 0.3 % against the ellipsoid, which is fine for delivery zones, "how far is the nearest branch" and sorting; not for surveying. `bearing` is degrees clockwise from north at the start point.

Coordinates are `lat,lng` in decimal degrees; latitudes outside ±90 or longitudes outside ±180 answer `400 INVALID_COORDINATES`.

For many distances from one point to your own places, use [nearby search](places.md), which does the work in one call.
