import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * The middlewares that need security.config.js (02-cors, 05-rate-limit,
 * 06-session) require() it via a relative path built for the REAL deployed
 * layout (shared/middlewares/ + features/security/ as siblings under the
 * project root) — not for templates/'s own layout (templates/middlewares/ +
 * templates/lib/ as siblings under templates/). Requiring those files
 * straight out of templates/ would resolve that relative path to a directory
 * that doesn't exist.
 *
 * This mirrors exactly what `forja add security` copies where (see
 * addAddon.ts's "security" branch) into a throwaway tmp dir, so the package's
 * own tests exercise the same file layout a real project ends up with.
 */
export function makeDeployedSecurityLayout(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-addon-security-"));
  const middlewaresDir = path.join(dir, "shared", "middlewares");
  const securityDir = path.join(dir, "features", "security");

  fs.mkdirSync(middlewaresDir, { recursive: true });
  fs.mkdirSync(securityDir, { recursive: true });

  const templatesDir = path.join(__dirname, "..", "..", "templates");
  for (const entry of fs.readdirSync(path.join(templatesDir, "middlewares"))) {
    fs.copyFileSync(path.join(templatesDir, "middlewares", entry), path.join(middlewaresDir, entry));
  }
  for (const entry of fs.readdirSync(path.join(templatesDir, "lib"))) {
    fs.copyFileSync(path.join(templatesDir, "lib", entry), path.join(securityDir, entry));
  }

  // node_modules resolution (helmet, cors, @forjajs/core...) — symlink back
  // to the monorepo root's, same trick used to smoke-test the CLI's own
  // scaffolds.
  fs.symlinkSync(path.join(__dirname, "..", "..", "..", "..", "node_modules"), path.join(dir, "node_modules"));

  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
