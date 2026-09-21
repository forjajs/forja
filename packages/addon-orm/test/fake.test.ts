import { describe, it, expect } from "vitest";
import { fakeFromSchema } from "../src/fake";
import type { ModelSchema } from "../src/defineModel";

describe("fakeFromSchema", () => {
  it("generates a value of the right type for each primitive field", async () => {
    const schema: ModelSchema = {
      fields: {
        name: { type: "string" },
        age: { type: "number" },
        active: { type: "boolean" },
      },
    };

    const doc = await fakeFromSchema<Record<string, unknown>>(schema);
    expect(typeof doc.name).toBe("string");
    expect(typeof doc.age).toBe("number");
    expect(typeof doc.active).toBe("boolean");
  });

  it("generates an email-shaped string for fields whose name contains 'email'", async () => {
    const schema: ModelSchema = { fields: { email: { type: "string" } } };
    const doc = await fakeFromSchema<Record<string, unknown>>(schema);
    expect(doc.email).toMatch(/@example\.com$/);
  });

  it("generates nested object fields recursively", async () => {
    const schema: ModelSchema = {
      fields: {
        address: {
          type: "object",
          fields: { city: { type: "string" }, zip: { type: "number" } },
        },
      },
    };

    const doc = await fakeFromSchema<Record<string, unknown>>(schema);
    const address = doc.address as Record<string, unknown>;
    expect(typeof address.city).toBe("string");
    expect(typeof address.zip).toBe("number");
  });

  it("throws for a relation field when no resolver is given", async () => {
    const schema: ModelSchema = {
      fields: { authorId: { type: "relation", relation: { model: "User", kind: "belongsTo" } } },
    };

    await expect(fakeFromSchema(schema)).rejects.toThrow(/no resolveRelation was provided/);
  });

  it("delegates relation fields to the provided resolver", async () => {
    const schema: ModelSchema = {
      fields: { authorId: { type: "relation", relation: { model: "User", kind: "belongsTo" } } },
    };

    const doc = await fakeFromSchema<Record<string, unknown>>(schema, async (field, relation) => {
      expect(field).toBe("authorId");
      expect(relation.model).toBe("User");
      return "user-123";
    });

    expect(doc.authorId).toBe("user-123");
  });
});
