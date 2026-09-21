import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface ForjaEnvVar {
  /** e.g. "SESSION_SECRET" */
  key: string;
  /** Written verbatim to both .env and .env.example. Mutually exclusive with `secret`. */
  default?: string;
  /**
   * A real value is required and unsafe to leave as a shared placeholder
   * (a signing secret...) — the CLI generates a fresh random one for .env,
   * .env.example gets a "changeme" placeholder instead so nothing secret
   * ever lands in version control via the example file.
   */
  secret?: boolean;
  /** One-line comment written above the KEY=value in both files. */
  comment?: string;
}

/**
 * Generic across every addon and driver (not just @forjajs/addon-security) —
 * any addon's package.json `forjaEnv`, or an ORM network driver's own `env`
 * entry (see ForjaDriver in ormDriver.ts), can declare env vars this way and
 * get them appended to .env/.env.example automatically. Without this, an
 * addon/driver whose generated code reads `process.env.X` leaves the user to
 * discover and add every var by hand — and a required-with-no-default one
 * just throws at boot with no clue where it's supposed to come from.
 */
export function writeEnvVars({
  cwd,
  label,
  vars,
  log,
}: {
  cwd: string;
  /** Header comment grouping this block, e.g. "security" or "postgres". */
  label: string;
  vars: ForjaEnvVar[];
  log: (message: string) => void;
}): void {
  if (vars.length === 0) return;

  appendEnvVars(path.join(cwd, ".env"), label, vars, (v) => (v.secret ? crypto.randomBytes(32).toString("hex") : (v.default ?? "")));
  const added = appendEnvVars(path.join(cwd, ".env.example"), label, vars, (v) => (v.secret ? "changeme" : (v.default ?? "")));

  // .env and .env.example always get the same set of missing keys (same
  // `vars`, same pre-existing-keys check) — logging .env.example's result is
  // enough to report both without printing the message twice.
  if (added.length > 0) {
    log(`Added environment variables to .env / .env.example: ${added.join(", ")}`);
  }
}

/** Appends only the keys not already present (idempotent — safe to run twice). Returns the keys actually added. */
function appendEnvVars(filePath: string, label: string, vars: ForjaEnvVar[], valueFor: (v: ForjaEnvVar) => string): string[] {
  if (!fs.existsSync(filePath)) return [];

  const existing = fs.readFileSync(filePath, "utf8");
  const existingKeys = new Set(
    existing
      .split("\n")
      .map((line) => line.match(/^([A-Z0-9_]+)=/)?.[1])
      .filter((key): key is string => Boolean(key)),
  );

  const missing = vars.filter((v) => !existingKeys.has(v.key));
  if (missing.length === 0) return [];

  const block = missing.map((v) => (v.comment ? `# ${v.comment}\n${v.key}=${valueFor(v)}` : `${v.key}=${valueFor(v)}`)).join("\n");

  const separator = existing.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(filePath, `${existing}${separator}\n# --- ${label} ---\n${block}\n`);

  return missing.map((v) => v.key);
}
