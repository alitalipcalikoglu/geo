import { GeoError } from '../domain/errors.js';

/** Coordinates, great-circle distance and bounding boxes (WGS-84 sphere, R = 6371.0088 km). */
export class GeoPoint {
  static EARTH_RADIUS_KM = 6371.0088;

  /**
   * @param {unknown} lat
   * @param {unknown} lng
   * @returns {{ lat: number, lng: number }}
   */
  static validate(lat, lng) {
    const a = Number(lat);
    const b = Number(lng);
    if (!Number.isFinite(a) || a < -90 || a > 90) throw new GeoError('INVALID_COORDINATES', 'lat must be between -90 and 90');
    if (!Number.isFinite(b) || b < -180 || b > 180) throw new GeoError('INVALID_COORDINATES', 'lng must be between -180 and 180');
    return { lat: a, lng: b };
  }

  /** `41.01,28.95` → point. @param {string} text */
  static parse(text) {
    const m = String(text).trim().split(/\s*,\s*/);
    if (m.length !== 2) throw new GeoError('INVALID_COORDINATES', 'expected "lat,lng"');
    return GeoPoint.validate(m[0], m[1]);
  }

  /** Haversine distance in km. @param {{ lat: number, lng: number }} a @param {{ lat: number, lng: number }} b */
  static distanceKm(a, b) {
    const toRad = (/** @type {number} */ d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * GeoPoint.EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Initial bearing in degrees from north, clockwise. @param {{ lat: number, lng: number }} a @param {{ lat: number, lng: number }} b */
  static bearing(a, b) {
    const toRad = (/** @type {number} */ d) => (d * Math.PI) / 180;
    const dLng = toRad(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  /**
   * Latitude/longitude bounds that contain every point within `radiusKm`. Longitude bounds may
   * wrap past ±180 (the caller handles the wrap) and widen to the full range near the poles.
   * @param {{ lat: number, lng: number }} c
   * @param {number} radiusKm
   */
  static boundingBox(c, radiusKm) {
    const dLat = (radiusKm / GeoPoint.EARTH_RADIUS_KM) * (180 / Math.PI);
    const cosLat = Math.cos((c.lat * Math.PI) / 180);
    const dLng = cosLat < 1e-6 ? 180 : Math.min(180, dLat / cosLat);
    return { minLat: Math.max(-90, c.lat - dLat), maxLat: Math.min(90, c.lat + dLat), minLng: c.lng - dLng, maxLng: c.lng + dLng };
  }
}
