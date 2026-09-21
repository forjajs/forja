export interface OrmEnvConfig {
  /** Filesystem-backed drivers use this. Network drivers (MySQL, Postgres, Mongo...) use their own shape instead. */
  path?: string;
  [key: string]: unknown;
}

export type OrmConfig = Record<string, OrmEnvConfig>;

/**
 * Picks the active environment's config from a project's orm.config.js (see
 * templates/orm.config.js), keyed by NODE_ENV. Defaults to "development" so a
 * plain `node app.js` run never accidentally touches test/prod data.
 *
 * Purely a lookup — no I/O. `path` is only a convention for filesystem-backed
 * drivers (json-driver, SQLite); a network driver's env config might carry a
 * `connectionString` instead, and resolveEnv has no opinion either way, since
 * it can't know what a given driver's config shape actually needs.
 */
export function resolveEnv(config: OrmConfig): OrmEnvConfig {
  const envName = process.env.NODE_ENV ?? "development";
  const envConfig = config[envName];

  if (!envConfig) {
    throw new Error(
      `orm.config.js has no "${envName}" environment (available: ${Object.keys(config).join(", ")})`,
    );
  }

  return envConfig;
}
