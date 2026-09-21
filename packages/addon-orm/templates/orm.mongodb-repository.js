const { MongoClient } = require("mongodb");
const { randomUUID } = require("node:crypto");

/**
 * Adapter: plugs MongoDB into the ORM's Repository<T> contract — hand-written,
 * NOT routed through createRepositoryFromStore, because Mongo has a real query
 * engine and findOne()/scan-equivalent should actually use it instead of
 * loading everything and filtering in-process. Swap this file for another
 * driver's adapter without touching anything else, same pattern as
 * auth.password.js for the Hasher contract.
 *
 * `id` is kept as your own plain-string field (not Mongo's native `_id`), so
 * every document's `id` stays a plain string across every driver — that's
 * what lets a schema's `relation` fields (plain string ids) work identically
 * regardless of which database backs a given model. Mongo's own `_id` is
 * stripped from everything this adapter returns, so a document coming out of
 * this driver has the exact same shape as one coming out of json-driver, sql,
 * or any other adapter — never an extra `_id` field only Mongo users would see.
 *
 * withTransaction() uses a real client session — this REQUIRES MongoDB to be
 * running as a replica set (even a single-node one); a standalone mongod
 * rejects transactions outright. See docker-compose.test.yml for how the
 * package's own tests spin one up.
 */
module.exports = async function createMongoRepository(uri, dbName, collectionName) {
  const client = await MongoClient.connect(uri);
  const collection = client.db(dbName).collection(collectionName);

  function stripMongoId(doc) {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest;
  }

  // Translates @forjajs/orm's QueryCriteria (`{ age: { gt: 18 } }`) into a
  // real Mongo query (`{ age: { $gt: 18 } }`) — plain values pass through
  // unchanged (equality). Without this, a criteria object would be forwarded
  // to Mongo as-is and misread as "age equals the literal object { gt: 18 }".
  function toMongoQuery(criteria) {
    const query = {};
    for (const [key, condition] of Object.entries(criteria)) {
      if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
        const mongoCondition = {};
        if ("eq" in condition) mongoCondition.$eq = condition.eq;
        if ("ne" in condition) mongoCondition.$ne = condition.ne;
        if ("gt" in condition) mongoCondition.$gt = condition.gt;
        if ("gte" in condition) mongoCondition.$gte = condition.gte;
        if ("lt" in condition) mongoCondition.$lt = condition.lt;
        if ("lte" in condition) mongoCondition.$lte = condition.lte;
        if ("in" in condition) mongoCondition.$in = condition.in;
        if ("nin" in condition) mongoCondition.$nin = condition.nin;
        query[key] = mongoCondition;
      } else {
        query[key] = condition;
      }
    }
    return query;
  }

  // `session` is undefined for ordinary calls, or a real ClientSession while
  // inside withTransaction() — every collection call below threads it through
  // so a transaction's reads/writes actually participate in it.
  function makeRepository(session) {
    const opts = session ? { session } : {};

    return {
      async findById(id) {
        return stripMongoId(await collection.findOne({ id }, opts));
      },
      async findOne(criteria) {
        return stripMongoId(await collection.findOne(toMongoQuery(criteria), opts)); // real Mongo query, uses indexes if you add them
      },
      async create(data) {
        const id = data.id ?? randomUUID();
        const doc = { ...data, id };
        await collection.insertOne(doc, opts); // mutates `doc` in place, adding Mongo's own _id
        return stripMongoId(doc);
      },
      async update(id, data) {
        // mongodb v6 returns the document itself (or null) directly — not the
        // pre-v5 { value } wrapper.
        const updated = await collection.findOneAndUpdate(
          { id },
          { $set: data },
          { returnDocument: "after", ...opts },
        );
        return stripMongoId(updated);
      },
      async delete(id) {
        await collection.deleteOne({ id }, opts);
      },
      async findAll(predicateOrCriteria, options) {
        if (typeof predicateOrCriteria === "function") {
          const docs = (await collection.find({}, opts).toArray()).map(stripMongoId);
          return docs.filter(predicateOrCriteria);
        }

        // Real Mongo query pushed down, cursor-paginated — not
        // createRepositoryFromStore's generic in-process fallback (this
        // adapter doesn't even use that engine, being hand-rolled).
        const sortField = options?.sortBy ?? "id";
        const sortDir = options?.sortDir === "desc" ? -1 : 1;
        const query = predicateOrCriteria ? toMongoQuery(predicateOrCriteria) : {};
        if (options?.after !== undefined) {
          query[sortField] = {
            ...(query[sortField] ?? {}),
            [sortDir === 1 ? "$gt" : "$lt"]: options.after,
          };
        }
        let cursor = collection.find(query, opts).sort({ [sortField]: sortDir });
        if (options?.limit !== undefined) cursor = cursor.limit(options.limit);
        return (await cursor.toArray()).map(stripMongoId);
      },
      async withTransaction(fn) {
        const txSession = client.startSession();
        try {
          let result;
          await txSession.withTransaction(async () => {
            result = await fn(makeRepository(txSession));
          });
          return result;
        } finally {
          await txSession.endSession();
        }
      },
    };
  }

  return makeRepository();
};
