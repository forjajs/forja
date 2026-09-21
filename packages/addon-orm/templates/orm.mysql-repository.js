const mysql = require("mysql2/promise");
const { createRepositoryFromStore } = require("@forjajs/orm");

/**
 * Adapter: plugs MySQL (via mysql2) into the ORM's generic Repository<T>
 * implementation (createRepositoryFromStore, defined once in @forjajs/orm).
 * MySQL has no native document mode, so documents are stored as a JSON column
 * per row — swap this file for another driver's adapter without touching
 * anything else, same pattern as auth.password.js for the Hasher contract.
 *
 * findOne()/countDistinct() do a full-table SELECT + in-process filtering here
 * (the trade-off of reusing the generic KV engine). For a table you expect to
 * grow large and query heavily, implement Repository<T> by hand instead, with
 * real SQL WHERE clauses in findOne — see @forjajs/orm's README, "Writing your
 * own driver".
 */
module.exports = async function createMysqlRepository(connectionUri, tableName) {
  const pool = mysql.createPool(connectionUri);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id   VARCHAR(255) PRIMARY KEY,
      data JSON NOT NULL
    )
  `);

  // `executor` is either the pool (ordinary calls) or a single checked-out
  // connection (inside withTransaction) — both expose the same .query().
  function makeStore(executor) {
    return {
      async get(id) {
        const [rows] = await executor.query(`SELECT data FROM ${tableName} WHERE id = ?`, [id]);
        return rows[0]?.data ?? null;
      },
      async set(id, doc) {
        await executor.query(
          `INSERT INTO ${tableName} (id, data) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE data = VALUES(data)`,
          [id, JSON.stringify(doc)],
        );
      },
      async delete(id) {
        await executor.query(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
      },
      async scan(predicate) {
        const [rows] = await executor.query(`SELECT data FROM ${tableName}`);
        const docs = rows.map((r) => r.data);
        return predicate ? docs.filter(predicate) : docs;
      },
      // Real SQL pushed-down pagination instead of createRepositoryFromStore's
      // generic scan-everything fallback.
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
        const [rows] = await executor.query(sql, params);
        return rows.map((r) => r.data);
      },
    };
  }

  const repository = createRepositoryFromStore(makeStore(pool));

  // Real ACID transaction, overriding createRepositoryFromStore's generic
  // best-effort one: a single checked-out connection runs BEGIN, every store
  // call `fn` makes goes through that same connection, then COMMIT/ROLLBACK.
  repository.withTransaction = async function withTransaction(fn) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const tx = createRepositoryFromStore(makeStore(connection));
      const result = await fn(tx);
      await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  };

  return repository;
};
