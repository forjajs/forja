import * as path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { makeDeployedSecurityLayout } from "./helpers/deployedLayout";

function loadWithEnv(dir: string, env: Record<string, string | undefined>) {
  const original = { ...process.env };
  Object.assign(process.env, env);
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) delete process.env[key];
  }

  vi.resetModules();
  try {
    return require(path.join(dir, "shared", "middlewares", "03-cors.middleware.js"));
  } finally {
    process.env = original;
  }
}

describe("03-cors.middleware", () => {
  let layout: ReturnType<typeof makeDeployedSecurityLayout>;

  afterEach(() => {
    delete process.env.CORS_ORIGIN;
    delete process.env.NODE_ENV;
    layout?.cleanup();
  });

  it("throws at load time in production with no CORS_ORIGIN — never silently falls back to origin: '*'", () => {
    layout = makeDeployedSecurityLayout();
    expect(() => loadWithEnv(layout.dir, { NODE_ENV: "production", CORS_ORIGIN: undefined, SESSION_SECRET: "x" })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it("loads fine in development with no CORS_ORIGIN (cross-origin simply disabled, not opened up)", () => {
    layout = makeDeployedSecurityLayout();
    expect(() =>
      loadWithEnv(layout.dir, { NODE_ENV: "development", CORS_ORIGIN: undefined, SESSION_SECRET: "x" }),
    ).not.toThrow();
  });

  it("loads fine in production once CORS_ORIGIN is set", () => {
    layout = makeDeployedSecurityLayout();
    expect(() =>
      loadWithEnv(layout.dir, { NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com", SESSION_SECRET: "x" }),
    ).not.toThrow();
  });
});
