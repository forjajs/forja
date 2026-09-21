import { describe, it, expect } from "vitest";
import { assertImplements } from "../src/assert";

describe("assertImplements", () => {
  it("does not throw when every required method is present", () => {
    const impl = { hash: async () => "x", verify: async () => true };
    expect(() => assertImplements("Hasher", impl, ["hash", "verify"])).not.toThrow();
  });

  it("throws naming every missing method", () => {
    const impl = { hash: async () => "x" };
    expect(() => assertImplements("Hasher", impl, ["hash", "verify"])).toThrow(
      /"Hasher" contract violation: missing method\(s\) verify/,
    );
  });

  it("throws naming all missing methods when several are absent", () => {
    const impl = {};
    expect(() => assertImplements("Repository", impl, ["findById", "create"])).toThrow(
      /missing method\(s\) findById, create/,
    );
  });

  it("rejects a property that exists but isn't a function", () => {
    const impl = { hash: "not-a-function", verify: async () => true };
    expect(() => assertImplements("Hasher", impl, ["hash", "verify"])).toThrow(/missing method\(s\) hash/);
  });

  it("treats null and undefined implementations as missing every method", () => {
    expect(() => assertImplements("Hasher", null, ["hash"])).toThrow(/missing method\(s\) hash/);
    expect(() => assertImplements("Hasher", undefined, ["hash"])).toThrow(/missing method\(s\) hash/);
  });

  it("passes with an empty method list regardless of implementation", () => {
    expect(() => assertImplements("Empty", {}, [])).not.toThrow();
  });
});
