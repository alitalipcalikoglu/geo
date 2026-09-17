import { GeoError } from '../domain/errors.js';

/** @typedef {import('../db.js').Database} Database */
/** @typedef {import('../types.js').CollectionRow} CollectionRow */

/** Persistence for place collections. */
export class CollectionStore {
  static COLUMNS = 'name, description, created_by, created_at, updated_at';

  /** @param {Database} db */
  constructor(db) {
    const C = CollectionStore.COLUMNS;
    this.stmt = {
      insert: db.prepare(`INSERT INTO collections (${C}) VALUES (?, ?, ?, ?, ?)`),
      get: db.prepare(`SELECT ${C} FROM collections WHERE name = ?`),
      all: db.prepare(`SELECT ${C} FROM collections ORDER BY name`),
      update: db.prepare(`UPDATE collections SET description = ?, updated_at = ? WHERE name = ?`),
      touch: db.prepare(`UPDATE collections SET updated_at = ? WHERE name = ?`),
      delete: db.prepare(`DELETE FROM collections WHERE name = ?`),
      counts: db.prepare(`SELECT collection, COUNT(*) AS n FROM places GROUP BY collection`),
    };
  }

  /** @param {CollectionRow} r */
  insert(r) {
    this.stmt.insert.run(r.name, r.description, r.created_by, r.created_at, r.updated_at);
    return r;
  }

  /** @param {string} name */
  get(name) {
    return /** @type {CollectionRow|undefined} */ (this.stmt.get.get(name));
  }

  /** @param {string} name */
  require(name) {
    const row = this.get(name);
    if (!row) throw new GeoError('COLLECTION_NOT_FOUND', `collection "${name}" not found`);
    return row;
  }

  all() {
    return /** @type {CollectionRow[]} */ (this.stmt.all.all());
  }

  /** @param {CollectionRow} r */
  update(r) {
    this.stmt.update.run(r.description, r.updated_at, r.name);
    return r;
  }

  /** @param {string} name @param {number} now */
  touch(name, now) {
    this.stmt.touch.run(now, name);
  }

  /** @param {string} name */
  delete(name) {
    return Number(this.stmt.delete.run(name).changes) > 0;
  }

  counts() {
    return new Map(/** @type {{ collection: string, n: number }[]} */ (this.stmt.counts.all()).map((r) => [r.collection, Number(r.n)]));
  }
}
