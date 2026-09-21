import { describe, it, expect } from "vitest";
import { ADDON_METHODS } from "../src/addon";
import { HASHER_METHODS } from "../src/hasher";
import { VIEW_ENGINE_METHODS } from "../src/viewEngine";
import { REPOSITORY_METHODS } from "../src/repository";
import { assertImplements } from "../src/assert";

/**
 * These METHODS constants are what assertImplements() actually checks at
 * runtime for each contract — if one drifts from the interface it names (a
 * method renamed on the interface but not here, or vice versa), the runtime
 * guard silently stops protecting that contract. Pin the exact expected shape
 * here so that drift fails loudly in CI instead of surfacing as a confusing
 * "missing method" error against an addon that actually implements it fine.
 */
describe("contract METHODS constants", () => {
  it("Addon", () => {
    expect(ADDON_METHODS).toEqual(["register"]);
  });

  it("Hasher", () => {
    expect(HASHER_METHODS).toEqual(["hash", "verify"]);
  });

  it("ViewEngine", () => {
    expect(VIEW_ENGINE_METHODS).toEqual(["render"]);
  });

  it("Repository", () => {
    expect(REPOSITORY_METHODS).toEqual(["findById", "findOne", "create", "update", "delete"]);
  });

  it("each contract's own well-formed implementation passes assertImplements", () => {
    expect(() =>
      assertImplements("Hasher", { hash: async () => "", verify: async () => true }, HASHER_METHODS),
    ).not.toThrow();
    expect(() => assertImplements("Addon", { name: "x", register: () => {} }, ADDON_METHODS)).not.toThrow();
    expect(() =>
      assertImplements("ViewEngine", { extension: ".pug", render: async () => "" }, VIEW_ENGINE_METHODS),
    ).not.toThrow();
    expect(() =>
      assertImplements(
        "Repository",
        {
          findById: async () => null,
          findOne: async () => null,
          create: async () => ({}),
          update: async () => ({}),
          delete: async () => {},
        },
        REPOSITORY_METHODS,
      ),
    ).not.toThrow();
  });
});
