import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findFiles } from "../src/registry/scan";

describe("findFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-core-scan-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty array when the directory doesn't exist", () => {
    expect(findFiles(path.join(dir, "nope"), ".route.js")).toEqual([]);
  });

  it("finds files matching the suffix at the top level", () => {
    fs.writeFileSync(path.join(dir, "home.route.js"), "");
    fs.writeFileSync(path.join(dir, "home.test.js"), "");

    expect(findFiles(dir, ".route.js")).toEqual([path.join(dir, "home.route.js")]);
  });

  it("recurses into subdirectories", () => {
    fs.mkdirSync(path.join(dir, "users"));
    fs.writeFileSync(path.join(dir, "users", "users.route.js"), "");
    fs.writeFileSync(path.join(dir, "home.route.js"), "");

    const found = findFiles(dir, ".route.js").sort();
    expect(found).toEqual([path.join(dir, "home.route.js"), path.join(dir, "users", "users.route.js")].sort());
  });

  it("returns results in alphabetical order (per directory) so numeric-prefixed files control order", () => {
    fs.writeFileSync(path.join(dir, "02-second.middleware.js"), "");
    fs.writeFileSync(path.join(dir, "01-first.middleware.js"), "");
    fs.writeFileSync(path.join(dir, "03-third.middleware.js"), "");

    expect(findFiles(dir, ".middleware.js")).toEqual([
      path.join(dir, "01-first.middleware.js"),
      path.join(dir, "02-second.middleware.js"),
      path.join(dir, "03-third.middleware.js"),
    ]);
  });

  it("ignores files that don't end with the suffix", () => {
    fs.writeFileSync(path.join(dir, "readme.md"), "");
    fs.writeFileSync(path.join(dir, "index.js"), "");

    expect(findFiles(dir, ".route.js")).toEqual([]);
  });
});
