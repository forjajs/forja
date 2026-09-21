import * as fs from "node:fs";
import * as path from "node:path";
import type { ForjaEnvVar } from "./envVars";

interface JsonObject {
  [key: string]: unknown;
}

export interface ForjaDriver {
  template: string;
  package: string;
  extension?: string;
  /** filesystem: stores in a local file/directory (json-driver, SQLite). network: connects to a server (MySQL, Postgres, MongoDB). */
  kind: "filesystem" | "network";
  /** Network drivers only — env vars orm.config.js needs (DATABASE_URL...), auto-appended to .env/.env.example. */
  env?: ForjaEnvVar[];
}

/** Reads the forjaDrivers map declared in @forjajs/orm's own package.json. */
export function resolveForjaDrivers(): Record<string, ForjaDriver> {
  let ormPackageJsonPath: string;
  try {
    ormPackageJsonPath = require.resolve("@forjajs/orm/package.json");
  } catch {
    throw new Error('Could not resolve "@forjajs/orm". Is it installed alongside @forjajs/cli?');
  }

  const ormPackageJson = JSON.parse(fs.readFileSync(ormPackageJsonPath, "utf8")) as JsonObject;
  return (ormPackageJson.forjaDrivers as Record<string, ForjaDriver>) ?? {};
}

/**
 * Recovers which driver was wired in by `forja add orm --driver=...`, by
 * matching the adapter file already copied into features/orm/ against the
 * known templates declared in @forjajs/orm's own package.json.
 */
export function resolveOrmDriver(ormFeatureDir: string): ForjaDriver {
  const forjaDrivers = resolveForjaDrivers();

  const copiedFiles = new Set(fs.readdirSync(ormFeatureDir));
  const match = Object.values(forjaDrivers).find((driver) => copiedFiles.has(driver.template));

  if (!match) {
    throw new Error(
      `Could not find a driver adapter in "${ormFeatureDir}" — run "forja add orm --driver=<driver>" first.`,
    );
  }

  return match;
}

/** Same lookup as resolveOrmDriver, but also returns the driver's own key (name). */
export function resolveOrmDriverName(ormFeatureDir: string): string {
  const forjaDrivers = resolveForjaDrivers();
  const copiedFiles = new Set(fs.readdirSync(ormFeatureDir));
  const match = Object.entries(forjaDrivers).find(([, driver]) => copiedFiles.has(driver.template));

  if (!match) {
    throw new Error(
      `Could not find a driver adapter in "${ormFeatureDir}" — run "forja add orm --driver=<driver>" first.`,
    );
  }

  return match[0];
}

export function requireOrmFeatureDir(cwd: string): string {
  const ormFeatureDir = path.join(cwd, "features", "orm");
  if (!fs.existsSync(ormFeatureDir)) {
    throw new Error(`"${ormFeatureDir}" doesn't exist — run "forja add orm --driver=<driver>" first.`);
  }
  return ormFeatureDir;
}

/**
 * The literal JS source for the `createRepository(...)` call args, embedded
 * into a generated model file — differs by driver kind since a network driver
 * takes a connection string plus a table/collection name. A filesystem driver
 * always gets both a file path AND the model name too: json-driver's adapter
 * only takes the path (one file per model) and ignores the extra argument,
 * but sqlite's adapter needs it as its table name (one shared file, many
 * tables) — passing it uniformly means this doesn't need to branch per driver.
 */
export function repositoryCallArgs(driver: ForjaDriver, modelName: string): string {
  if (driver.kind === "filesystem") {
    return `\`\${env.path}/${modelName}${driver.extension ?? ""}\`, "${modelName}"`;
  }
  return `env.connectionString, "${modelName}"`;
}

/** orm.config.js content, shaped for the given driver kind. */
export function ormConfigContent(kind: "filesystem" | "network"): string {
  if (kind === "filesystem") {
    return `/**
 * Per-environment storage config for @forjajs/orm. Selected via NODE_ENV
 * (defaults to "development"). Keeps dev/test/prod data files completely
 * separate — running tests (TI) can never corrupt dev or prod data.
 */
module.exports = {
  development: {
    path: "data/dev",
  },
  test: {
    path: "data/test",
  },
  production: {
    path: "data/prod",
  },
};
`;
  }

  return `/**
 * Per-environment connection config for @forjajs/orm. Selected via NODE_ENV
 * (defaults to "development"). Keeps dev/test/prod completely separate —
 * running tests (TI) can never corrupt dev or prod data.
 *
 * No inline "|| defaultConnectionString" fallback here on purpose — DATABASE_URL
 * and TEST_DATABASE_URL are guaranteed to already be in .env/.env.example (see
 * this driver's "env" entry in @forjajs/orm's package.json, auto-written by
 * \`forja add orm\`/\`forja orm switch-driver\`), a single source of truth
 * instead of a default hidden in generated code.
 */
module.exports = {
  development: {
    connectionString: process.env.DATABASE_URL,
  },
  test: {
    connectionString: process.env.TEST_DATABASE_URL,
  },
  production: {
    connectionString: process.env.DATABASE_URL,
  },
};
`;
}
