import * as fs from "node:fs";

/**
 * Creates a filesystem directory if it doesn't exist yet — for filesystem-backed
 * drivers only (json-driver, SQLite...). Not called automatically by resolveEnv:
 * a network driver's env config (MySQL, Postgres, Mongo — a connection string,
 * not a path) has nothing for this to act on, so each filesystem-based driver
 * adapter calls this itself, explicitly, instead of it being assumed for every
 * driver.
 */
export function ensureStorageDir(path: string): void {
  fs.mkdirSync(path, { recursive: true });
}
