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
    return require(path.join(dir, "shared", "middlewares", "00-trust-proxy.middleware.js"));
  } finally {
    process.env = original;
  }
}

function fakeReqRes(initialTrustProxy: unknown = false) {
  const settings: Record<string, unknown> = { "trust proxy": initialTrustProxy };
  const req = {
    app: {
      get: (key: string) => settings[key],
      set: (key: string, value: unknown) => {
        settings[key] = value;
      },
    },
  };
  return { req, settings };
}

describe("00-trust-proxy.middleware", () => {
  let layout: ReturnType<typeof makeDeployedSecurityLayout>;

  afterEach(() => {
    delete process.env.TRUST_PROXY;
    delete process.env.SESSION_SECRET;
    layout?.cleanup();
  });

  it("never touches trust proxy when TRUST_PROXY is unset — no proxy assumed by default", () => {
    layout = makeDeployedSecurityLayout();
    const middleware = loadWithEnv(layout.dir, { SESSION_SECRET: "x", TRUST_PROXY: undefined });
    const { req, settings } = fakeReqRes(false);
    let calls = 0;

    middleware(req, {}, () => calls++);

    expect(calls).toBe(1);
    expect(settings["trust proxy"]).toBe(false);
  });

  it("sets trust proxy to a numeric hop count when TRUST_PROXY is a number", () => {
    layout = makeDeployedSecurityLayout();
    const middleware = loadWithEnv(layout.dir, { SESSION_SECRET: "x", TRUST_PROXY: "1" });
    const { req, settings } = fakeReqRes(false);

    middleware(req, {}, () => {});

    expect(settings["trust proxy"]).toBe(1);
  });

  it("passes through a non-numeric value (subnet, \"loopback\"...) as-is", () => {
    layout = makeDeployedSecurityLayout();
    const middleware = loadWithEnv(layout.dir, { SESSION_SECRET: "x", TRUST_PROXY: "loopback" });
    const { req, settings } = fakeReqRes(false);

    middleware(req, {}, () => {});

    expect(settings["trust proxy"]).toBe("loopback");
  });
});
