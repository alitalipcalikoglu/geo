import { GeoPoint } from '../geo/geo-point.js';
import { GeoError } from './errors.js';

/** @typedef {import('../types.js').PlaceInput} PlaceInput */
/** @typedef {import('../types.js').PlaceRow} PlaceRow */

/** Your own points of interest (branches, warehouses, pickup lockers) and nearby search. */
export class PlacesService {
  static NAME_PATTERN = /^[a-z0-9]+([.\-_][a-z0-9]+)*$/;

  /**
   * @param {object} deps
   * @param {import('../db.js').Database} deps.db
   * @param {import('../store/collection-store.js').CollectionStore} deps.collections
   * @param {import('../store/place-store.js').PlaceStore} deps.places
   * @param {{ maxPoints: number, maxRadiusKm: number }} deps.options
   * @param {() => number} [deps.now]
   */
  constructor({ db, collections, places, options, now = Date.now }) {
    this.db = db;
    this.collections = collections;
    this.places = places;
    this.options = options;
    this.now = now;
  }

  /** @param {{ name: string, description?: string }} input @param {string} by */
  createCollection(input, by) {
    if (this.collections.get(input.name)) throw new GeoError('COLLECTION_EXISTS', `collection "${input.name}" already exists`);
    const t = this.now();
    return this.collections.insert({ name: input.name, description: input.description ?? '', created_by: by, created_at: t, updated_at: t });
  }

  /** @param {string} name @param {{ description?: string }} patch */
  updateCollection(name, patch) {
    const row = this.collections.require(name);
    return this.collections.update({ ...row, description: patch.description ?? row.description, updated_at: this.now() });
  }

  /** @param {string} name */
  removeCollection(name) {
    this.collections.require(name);
    this.db.transaction(() => this.collections.delete(name));
  }

  /**
   * Insert or replace places, all or nothing.
   * @param {string} collection
   * @param {PlaceInput[]} inputs
   */
  upsert(collection, inputs) {
    this.collections.require(collection);
    const t = this.now();
    return this.db.transaction(() => {
      const existing = this.places.count(collection);
      let created = 0;
      let updated = 0;
      const seen = new Set();
      for (const [i, p] of inputs.entries()) {
        if (seen.has(p.id)) throw new GeoError('INVALID_PLACE', `place "${p.id}" appears twice`, { index: i });
        seen.add(p.id);
        const name = p.name?.trim();
        if (!name) throw new GeoError('INVALID_PLACE', `place "${p.id}" has an empty name`, { index: i });
        let pt;
        try { pt = GeoPoint.validate(p.lat, p.lng); } catch (err) { throw new GeoError('INVALID_PLACE', `place "${p.id}": ${err instanceof Error ? err.message : err}`, { index: i }); }
        if (this.places.upsert({ collection, id: p.id, name, lat: pt.lat, lng: pt.lng, attrs: JSON.stringify(p.attrs ?? {}), updated_at: t })) created++; else updated++;
      }
      if (existing + created > this.options.maxPoints) throw new GeoError('BATCH_TOO_LARGE', `collection "${collection}" would exceed ${this.options.maxPoints} places`);
      this.collections.touch(collection, t);
      return { created, updated, total: existing + created };
    });
  }

  /** @param {string} collection @param {string} id */
  get(collection, id) {
    this.collections.require(collection);
    const row = this.places.get(collection, id);
    if (!row) throw new GeoError('PLACE_NOT_FOUND', `place "${id}" not found in "${collection}"`);
    return row;
  }

  /** @param {string} collection @param {string} id */
  remove(collection, id) {
    this.collections.require(collection);
    if (!this.places.delete(collection, id)) throw new GeoError('PLACE_NOT_FOUND', `place "${id}" not found in "${collection}"`);
    this.collections.touch(collection, this.now());
  }

  /** @param {string} collection */
  clear(collection) {
    this.collections.require(collection);
    return this.db.transaction(() => { const n = this.places.clear(collection); this.collections.touch(collection, this.now()); return n; });
  }

  /**
   * Places within `radiusKm` of a point, nearest first, with distance and bearing.
   * @param {string} collection
   * @param {{ lat: number, lng: number }} from
   * @param {{ radiusKm?: number, limit?: number, filter?: Record<string, string> }} [o]
   */
  nearby(collection, from, o = {}) {
    this.collections.require(collection);
    const radiusKm = o.radiusKm ?? Math.min(50, this.options.maxRadiusKm);
    if (!(radiusKm > 0) || radiusKm > this.options.maxRadiusKm) throw new GeoError('INVALID_COORDINATES', `radius must be between 0 and ${this.options.maxRadiusKm} km`);
    const limit = Math.max(1, Math.min(o.limit ?? 10, 100));
    const filter = Object.entries(o.filter ?? {});
    const hits = [];
    for (const row of this.places.inBox(collection, GeoPoint.boundingBox(from, radiusKm))) {
      const attrs = /** @type {Record<string, unknown>} */ (JSON.parse(row.attrs));
      if (filter.some(([k, v]) => String(attrs[k]) !== v)) continue;
      const to = { lat: row.lat, lng: row.lng };
      const distanceKm = GeoPoint.distanceKm(from, to);
      if (distanceKm > radiusKm) continue;
      hits.push({ ...PlacesService.view(row), distanceKm: Math.round(distanceKm * 1000) / 1000, bearing: Math.round(GeoPoint.bearing(from, to)) });
    }
    hits.sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id));
    return { from, radiusKm, total: hits.length, items: hits.slice(0, limit) };
  }

  /** @param {PlaceRow} r */
  static view(r) {
    return { id: r.id, name: r.name, lat: r.lat, lng: r.lng, attrs: JSON.parse(r.attrs), updatedAt: new Date(Number(r.updated_at)).toISOString() };
  }
}
