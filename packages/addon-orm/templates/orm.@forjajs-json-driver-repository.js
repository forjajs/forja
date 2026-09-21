const path = require("node:path");
const { openDatabase } = require("@forjajs/json-driver");
const { createRepositoryFromStore, ensureStorageDir } = require("@forjajs/orm");

/**
 * Adapter: plugs @forjajs/json-driver into the ORM's generic Repository<T>
 * implementation (createRepositoryFromStore, defined once in @forjajs/orm).
 * json-driver already exposes get/set/delete/scan, so no custom query logic
 * is needed here — swap this file for another driver's adapter (mysql,
 * sqlite...) without touching anything else.
 *
 * json-driver is filesystem-backed, so this adapter (not @forjajs/orm itself,
 * which stays agnostic — a network driver's env config has no directory to
 * create) ensures its own parent directory exists before opening the file.
 */
module.exports = async function createJsonRepository(filePath) {
  ensureStorageDir(path.dirname(filePath));
  const db = await openDatabase(filePath);
  return createRepositoryFromStore(db);
};
