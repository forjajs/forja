import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { addAddon } from "../src/addAddon";

// npm install is a slow, network-dependent side effect we don't want in TI —
// only what addAddon() writes to disk is under test here.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawnSync: vi.fn(() => ({ status: 0 })) };
});

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-ormenv-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-project", version: "0.0.0", dependencies: {} }, null, 2),
  );
  fs.writeFileSync(path.join(dir, ".env"), "NODE_ENV=development\n");
  fs.writeFileSync(path.join(dir, ".env.example"), "NODE_ENV=development\n");
  return dir;
}

describe("addAddon (orm preset) — network driver env vars", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpProject();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("adds no env vars for filesystem drivers (json-driver/sqlite need none)", () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });

    const env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    expect(env).not.toContain("DATABASE_URL");
  });

  it("adds DATABASE_URL/TEST_DATABASE_URL with a driver-correct scheme for postgres", () => {
    addAddon({ cwd, preset: "orm", driverName: "postgres", withExample: false, log: () => {}, warn: () => {} });

    const env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    expect(env).toMatch(/^DATABASE_URL=postgres:\/\//m);
    expect(env).toMatch(/^TEST_DATABASE_URL=postgres:\/\//m);
  });

  it("uses a mysql:// scheme for the mysql driver, not postgres's", () => {
    addAddon({ cwd, preset: "orm", driverName: "mysql", withExample: false, log: () => {}, warn: () => {} });

    const env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    expect(env).toMatch(/^DATABASE_URL=mysql:\/\//m);
    expect(env).not.toContain("postgres://");
  });

  it("uses a mongodb:// scheme for the mongodb driver", () => {
    addAddon({ cwd, preset: "orm", driverName: "mongodb", withExample: false, log: () => {}, warn: () => {} });

    const env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    expect(env).toMatch(/^DATABASE_URL=mongodb:\/\//m);
  });

  it("orm.config.js references process.env directly, no hardcoded fallback connection string", () => {
    addAddon({ cwd, preset: "orm", driverName: "postgres", withExample: false, log: () => {}, warn: () => {} });

    const config = fs.readFileSync(path.join(cwd, "features", "orm", "orm.config.js"), "utf8");
    expect(config).toContain("connectionString: process.env.DATABASE_URL");
    expect(config).not.toMatch(/process\.env\.\w+\s*\|\|/);
  });
});
