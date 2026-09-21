import { describe, it, expect, afterEach } from "vitest";

const MODULE_PATH = "../templates/lib/security.config.js";

function loadWithEnv(env: Record<string, string | undefined>) {
  const original = { ...process.env };
  Object.assign(process.env, env);
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete process.env[key];
  }

  // vi.resetModules() only resets Vitest's own (ESM/vite-transformed) module
  // graph — this file is plain-CJS `require()`d, which goes through Node's
  // own require.cache instead, so that's what actually needs busting between
  // runs to re-evaluate security.config.js against the new env each time.
  delete require.cache[require.resolve(MODULE_PATH)];
  try {
    return require(MODULE_PATH);
  } finally {
    process.env = original;
  }
}

describe("security.config", () => {
  afterEach(() => {
    for (const key of ["SESSION_SECRET", "CORS_ORIGIN", "NODE_ENV", "SESSION_NAME", "RATE_LIMIT_MAX"]) {
      delete process.env[key];
    }
  });

  it("throws with no SESSION_SECRET regardless of environment", () => {
    expect(() => loadWithEnv({ SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET/);
  });

  it("applies defaults for everything optional", () => {
    const config = loadWithEnv({ SESSION_SECRET: "x" });
    expect(config.sessionName).toBe("forja.sid");
    expect(config.sessionMaxAgeMs).toBe(60 * 60 * 1000);
    expect(config.rateLimitWindowMs).toBe(15 * 60 * 1000);
    expect(config.rateLimitMax).toBe(300);
    expect(config.corsOrigin).toBeUndefined();
  });

  it("parses CORS_ORIGIN into a trimmed array", () => {
    const config = loadWithEnv({ SESSION_SECRET: "x", CORS_ORIGIN: "https://a.com, https://b.com" });
    expect(config.corsOrigin).toEqual(["https://a.com", "https://b.com"]);
  });

  it("requires CORS_ORIGIN in production", () => {
    expect(() => loadWithEnv({ SESSION_SECRET: "x", NODE_ENV: "production", CORS_ORIGIN: undefined })).toThrow(
      /CORS_ORIGIN/,
    );
  });
});
