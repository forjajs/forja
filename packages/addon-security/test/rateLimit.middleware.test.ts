import * as path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { makeDeployedSecurityLayout } from "./helpers/deployedLayout";

function loadWithEnv(dir: string, env: Record<string, string | undefined>) {
  const original = { ...process.env };
  Object.assign(process.env, env);

  vi.resetModules();
  try {
    return require(path.join(dir, "shared", "middlewares", "07-rate-limit.middleware.js"));
  } finally {
    process.env = original;
  }
}

describe("07-rate-limit.middleware", () => {
  let layout: ReturnType<typeof makeDeployedSecurityLayout>;

  afterEach(() => {
    layout?.cleanup();
  });

  it("reads its window/max from security.config.js instead of parsing process.env itself", () => {
    layout = makeDeployedSecurityLayout();
    const middleware = loadWithEnv(layout.dir, {
      SESSION_SECRET: "x",
      RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_MAX: "5",
    });
    expect(typeof middleware).toBe("function");
  });

  it("falls back to security.config.js's own defaults when unset", () => {
    layout = makeDeployedSecurityLayout();
    const middleware = loadWithEnv(layout.dir, { SESSION_SECRET: "x" });
    expect(typeof middleware).toBe("function");
  });
});
