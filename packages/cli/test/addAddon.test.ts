import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { addAddon } from "../src/addAddon";

// npm install is a slow, network-dependent side effect we don't want in TI —
// only what addAddon() writes to disk is under test here.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawnSync: vi.fn(() => ({ status: 0 })) };
});

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-addaddon-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-project", version: "0.0.0", dependencies: {} }, null, 2),
  );
  return dir;
}

describe("addAddon (orm preset)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpProject();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("wires the chosen driver only, with the stable driver.js indirection", () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });

    const ormDir = path.join(cwd, "features", "orm");
    expect(fs.existsSync(path.join(ormDir, "orm.@forjajs-json-driver-repository.js"))).toBe(true);
    // Only the chosen driver's adapter is copied in, never the others.
    expect(fs.existsSync(path.join(ormDir, "orm.sqlite-repository.js"))).toBe(false);
    expect(fs.existsSync(path.join(ormDir, "orm.postgres-repository.js"))).toBe(false);

    const driverJs = fs.readFileSync(path.join(ormDir, "driver.js"), "utf8");
    expect(driverJs).toContain('require("./orm.@forjajs-json-driver-repository.js")');

    const config = fs.readFileSync(path.join(ormDir, "orm.config.js"), "utf8");
    expect(config).toContain("path:");
    expect(config).not.toContain("connectionString");
  });

  it("generates a network-shaped orm.config.js for network drivers", () => {
    addAddon({ cwd, preset: "orm", driverName: "postgres", withExample: false, log: () => {}, warn: () => {} });

    const config = fs.readFileSync(path.join(cwd, "features", "orm", "orm.config.js"), "utf8");
    expect(config).toContain("connectionString");
    expect(config).not.toContain('path: "data');
  });

  it("only adds the packages it actually wired in", () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });

    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    expect(pkg.dependencies["@forjajs/orm"]).toBeDefined();
    expect(pkg.dependencies["@forjajs/json-driver"]).toBeDefined();
    expect(pkg.dependencies["pg"]).toBeUndefined();
    expect(pkg.dependencies["mysql2"]).toBeUndefined();
  });

  it("skips the starter example unless withExample is passed", () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    expect(fs.existsSync(path.join(cwd, "features", "orm", "models", "user.model.js"))).toBe(false);
  });

  it("generates the starter User model when withExample is true", () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: true, log: () => {}, warn: () => {} });
    const modelPath = path.join(cwd, "features", "orm", "models", "user.model.js");
    expect(fs.existsSync(modelPath)).toBe(true);
    expect(fs.readFileSync(modelPath, "utf8")).toContain('require("../driver.js")');
  });
});
