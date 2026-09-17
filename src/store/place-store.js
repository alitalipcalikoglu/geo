/** @typedef {import('../db.js').Database} Database */
/** @typedef {import('../types.js').PlaceRow} PlaceRow */

/** Persistence for places (points with attributes) inside collections. */
export class PlaceStore {
  static COLUMNS = 'collection, id, name, lat, lng, attrs, updated_at';

  /** @param {Database} db */
  constructor(db) {
    const C = PlaceStore.COLUMNS;
    this.stmt = {
      upsert: db.prepare(`INSERT INTO places (${C}) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (collection, id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng, attrs = excluded.attrs, updated_at = excluded.updated_at`),
      exists: db.prepare(`SELECT 1 FROM places WHERE collection = ? AND id = ?`),
      get: db.prepare(`SELECT ${C} FROM places WHERE collection = ? AND id = ?`),
      list: db.prepare(`SELECT ${C} FROM places WHERE collection = ? ORDER BY name, id LIMIT ? OFFSET ?`),
      count: db.prepare(`SELECT COUNT(*) AS n FROM places WHERE collection = ?`),
      total: db.prepare(`SELECT COUNT(*) AS n FROM places`),
      delete: db.prepare(`DELETE FROM places WHERE collection = ? AND id = ?`),
      clear: db.prepare(`DELETE FROM places WHERE collection = ?`),
      box: db.prepare(`SELECT ${C} FROM places WHERE collection = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`),
    };
  }

  /** @param {PlaceRow} r @returns {boolean} true when created */
  upsert(r) {
    const existed = this.stmt.exists.get(r.collection, r.id) !== undefined;
    this.stmt.upsert.run(r.collection, r.id, r.name, r.lat, r.lng, r.attrs, r.updated_at);
    return !existed;
  }

  /** @param {string} collection @param {string} id */
  get(collection, id) {
    return /** @type {PlaceRow|undefined} */ (this.stmt.get.get(collection, id));
  }

  /** @param {string} collection @param {number} limit @param {number} offset */
  list(collection, limit, offset) {
    return /** @type {PlaceRow[]} */ (this.stmt.list.all(collection, limit, offset));
  }

  /** @param {string} collection */
  count(collection) {
    return Number(/** @type {{ n: number }} */ (this.stmt.count.get(collection)).n);
  }

  total() {
    return Number(/** @type {{ n: number }} */ (this.stmt.total.get()).n);
  }

  /** @param {string} collection @param {string} id */
  delete(collection, id) {
    return Number(this.stmt.delete.run(collection, id).changes) > 0;
  }

  /** @param {string} collection */
  clear(collection) {
    return Number(this.stmt.clear.run(collection).changes);
  }

  /**
   * Rows inside a bounding box; a box crossing the antimeridian is split in two.
   * @param {string} collection
   * @param {{ minLat: number, maxLat: number, minLng: number, maxLng: number }} b
   */
  inBox(collection, b) {
    const ranges = b.minLng < -180 ? [[-180, b.maxLng], [b.minLng + 360, 180]] : b.maxLng > 180 ? [[b.minLng, 180], [-180, b.maxLng - 360]] : [[b.minLng, b.maxLng]];
    return ranges.flatMap(([lo, hi]) => /** @type {PlaceRow[]} */ (this.stmt.box.all(collection, b.minLat, b.maxLat, lo, hi)));
  }
}
