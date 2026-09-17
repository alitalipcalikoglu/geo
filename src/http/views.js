/** @typedef {import('../types.js').CollectionRow} CollectionRow */

/** Response shapes. */
export class Views {
  /** @param {number|null} t */
  static iso(t) {
    return t === null ? null : new Date(Number(t)).toISOString();
  }

  /** @param {CollectionRow} c @param {number} [places] */
  static collection(c, places = 0) {
    return { name: c.name, description: c.description, places, createdBy: c.created_by, createdAt: Views.iso(c.created_at), updatedAt: Views.iso(c.updated_at) };
  }
}
