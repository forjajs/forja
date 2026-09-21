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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forja-addsecurity-env-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-project", version: "0.0.0", dependencies: {} }, null, 2),
  );
  fs.writeFileSync(path.join(dir, ".env"), "NODE_ENV=development\nPORT=3000\n");
  fs.writeFileSync(path.join(dir, ".env.example"), "NODE_ENV=development\nPORT=3000\n");
  return dir;
}

describe("addAddon (security preset) — forjaEnv", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpProject();
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("appends every declared var to both .env and .env.example, without touching existing lines", () => {
    addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} });

    const env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    const envExample = fs.readFileSync(path.join(cwd, ".env.example"), "utf8");

    for (const key of ["TRUST_PROXY", "CORS_ORIGIN", "SESSION_SECRET", "SESSION_NAME", "SESSION_MAX_AGE_MS", "RATE_LIMIT_WINDOW_MS", "RATE_LIMIT_MAX"]) {
      expect(env).toMatch(new RegExp(`^${key}=`, "m"));
      expect(envExample).toMatch(new RegExp(`^${key}=`, "m"));
    }

    // Pre-existing lines survive untouched.
    expect(env).toContain("NODE_ENV=development");
    expect(env).toContain("PORT=3000");
  });

  it("generates a real random SESSION_SECRET in .env, and a safe placeholder in .env.example", () => {
    addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} });

    const env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    const envExample = fs.readFileSync(path.join(cwd, ".env.example"), "utf8");

    const realSecret = env.match(/^SESSION_SECRET=(.+)$/m)?.[1];
    expect(realSecret).toBeDefined();
    expect(realSecret).not.toBe("changeme");
    expect(realSecret!.length).toBeGreaterThanOrEqual(32);

    expect(envExample).toMatch(/^SESSION_SECRET=changeme$/m);
  });

  it("is idempotent — running it twice never duplicates a key", () => {
    addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} });
    fs.rmSync(path.join(cwd, "shared", "middlewares"), { recursive: true, force: true });
    fs.rmSync(path.join(cwd, "features", "security"), { recursive: true, force: true });

    addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} });

    const env = fs.readFileSync(path.join(cwd, ".env"), "utf8");
    const occurrences = env.match(/^SESSION_SECRET=/gm) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("does nothing if the project has no .env at all", () => {
    fs.rmSync(path.join(cwd, ".env"));
    fs.rmSync(path.join(cwd, ".env.example"));

    expect(() => addAddon({ cwd, preset: "security", log: () => {}, warn: () => {} })).not.toThrow();
    expect(fs.existsSync(path.join(cwd, ".env"))).toBe(false);
  });
});
