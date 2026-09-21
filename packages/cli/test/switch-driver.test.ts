import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { addAddon } from "../src/addAddon";
import OrmSwitchDriverCommand from "../src/commands/orm/switch-driver";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawnSync: vi.fn(() => ({ status: 0 })) };
});

const cliRoot = path.join(__dirname, "..");

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-switchdriver-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-project", version: "0.0.0", dependencies: {} }, null, 2),
  );
  return dir;
}

describe("forja orm switch-driver", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpProject();
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("swaps the driver adapter, regenerates driver.js, and leaves models untouched", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: true, log: () => {}, warn: () => {} });
    const ormDir = path.join(cwd, "features", "orm");
    const modelBefore = fs.readFileSync(path.join(ormDir, "models", "user.model.js"), "utf8");

    await OrmSwitchDriverCommand.run(["postgres"], cliRoot);

    // Old driver's adapter is gone, new one is in place.
    expect(fs.existsSync(path.join(ormDir, "orm.@forjajs-json-driver-repository.js"))).toBe(false);
    expect(fs.existsSync(path.join(ormDir, "orm.postgres-repository.js"))).toBe(true);

    const driverJs = fs.readFileSync(path.join(ormDir, "driver.js"), "utf8");
    expect(driverJs).toContain('require("./orm.postgres-repository.js")');

    // The stable indirection file is the whole point — models never change.
    const modelAfter = fs.readFileSync(path.join(ormDir, "models", "user.model.js"), "utf8");
    expect(modelAfter).toBe(modelBefore);
    expect(modelAfter).toContain('require("../driver.js")');
  });

  it("regenerates orm.config.js only when the storage kind changes", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    const configPath = path.join(cwd, "features", "orm", "orm.config.js");

    await OrmSwitchDriverCommand.run(["sqlite"], cliRoot);
    // json-driver -> sqlite: both filesystem, config shape is unchanged.
    expect(fs.readFileSync(configPath, "utf8")).toContain("path:");

    await OrmSwitchDriverCommand.run(["postgres"], cliRoot);
    // sqlite -> postgres: filesystem -> network, config gets regenerated.
    expect(fs.readFileSync(configPath, "utf8")).toContain("connectionString");
  });

  it("swaps the driver package in package.json (old removed, new added)", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });

    await OrmSwitchDriverCommand.run(["postgres"], cliRoot);

    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    expect(pkg.dependencies["@forjajs/json-driver"]).toBeUndefined();
    expect(pkg.dependencies["pg"]).toBeDefined();
  });

  it("refuses to switch to the driver that is already active", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    await expect(OrmSwitchDriverCommand.run(["json-driver"], cliRoot)).rejects.toThrow(/already the active driver/);
  });

  it("rejects an unknown driver name", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    await expect(OrmSwitchDriverCommand.run(["not-a-real-driver"], cliRoot)).rejects.toThrow(/Unknown driver/);
  });

  it("adds the new network driver's env vars, even switching between two network drivers", async () => {
    fs.writeFileSync(path.join(cwd, ".env"), "NODE_ENV=development\n");
    fs.writeFileSync(path.join(cwd, ".env.example"), "NODE_ENV=development\n");

    addAddon({ cwd, preset: "orm", driverName: "mysql", withExample: false, log: () => {}, warn: () => {} });
    let env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    expect(env).toMatch(/^DATABASE_URL=mysql:\/\//m);

    await OrmSwitchDriverCommand.run(["postgres"], cliRoot);

    env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    // The mysql:// line is left in place (switch-driver never migrates data
    // or cleans up the old driver's now-unused vars) — postgres's own
    // DATABASE_URL default just can't be appended again under the same key,
    // so the file keeps whichever came first.
    expect(env).toMatch(/^DATABASE_URL=mysql:\/\//m);
  });

  it("warns that DATABASE_URL needs a manual update when switching between two network drivers", async () => {
    fs.writeFileSync(path.join(cwd, ".env"), "NODE_ENV=development\n");
    fs.writeFileSync(path.join(cwd, ".env.example"), "NODE_ENV=development\n");

    addAddon({ cwd, preset: "orm", driverName: "mysql", withExample: false, log: () => {}, warn: () => {} });

    const warnSpy = vi.spyOn(OrmSwitchDriverCommand.prototype, "warn").mockImplementation((input) => input as any);

    await OrmSwitchDriverCommand.run(["postgres"], cliRoot);

    expect(warnSpy.mock.calls.some(([message]) => String(message).includes("DATABASE_URL") && String(message).includes("wrong scheme"))).toBe(
      true,
    );
    warnSpy.mockRestore();
  });
});
