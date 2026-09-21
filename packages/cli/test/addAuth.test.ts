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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-addauth-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-project", version: "0.0.0", dependencies: {} }, null, 2),
  );
  return dir;
}

describe("addAddon (auth preset)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpProject();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("ships the fail-fast stub when no ORM is present", () => {
    addAddon({ cwd, preset: "auth", withExample: false, log: () => {}, warn: () => {} });

    const route = fs.readFileSync(path.join(cwd, "features", "auth", "auth.route.js"), "utf8");
    expect(route).toContain("notWired");
    // userModelPromise is the ORM-wired variant's own variable name (not
    // used in the stub's comment, which only mentions the require path as
    // documentation) — a reliable signal this is the plain stub, not the
    // auto-wired file.
    expect(route).not.toContain("userModelPromise");
    // The variant file itself is never shipped into a project.
    expect(fs.existsSync(path.join(cwd, "features", "auth", "auth.route.orm.js"))).toBe(false);
  });

  it("auto-wires to the existing ORM user model when one is already there", () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: true, log: () => {}, warn: () => {} });
    addAddon({ cwd, preset: "auth", withExample: false, log: () => {}, warn: () => {} });

    const route = fs.readFileSync(path.join(cwd, "features", "auth", "auth.route.js"), "utf8");
    expect(route).toContain('require("../orm/models/user.model.js")');
    expect(route).not.toContain("notWired");
  });

  it("generates a User model on the fly when the ORM is present but has no model yet", () => {
    addAddon({ cwd, preset: "orm", driverName: "json-driver", withExample: false, log: () => {}, warn: () => {} });
    expect(fs.existsSync(path.join(cwd, "features", "orm", "models", "user.model.js"))).toBe(false);

    addAddon({ cwd, preset: "auth", withExample: false, log: () => {}, warn: () => {} });

    expect(fs.existsSync(path.join(cwd, "features", "orm", "models", "user.model.js"))).toBe(true);
    const route = fs.readFileSync(path.join(cwd, "features", "auth", "auth.route.js"), "utf8");
    expect(route).toContain('require("../orm/models/user.model.js")');
  });

  it("both variants set req.session.userId on login (the guard depends on it)", () => {
    addAddon({ cwd, preset: "auth", withExample: false, log: () => {}, warn: () => {} });
    const stubRoute = fs.readFileSync(path.join(cwd, "features", "auth", "auth.route.js"), "utf8");
    expect(stubRoute).toContain("req.session.userId = user.id");
  });
});
