import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createConfig } from "../src/config/createConfig";

describe("createConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TEST_PORT;
    delete process.env.TEST_SECRET;
    delete process.env.TEST_FLAG;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads a value straight from the environment", () => {
    process.env.TEST_SECRET = "abc123";
    const config = createConfig({ secret: { env: "TEST_SECRET" } });
    expect(config.secret).toBe("abc123");
  });

  it("falls back to default when the env var is missing", () => {
    const config = createConfig({ port: { env: "TEST_PORT", default: 3000 } });
    expect(config.port).toBe(3000);
  });

  it("prefers the env var over the default when both are present", () => {
    process.env.TEST_PORT = "8080";
    const config = createConfig({ port: { env: "TEST_PORT", default: 3000, parse: Number } });
    expect(config.port).toBe(8080);
  });

  it("applies parse() to the raw string value", () => {
    process.env.TEST_PORT = "8080";
    const config = createConfig({ port: { env: "TEST_PORT", parse: Number } });
    expect(config.port).toBe(8080);
    expect(typeof config.port).toBe("number");
  });

  it("throws immediately when a required field is missing", () => {
    expect(() => createConfig({ secret: { env: "TEST_SECRET", required: true } })).toThrow(
      /Missing required environment variable "TEST_SECRET"/,
    );
  });

  it("does not throw for a required field that IS present", () => {
    process.env.TEST_SECRET = "present";
    expect(() => createConfig({ secret: { env: "TEST_SECRET", required: true } })).not.toThrow();
  });

  it("yields undefined for an optional field with no default and no env value", () => {
    const config = createConfig({ flag: { env: "TEST_FLAG" } });
    expect(config.flag).toBeUndefined();
  });

  it("builds every field of a multi-field schema independently", () => {
    process.env.TEST_PORT = "9000";
    const config = createConfig({
      port: { env: "TEST_PORT", parse: Number, default: 3000 },
      secret: { env: "TEST_SECRET", default: "dev-secret" },
    });
    expect(config).toEqual({ port: 9000, secret: "dev-secret" });
  });
});
