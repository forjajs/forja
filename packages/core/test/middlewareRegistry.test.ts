import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Application } from "express";
import { MiddlewareRegistry } from "../src/registry/middlewareRegistry";

function fakeApp(): { app: Application; used: unknown[] } {
  const used: unknown[] = [];
  const app = { use: vi.fn((handler: unknown) => used.push(handler)) } as unknown as Application;
  return { app, used };
}

describe("MiddlewareRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-core-middlewares-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("mounts every *.middleware.js file it finds, in filename order", () => {
    fs.writeFileSync(path.join(dir, "02-second.middleware.js"), `module.exports = (req, res, next) => next();`);
    fs.writeFileSync(path.join(dir, "01-first.middleware.js"), `module.exports = (req, res, next) => next();`);

    const { app, used } = fakeApp();
    const loaded = new MiddlewareRegistry(app, { middlewaresDir: dir }).load();

    expect(loaded).toEqual([
      path.join(dir, "01-first.middleware.js"),
      path.join(dir, "02-second.middleware.js"),
    ]);
    expect(used).toHaveLength(2);
  });

  it("throws when a middleware file doesn't export a function", () => {
    fs.writeFileSync(path.join(dir, "broken.middleware.js"), `module.exports = 42;`);

    const { app } = fakeApp();
    expect(() => new MiddlewareRegistry(app, { middlewaresDir: dir }).load()).toThrow(
      /must export an Express middleware function/,
    );
  });

  it("does nothing when the middlewares directory doesn't exist", () => {
    const { app, used } = fakeApp();
    const loaded = new MiddlewareRegistry(app, { middlewaresDir: path.join(dir, "nope") }).load();

    expect(loaded).toEqual([]);
    expect(used).toEqual([]);
  });
});
