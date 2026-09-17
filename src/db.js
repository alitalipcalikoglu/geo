import { Database as CoreDatabase } from '@atc-web/service-core/db';

/** SQLite connection with schema migrations applied on open. Holds place collections only. */
export class Database extends CoreDatabase {
  static MIGRATIONS = [
    `
    CREATE TABLE collections (
      name        TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      created_by  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE places (
      collection TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
      id         TEXT NOT NULL,
      name       TEXT NOT NULL,
      lat        REAL NOT NULL,
      lng        REAL NOT NULL,
      attrs      TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (collection, id)
    ) WITHOUT ROWID;
    -- Bounding-box prefilter for nearby queries; the exact distance is computed in the service.
    CREATE INDEX places_lat_lng ON places (collection, lat, lng);
    `,
  ];
}
