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
    return require(path.join(dir, "shared", "middlewares", "08-session.middleware.js"));
  } finally {
    process.env = original;
  }
}

describe("08-session.middleware", () => {
  let layout: ReturnType<typeof makeDeployedSecurityLayout>;

  afterEach(() => {
    delete process.env.SESSION_SECRET;
    layout?.cleanup();
  });

  it("throws at load time with no SESSION_SECRET — auth's guard depends on a real session existing", () => {
    layout = makeDeployedSecurityLayout();
    expect(() => loadWithEnv(layout.dir, { SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET/);
  });

  it("loads fine once SESSION_SECRET is set", () => {
    layout = makeDeployedSecurityLayout();
    expect(() => loadWithEnv(layout.dir, { SESSION_SECRET: "test-secret" })).not.toThrow();
  });
});
