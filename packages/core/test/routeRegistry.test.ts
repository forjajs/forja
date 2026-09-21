import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Application } from "express";
import { RouteRegistry } from "../src/registry/routeRegistry";

function fakeApp(): { app: Application; used: unknown[] } {
  const used: unknown[] = [];
  const app = { use: vi.fn((handler: unknown) => used.push(handler)) } as unknown as Application;
  return { app, used };
}

describe("RouteRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-core-routes-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("mounts every *.route.js file it finds", () => {
    fs.writeFileSync(path.join(dir, "home.route.js"), `module.exports = function homeRouter() {};`);
    fs.writeFileSync(path.join(dir, "users.route.js"), `module.exports = function usersRouter() {};`);
    fs.writeFileSync(path.join(dir, "not-a-route.js"), `module.exports = function ignored() {};`);

    const { app, used } = fakeApp();
    const loaded = new RouteRegistry(app, { featuresDir: dir }).load();

    expect(loaded).toHaveLength(2);
    expect(used).toHaveLength(2);
  });

  it("supports an ES-module-style default export", () => {
    fs.writeFileSync(path.join(dir, "home.route.js"), `exports.default = function homeRouter() {};`);

    const { app, used } = fakeApp();
    new RouteRegistry(app, { featuresDir: dir }).load();

    expect(used).toHaveLength(1);
  });

  it("throws when a route file doesn't export a function", () => {
    fs.writeFileSync(path.join(dir, "broken.route.js"), `module.exports = { not: "a function" };`);

    const { app } = fakeApp();
    expect(() => new RouteRegistry(app, { featuresDir: dir }).load()).toThrow(
      /must export an Express Router/,
    );
  });

  it("does nothing when the features directory doesn't exist", () => {
    const { app, used } = fakeApp();
    const loaded = new RouteRegistry(app, { featuresDir: path.join(dir, "nope") }).load();

    expect(loaded).toEqual([]);
    expect(used).toEqual([]);
  });

  it("throws on a route collision across two files, and mounts nothing", () => {
    // Hand-built minimal stand-in for an Express Router's shape (a callable
    // function with a `.stack` of { route: { path, methods } } entries) —
    // avoids requiring "express" from a file written outside the monorepo's
    // own node_modules resolution chain (a tmp dir), while still exercising
    // the exact shape routeCollisions.ts inspects.
    const fakeRouterModule = (path_: string, method: string) => `
function router() {}
router.stack = [{ route: { path: "${path_}", methods: { ${method}: true } } }];
module.exports = router;`;

    fs.writeFileSync(path.join(dir, "a.route.js"), fakeRouterModule("/register", "post"));
    fs.writeFileSync(path.join(dir, "b.route.js"), fakeRouterModule("/register", "post"));

    const { app, used } = fakeApp();
    expect(() => new RouteRegistry(app, { featuresDir: dir }).load()).toThrow(/Route collision: "POST \/register"/);
    // Fails before mounting anything — no partial, order-dependent state.
    expect(used).toHaveLength(0);
  });

  it("respects a custom suffix", () => {
    fs.writeFileSync(path.join(dir, "home.api.js"), `module.exports = function homeRouter() {};`);
    fs.writeFileSync(path.join(dir, "home.route.js"), `module.exports = function ignored() {};`);

    const { app, used } = fakeApp();
    const loaded = new RouteRegistry(app, { featuresDir: dir, suffix: ".api.js" }).load();

    expect(loaded).toHaveLength(1);
    expect(used).toHaveLength(1);
  });
});
