import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRateLimiter } = require("../templates/lib/security.rateLimiters.js");

describe("security.rateLimiters", () => {
  it("returns an Express middleware function", () => {
    const limiter = createRateLimiter();
    expect(typeof limiter).toBe("function");
  });

  it("accepts a custom windowMs/max without throwing", () => {
    expect(() => createRateLimiter({ windowMs: 60_000, max: 5 })).not.toThrow();
  });
});
