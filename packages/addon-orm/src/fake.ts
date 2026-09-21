import type { ModelSchema, FieldSchema, RelationSchema } from "./defineModel";

const WORDS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
];

export type RelationResolver = (field: string, relation: RelationSchema) => Promise<unknown>;

function fakeString(field: string): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  if (field.toLowerCase().includes("email")) {
    return `${word}${Math.floor(Math.random() * 1000)}@example.com`;
  }
  return `${word}-${Math.floor(Math.random() * 1000)}`;
}

async function fakeField(
  field: string,
  fieldSchema: FieldSchema,
  resolveRelation?: RelationResolver,
): Promise<unknown> {
  switch (fieldSchema.type) {
    case "string":
      return fakeString(field);
    case "number":
      return Math.floor(Math.random() * 1000);
    case "boolean":
      return Math.random() < 0.5;
    case "object":
      return fakeFields(fieldSchema.fields ?? {}, resolveRelation);
    case "relation":
      if (!resolveRelation) {
        throw new Error(
          `fakeFromSchema: field "${field}" is a relation but no resolveRelation was provided`,
        );
      }
      if (!fieldSchema.relation) {
        throw new Error(`fakeFromSchema: field "${field}" is missing its relation schema`);
      }
      return resolveRelation(field, fieldSchema.relation);
  }
}

async function fakeFields(
  fields: Record<string, FieldSchema>,
  resolveRelation?: RelationResolver,
): Promise<Record<string, unknown>> {
  const doc: Record<string, unknown> = {};
  for (const [field, fieldSchema] of Object.entries(fields)) {
    doc[field] = await fakeField(field, fieldSchema, resolveRelation);
  }
  return doc;
}

/**
 * Generates one fake document matching `schema` — every declared field (nested
 * "object" fields recursively, "relation" fields via `resolveRelation`) gets a
 * value of the right shape, so `forja orm seed` never needs hand-written fixtures.
 */
export async function fakeFromSchema<T extends Record<string, unknown>>(
  schema: ModelSchema,
  resolveRelation?: RelationResolver,
): Promise<T> {
  return fakeFields(schema.fields, resolveRelation) as Promise<T>;
}
