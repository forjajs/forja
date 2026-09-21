import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { addAddon, AddAddonError } from "../src/addAddon";

// npm install is a slow, network-dependent side effect we don't want in TI —
// only what addAddon() writes to disk is under test here.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawnSync: vi.fn(() => ({ status: 0 })) };
});

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-addsecurity-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-project", version: "0.0.0", dependencies: {} }, null, 2),
  );
  return dir;
}

describe("addAddon (security preset)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpProject();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("copies global middlewares into shared/middlewares/, not features/", () => {
    addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} });

    const middlewaresDir = path.join(cwd, "shared", "middlewares");
    for (const file of [
      "00-trust-proxy.middleware.js",
      "01-cookie-parser.middleware.js",
      "02-headers.middleware.js",
      "03-cors.middleware.js",
      "04-compression.middleware.js",
      "05-hpp.middleware.js",
      "06-sanitize.middleware.js",
      "07-rate-limit.middleware.js",
      "08-session.middleware.js",
      "09-csrf.middleware.js",
    ]) {
      expect(fs.existsSync(path.join(middlewaresDir, file))).toBe(true);
    }

    expect(fs.existsSync(path.join(cwd, "features", "security", "00-trust-proxy.middleware.js"))).toBe(false);
  });

  it("copies explicit-use helpers (rate limiter factory) into features/security/", () => {
    addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} });

    const helperPath = path.join(cwd, "features", "security", "security.rateLimiters.js");
    expect(fs.existsSync(helperPath)).toBe(true);
    expect(fs.readFileSync(helperPath, "utf8")).toContain("createRateLimiter");
  });

  it("adds all of the addon's peer dependencies, not just its own package", () => {
    addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} });

    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    for (const dep of ["@forjajs/addon-security", "helmet", "cors", "compression", "hpp", "express-mongo-sanitize", "express-rate-limit", "express-session", "cookie-parser"]) {
      expect(pkg.dependencies[dep]).toBeDefined();
    }
  });

  it("refuses to overwrite an existing shared/middlewares file", () => {
    fs.mkdirSync(path.join(cwd, "shared", "middlewares"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "shared", "middlewares", "02-headers.middleware.js"), "// custom, mine");

    expect(() => addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} })).toThrow(AddAddonError);
  });
});
