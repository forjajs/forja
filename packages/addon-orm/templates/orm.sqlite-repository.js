const path = require("node:path");
const Database = require("better-sqlite3");
const { createRepositoryFromStore, ensureStorageDir } = require("@forjajs/orm");

/**
 * Adapter: plugs better-sqlite3 into the ORM's generic Repository<T>
 * implementation (createRepositoryFromStore, defined once in @forjajs/orm).
 * SQLite has no native document mode, so documents are stored as a JSON blob
 * per row — swap this file for another driver's adapter without touching
 * anything else, same pattern as auth.password.js for the Hasher contract.
 *
 * better-sqlite3 is deliberately synchronous (no event-loop round-trip per
 * query) — this adapter still exposes async methods, since that's what the
 * Repository<T> contract requires; they just resolve instantly.
 */
module.exports = async function createSqliteRepository(filePath, tableName) {
  ensureStorageDir(path.dirname(filePath));

  const db = new Database(filePath);
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);

  const getStmt = db.prepare(`SELECT data FROM ${tableName} WHERE id = ?`);
  const upsertStmt = db.prepare(
    `INSERT INTO ${tableName} (id, data) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  );
  const deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
  const allStmt = db.prepare(`SELECT data FROM ${tableName}`);

  const store = {
    async get(id) {
      const row = getStmt.get(id);
      return row ? JSON.parse(row.data) : null;
    },
    async set(id, doc) {
      upsertStmt.run(id, JSON.stringify(doc));
    },
    async delete(id) {
      deleteStmt.run(id);
    },
    async scan(predicate) {
      const docs = allStmt.all().map((row) => JSON.parse(row.data));
      return predicate ? docs.filter(predicate) : docs;
    },
    // Real SQL pushed-down pagination — WHERE id > ? ORDER BY id LIMIT ? —
    // instead of createRepositoryFromStore's generic scan-everything fallback.
    async list({ after, limit } = {}) {
      let sql = `SELECT data FROM ${tableName}`;
      const params = [];
      if (after !== undefined) {
        sql += ` WHERE id > ?`;
        params.push(after);
      }
      sql += ` ORDER BY id`;
      if (limit !== undefined) {
        sql += ` LIMIT ?`;
        params.push(limit);
      }
      return db.prepare(sql).all(...params).map((row) => JSON.parse(row.data));
    },
  };

  const repository = createRepositoryFromStore(store);

  // Real ACID transaction, overriding createRepositoryFromStore's generic
  // best-effort one: every store call `fn` makes runs on this same
  // connection, so wrapping it in BEGIN/COMMIT/ROLLBACK is a real SQLite
  // transaction, not a JS-level compensation trick.
  repository.withTransaction = async function withTransaction(fn) {
    db.exec("BEGIN");
    try {
      const tx = createRepositoryFromStore(store);
      const result = await fn(tx);
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  return repository;
};
