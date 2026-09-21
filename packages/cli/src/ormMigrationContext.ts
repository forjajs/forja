import * as fs from "node:fs";
import * as path from "node:path";
import { requireOrmFeatureDir, resolveOrmDriver, type ForjaDriver } from "./ormDriver";

export interface MigrationRecord {
  id: string;
  appliedAt: string;
}

export interface MigrationRepository {
  findById(id: string): Promise<MigrationRecord | null>;
  create(data: MigrationRecord): Promise<MigrationRecord>;
  delete(id: string): Promise<void>;
}

export interface MigrationModule {
  up(ctx: { openRepository(name: string): Promise<unknown> }): Promise<void>;
  down(ctx: { openRepository(name: string): Promise<unknown> }): Promise<void>;
}

export interface OrmEnvConfig {
  path?: string;
  connectionString?: string;
  [key: string]: unknown;
}

/**
 * Same filesystem-vs-network branching as repositoryCallArgs() in ormDriver.ts
 * (which builds these as a string for generated model files) — here we need
 * the actual arguments to call createRepository() with directly, not source
 * text, so it's a small parallel helper instead of reusing that one. Always
 * passes `name` as a second argument even for filesystem drivers: json-driver
 * ignores it (one file per model), sqlite needs it as its table name (one
 * shared file, many tables) — see repositoryCallArgs()'s comment.
 */
function repositoryArgs(driver: ForjaDriver, env: OrmEnvConfig, name: string): unknown[] {
  if (driver.kind === "filesystem") {
    return [`${env.path}/${name}${driver.extension ?? ""}`, name];
  }
  return [env.connectionString, name];
}

export interface MigrationContext {
  ormFeatureDir: string;
  migrationsDir: string;
  /** Migration filenames (e.g. "0001_add_age.js"), sorted ascending — chronological order. */
  files: string[];
  openRepository: (name: string) => Promise<unknown>;
  migrationsRepo: MigrationRepository;
}

/**
 * Shared setup for both `forja orm migrate` and `forja orm migrate rollback`:
 * resolves the active driver, opens the special "_migrations" bookkeeping
 * repository, and builds an openRepository() bound to the current env — so
 * both commands run migration modules against the exact same storage.
 */
export async function resolveMigrationContext(cwd: string): Promise<MigrationContext> {
  const ormFeatureDir = requireOrmFeatureDir(cwd);
  const driver = resolveOrmDriver(ormFeatureDir);

  const { resolveEnv } = require(require.resolve("@forjajs/orm", { paths: [ormFeatureDir] })) as {
    resolveEnv: (config: Record<string, OrmEnvConfig>) => OrmEnvConfig;
  };
  const config = require(path.join(ormFeatureDir, "orm.config.js")) as Record<string, OrmEnvConfig>;
  const env = resolveEnv(config);

  // Stable indirection: never require() the driver's own file name here —
  // that's what lets `forja orm switch-driver` change the active driver
  // without either command needing to change too.
  const createRepository = require(path.join(ormFeatureDir, "driver.js")) as (
    ...args: unknown[]
  ) => Promise<unknown>;

  const openRepository = (name: string) => createRepository(...repositoryArgs(driver, env, name));

  const migrationsRepo = (await createRepository(
    ...repositoryArgs(driver, env, "_migrations"),
  )) as MigrationRepository;

  const migrationsDir = path.join(ormFeatureDir, "migrations");
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".js")).sort()
    : [];

  return { ormFeatureDir, migrationsDir, files, openRepository, migrationsRepo };
}
