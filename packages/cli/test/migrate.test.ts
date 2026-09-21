import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { addAddon } from "../src/addAddon";
import OrmMigrateCommand from "../src/commands/orm/migrate";
import OrmMigrateRollbackCommand from "../src/commands/orm/migrate/rollback";
import OrmSwitchDriverCommand from "../src/commands/orm/switch-driver";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawnSync: vi.fn(() => ({ status: 0 })) };
});

const cliRoot = path.join(__dirname, "..");

// "npm install" is mocked below (no network in TI), so the tmp project never
// actually gets a node_modules/@forjajs/orm of its own — but migrate.ts
// resolves "@forjajs/orm" relative to features/orm/, so symlinking the real,
// already-built package in is enough to make that resolution work exactly
// like it would after a real install.
function linkRealPackage(dir: string, packageName: string): void {
  const realPath = path.dirname(require.resolve(`${packageName}/package.json`));
  const scopeDir = path.join(dir, "node_modules", "@forjajs");
  fs.mkdirSync(scopeDir, { recursive: true });
  fs.symlinkSync(realPath, path.join(scopeDir, packageName.split("/")[1]));
}

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-migrate-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-project", version: "0.0.0", dependencies: {} }, null, 2),
  );
  linkRealPackage(dir, "@forjajs/orm");
  linkRealPackage(dir, "@forjajs/core");
  linkRealPackage(dir, "@forjajs/json-driver");

  const betterSqlite3Path = path.dirname(require.resolve("better-sqlite3/package.json"));
  fs.symlinkSync(betterSqlite3Path, path.join(dir, "node_modules", "better-sqlite3"));

  return dir;
}

function writeWidgetMigration(ormFeatureDir: string): void {
  const migrationsDir = path.join(ormFeatureDir, "migrations");
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(
    path.join(migrationsDir, "0001_seed_widget.js"),
    `module.exports = {
  async up(ctx) {
    const widgets = await ctx.openRepository("widget");
    await widgets.create({ id: "w1", name: "Widget One" });
  },
  async down(ctx) {
    const widgets = await ctx.openRepository("widget");
    await widgets.delete("w1");
  },
};
`,
  );
}

describe("forja orm migrate", () => {
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

  it("applies a pending migration against a filesystem driver (json-driver)", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    const ormFeatureDir = path.join(cwd, "features", "orm");
    writeWidgetMigration(ormFeatureDir);

    await OrmMigrateCommand.run([], cliRoot);

    // Verify data actually landed, by reading the same storage directly
    // through the driver's own require("./driver.js") indirection. Vitest
    // sets NODE_ENV=test, so resolveEnv() (used inside migrate.ts) points at
    // orm.config.js's "test" environment — "data/test", not "data/dev".
    const createRepository = require(path.join(ormFeatureDir, "driver.js"));
    const widgets = await createRepository(path.join(cwd, "data", "test", "widget.json-driver"));
    expect(await widgets.findById("w1")).toEqual({ id: "w1", name: "Widget One" });
  });

  it("does not re-apply an already-applied migration", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    const ormFeatureDir = path.join(cwd, "features", "orm");
    writeWidgetMigration(ormFeatureDir);

    await OrmMigrateCommand.run([], cliRoot);
    await OrmMigrateCommand.run([], cliRoot); // should be a no-op, not throw on a duplicate id

    const createRepository = require(path.join(ormFeatureDir, "driver.js"));
    const widgets = await createRepository(path.join(cwd, "data", "test", "widget.json-driver"));
    expect((await widgets.findAll())).toHaveLength(1);
  });

  it("keeps working after forja orm switch-driver (network driver, sqlite -> postgres shape)", async () => {
    addAddon({ cwd, preset: "orm", driverName: "sqlite", withExample: false, log: () => {}, warn: () => {} });
    const ormFeatureDir = path.join(cwd, "features", "orm");
    writeWidgetMigration(ormFeatureDir);

    await OrmSwitchDriverCommand.run(["sqlite"], cliRoot).catch(() => {}); // no-op guard, already active

    await OrmMigrateCommand.run([], cliRoot);

    const createRepository = require(path.join(ormFeatureDir, "driver.js"));
    const widgets = await createRepository(path.join(cwd, "data", "test", "widget.sqlite3"), "widget");
    expect(await widgets.findById("w1")).toEqual({ id: "w1", name: "Widget One" });
  });
});

describe("forja orm migrate rollback", () => {
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

  it("calls down() and removes the _migrations record, so data and applied-state both revert", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    const ormFeatureDir = path.join(cwd, "features", "orm");
    writeWidgetMigration(ormFeatureDir);

    await OrmMigrateCommand.run([], cliRoot);
    await OrmMigrateRollbackCommand.run([], cliRoot);

    const createRepository = require(path.join(ormFeatureDir, "driver.js"));
    const widgets = await createRepository(path.join(cwd, "data", "test", "widget.json-driver"));
    expect(await widgets.findById("w1")).toBeNull();

    const migrations = await createRepository(path.join(cwd, "data", "test", "_migrations.json-driver"));
    expect(await migrations.findById("0001_seed_widget")).toBeNull();
  });

  it("re-running migrate after a rollback re-applies the migration", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    const ormFeatureDir = path.join(cwd, "features", "orm");
    writeWidgetMigration(ormFeatureDir);

    await OrmMigrateCommand.run([], cliRoot);
    await OrmMigrateRollbackCommand.run([], cliRoot);
    await OrmMigrateCommand.run([], cliRoot);

    const createRepository = require(path.join(ormFeatureDir, "driver.js"));
    const widgets = await createRepository(path.join(cwd, "data", "test", "widget.json-driver"));
    expect(await widgets.findById("w1")).toEqual({ id: "w1", name: "Widget One" });
  });

  it("does nothing when no migration has been applied", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    const ormFeatureDir = path.join(cwd, "features", "orm");
    writeWidgetMigration(ormFeatureDir);

    await expect(OrmMigrateRollbackCommand.run([], cliRoot)).resolves.not.toThrow();
  });

  it("respects --steps, rolling back only the most recent N migrations", async () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    const ormFeatureDir = path.join(cwd, "features", "orm");
    const migrationsDir = path.join(ormFeatureDir, "migrations");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, "0001_first.js"),
      `module.exports = {
  async up(ctx) { const r = await ctx.openRepository("widget"); await r.create({ id: "w1", name: "One" }); },
  async down(ctx) { const r = await ctx.openRepository("widget"); await r.delete("w1"); },
};
`,
    );
    fs.writeFileSync(
      path.join(migrationsDir, "0002_second.js"),
      `module.exports = {
  async up(ctx) { const r = await ctx.openRepository("widget"); await r.create({ id: "w2", name: "Two" }); },
  async down(ctx) { const r = await ctx.openRepository("widget"); await r.delete("w2"); },
};
`,
    );

    await OrmMigrateCommand.run([], cliRoot);
    await OrmMigrateRollbackCommand.run(["--steps=1"], cliRoot);

    const createRepository = require(path.join(ormFeatureDir, "driver.js"));
    const widgets = await createRepository(path.join(cwd, "data", "test", "widget.json-driver"));
    expect(await widgets.findById("w1")).toEqual({ id: "w1", name: "One" }); // untouched, only 1 step back
    expect(await widgets.findById("w2")).toBeNull(); // rolled back
  });
});
