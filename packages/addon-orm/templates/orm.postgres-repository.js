const { Pool } = require("pg");
const { createRepositoryFromStore } = require("@forjajs/orm");

/**
 * Adapter: plugs PostgreSQL (via pg) into the ORM's generic Repository<T>
 * implementation (createRepositoryFromStore, defined once in @forjajs/orm).
 * Postgres has no native document mode, so documents are stored as a JSONB
 * column per row — swap this file for another driver's adapter without
 * touching anything else, same pattern as auth.password.js for the Hasher
 * contract.
 *
 * findOne()/countDistinct() do a full-table SELECT + in-process filtering here
 * (the trade-off of reusing the generic KV engine). For a table you expect to
 * grow large and query heavily, implement Repository<T> by hand instead, with
 * real SQL WHERE clauses in findOne — see @forjajs/orm's README, "Writing your
 * own driver".
 */
module.exports = async function createPostgresRepository(connectionString, tableName) {
  const pool = new Pool({ connectionString });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id   TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);

  // `executor` is either the pool (ordinary calls) or a single checked-out
  // client (inside withTransaction) — both expose the same .query().
  function makeStore(executor) {
    return {
      async get(id) {
        const { rows } = await executor.query(`SELECT data FROM ${tableName} WHERE id = $1`, [id]);
        return rows[0]?.data ?? null;
      },
      async set(id, doc) {
        await executor.query(
          `INSERT INTO ${tableName} (id, data) VALUES ($1, $2)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
          [id, doc],
        );
      },
      async delete(id) {
        await executor.query(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
      },
      async scan(predicate) {
        const { rows } = await executor.query(`SELECT data FROM ${tableName}`);
        const docs = rows.map((r) => r.data);
        return predicate ? docs.filter(predicate) : docs;
      },
      // Real SQL pushed-down pagination instead of createRepositoryFromStore's
      // generic scan-everything fallback.
      async list({ after, limit } = {}) {
        let sql = `SELECT data FROM ${tableName}`;
        const params = [];
        if (after !== undefined) {
          params.push(after);
          sql += ` WHERE id > $${params.length}`;
        }
        sql += ` ORDER BY id`;
        if (limit !== undefined) {
          params.push(limit);
          sql += ` LIMIT $${params.length}`;
        }
        const { rows } = await executor.query(sql, params);
        return rows.map((r) => r.data);
      },
    };
  }

  const repository = createRepositoryFromStore(makeStore(pool));

  // Real ACID transaction, overriding createRepositoryFromStore's generic
  // best-effort one: a single checked-out client runs BEGIN, every store call
  // `fn` makes goes through that same client, then COMMIT/ROLLBACK.
  repository.withTransaction = async function withTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tx = createRepositoryFromStore(makeStore(client));
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  };

  return repository;
};
