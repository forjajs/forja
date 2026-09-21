import type * as contracts from "@forjajs/contracts";
import type { QueryCriteria } from "./query";

export type FieldType = "string" | "number" | "boolean" | "object" | "relation";

export type RelationKind = "belongsTo" | "hasMany";

export interface RelationSchema {
  /** Name of the related model, e.g. "User" — matches its models/<name>.model.js. */
  model: string;
  kind: RelationKind;
}

export interface FieldSchema {
  type: FieldType;
  required?: boolean;
  /** Only meaningful when type is "object" — the nested structure, not a free-form blob. */
  fields?: Record<string, FieldSchema>;
  /** Only meaningful when type is "relation". */
  relation?: RelationSchema;
  /** Top-level fields only — rejects create()/update() if another doc already has this value. */
  unique?: boolean;
}

export interface ModelSchema {
  fields: Record<string, FieldSchema>;
}

export interface DefinedModel<T extends Record<string, unknown>> {
  name: string;
  schema: ModelSchema;
}

// --- Schema -> TS type inference, so declaring a schema is enough to get full
// autocomplete on create()/update()/findOne() — no hand-written interface needed.

type InferField<F extends FieldSchema> = F["type"] extends "string"
  ? string
  : F["type"] extends "number"
    ? number
    : F["type"] extends "boolean"
      ? boolean
      : F["type"] extends "object"
        ? InferFields<NonNullable<F["fields"]>>
        : F["type"] extends "relation"
          ? F["relation"] extends { kind: "hasMany" }
            ? string[]
            : string
          : never;

type RequiredKeys<Fields extends Record<string, FieldSchema>> = {
  [K in keyof Fields]: Fields[K]["required"] extends true ? K : never;
}[keyof Fields];

type OptionalKeys<Fields extends Record<string, FieldSchema>> = Exclude<keyof Fields, RequiredKeys<Fields>>;

type InferFields<Fields extends Record<string, FieldSchema>> = {
  [K in RequiredKeys<Fields>]: InferField<Fields[K]>;
} & {
  [K in OptionalKeys<Fields>]?: InferField<Fields[K]>;
};

/** The document type a schema produces — `id` is always present (repository-assigned). */
export type InferSchema<S extends ModelSchema> = { id: string } & InferFields<S["fields"]>;

function validateAgainstFields(
  name: string,
  path: string,
  fields: Record<string, FieldSchema>,
  data: Record<string, unknown>,
  requireFields: boolean,
): void {
  for (const [field, fieldSchema] of Object.entries(fields)) {
    const value = data[field];
    const fieldPath = `${path}${field}`;

    if (value === undefined) {
      if (requireFields && fieldSchema.required) {
        throw new Error(`"${name}" validation failed: "${fieldPath}" is required`);
      }
      continue;
    }

    if (fieldSchema.type === "object") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`"${name}" validation failed: "${fieldPath}" must be an object`);
      }
      validateAgainstFields(
        name,
        `${fieldPath}.`,
        fieldSchema.fields ?? {},
        value as Record<string, unknown>,
        requireFields,
      );
      continue;
    }

    if (fieldSchema.type === "relation") {
      const kind = fieldSchema.relation?.kind;
      if (kind === "hasMany") {
        if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
          throw new Error(`"${name}" validation failed: "${fieldPath}" must be an array of ids`);
        }
      } else if (typeof value !== "string") {
        throw new Error(`"${name}" validation failed: "${fieldPath}" must be an id (string)`);
      }
      continue;
    }

    if (typeof value !== fieldSchema.type) {
      throw new Error(
        `"${name}" validation failed: "${fieldPath}" must be a ${fieldSchema.type}, got ${typeof value}`,
      );
    }
  }

  for (const field of Object.keys(data)) {
    if (!(field in fields)) {
      throw new Error(`"${name}" validation failed: unknown field "${path}${field}"`);
    }
  }
}

/** Every model gets a declared, unique `id` field for free — the store's own key. */
function withIdField(fields: Record<string, FieldSchema>): Record<string, FieldSchema> {
  return { id: { type: "string", unique: true }, ...fields };
}

function validate(
  name: string,
  schema: ModelSchema,
  data: Record<string, unknown>,
  requireFields: boolean,
): void {
  validateAgainstFields(name, "", withIdField(schema.fields), data, requireFields);
}

async function checkUniqueFields<T extends Record<string, unknown>>(
  name: string,
  schema: ModelSchema,
  data: Record<string, unknown>,
  repository: contracts.Repository<T>,
  excludeId?: string | number,
): Promise<void> {
  for (const [field, fieldSchema] of Object.entries(withIdField(schema.fields))) {
    if (!fieldSchema.unique) continue;

    const value = data[field];
    if (value === undefined) continue;

    const existing = await repository.findOne({ [field]: value } as Partial<T>);
    if (existing && String((existing as Record<string, unknown>).id) !== String(excludeId)) {
      throw new Error(`"${name}" validation failed: "${field}" must be unique, "${value}" is already taken`);
    }
  }
}

/**
 * A related model, as far as populate() needs to know about it — a lazy
 * loader (not the model itself) so sibling model files can require() each
 * other without a circular-require crash at module load time (same reason
 * model files are `module.exports = (async () => {...})()` in the first
 * place: awaiting the loader resolves that same promise).
 */
export type RelationLoader = () => Promise<{ findById(id: string): Promise<Record<string, unknown> | null> }>;

export interface DefineModelOptions {
  /**
   * How to resolve each "relation" field's id(s) into the related model's
   * document(s) when populate is requested — keyed by field name, e.g.
   * `{ authorId: () => require("./user.model.js") }`. Only needed for fields
   * you actually populate(); a relation field with no loader configured just
   * stays a plain id (or array of ids) forever, which is fine too.
   */
  relations?: Record<string, RelationLoader>;
}

async function populateFields<T extends Record<string, unknown>>(
  name: string,
  schema: ModelSchema,
  relations: Record<string, RelationLoader> | undefined,
  doc: T | null,
  fields: string[],
): Promise<T | null> {
  if (!doc || fields.length === 0) return doc;

  const result: Record<string, unknown> = { ...doc };
  for (const field of fields) {
    const fieldSchema = schema.fields[field];
    if (!fieldSchema || fieldSchema.type !== "relation") {
      throw new Error(`"${name}": cannot populate "${field}" — it isn't declared as a relation field.`);
    }
    const loader = relations?.[field];
    if (!loader) {
      throw new Error(
        `"${name}": cannot populate "${field}" — no relation loader configured (pass { relations: { ${field}: () => require(...) } } to defineModel()).`,
      );
    }

    const relatedModel = await loader();
    const value = (doc as Record<string, unknown>)[field];
    if (fieldSchema.relation?.kind === "hasMany") {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      result[field] = await Promise.all(ids.map((id) => relatedModel.findById(id)));
    } else {
      result[field] = typeof value === "string" ? await relatedModel.findById(value) : null;
    }
  }
  return result as T;
}

async function populateMany<T extends Record<string, unknown>>(
  name: string,
  schema: ModelSchema,
  relations: Record<string, RelationLoader> | undefined,
  docs: T[],
  fields: string[],
): Promise<T[]> {
  return Promise.all(docs.map((doc) => populateFields(name, schema, relations, doc, fields) as Promise<T>));
}

/**
 * Wraps a Repository with a declared field schema, validated on create/update
 * before the underlying driver ever sees the write. The document type (and every
 * create()/update()/findOne() completion) is inferred straight from `schema` —
 * no hand-written TS interface needed, same ergonomics as Zod's z.infer.
 */
type RepositoryMethod = keyof contracts.Repository<Record<string, unknown>>;

export interface PopulateOptions {
  /** Relation field names to resolve into their related doc(s) instead of leaving them as plain id(s). */
  populate?: string[];
}

/**
 * Same 5 core methods as contracts.Repository<T>, but with findOne() widened
 * to accept query operators (`{ age: { gt: 18 } }`), not just plain equality,
 * and findById()/findOne() accepting a `{ populate }` option — matches
 * OrmRepository's own widened findOne. Used instead of contracts.Repository<T>
 * directly in defineModel()'s return type so callers get the richer type back
 * too, not just the DIP-minimal one.
 */
interface ModelCoreRepository<T extends Record<string, unknown>> {
  findById(id: string | number, options?: PopulateOptions): Promise<T | null>;
  findOne(criteria: QueryCriteria<T>, options?: PopulateOptions): Promise<T | null>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>): Promise<T>;
  delete(id: string | number): Promise<void>;
}

/**
 * If the underlying repository exposes withTransaction (every driver does —
 * generic best-effort from createRepositoryFromStore, or a real ACID one from
 * a hand-rolled adapter like mongodb's), wrap it so the `tx` handed to the
 * callback is validated exactly like the outer model — schema rules and
 * uniqueness checks still apply to every create()/update() made inside a
 * transaction, not just outside one.
 */
function wrapTransactionalRepository<S extends ModelSchema>(
  name: string,
  schema: S,
  tx: contracts.Repository<Record<string, unknown>>,
): unknown {
  return {
    ...tx,
    name,
    schema,
    async create(data: Record<string, unknown>) {
      validate(name, schema, data, true);
      await checkUniqueFields(name, schema, data, tx);
      return tx.create(data);
    },
    async update(id: string | number, data: Record<string, unknown>) {
      validate(name, schema, data, false);
      await checkUniqueFields(name, schema, data, tx, id);
      return tx.update(id, data);
    },
  };
}

export function defineModel<
  const S extends ModelSchema,
  R extends contracts.Repository<Record<string, unknown>> = contracts.Repository<Record<string, unknown>>,
>(
  name: string,
  schema: S,
  repository: R,
  options?: DefineModelOptions,
): Omit<R, RepositoryMethod> & ModelCoreRepository<InferSchema<S>> & DefinedModel<InferSchema<S>> {
  const rawWithTransaction = (repository as unknown as { withTransaction?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).withTransaction;
  const rawFindAll = (
    repository as unknown as {
      findAll?: (predicateOrCriteria?: unknown, findAllOptions?: unknown) => Promise<Record<string, unknown>[]>;
    }
  ).findAll;

  return {
    ...repository,
    name,
    schema,
    async findById(id: string | number, populateOptions?: PopulateOptions) {
      const doc = (await repository.findById(id)) as Record<string, unknown> | null;
      return populateFields(name, schema, options?.relations, doc, populateOptions?.populate ?? []);
    },
    async findOne(criteria: QueryCriteria<Record<string, unknown>>, populateOptions?: PopulateOptions) {
      const doc = (await repository.findOne(criteria as Partial<Record<string, unknown>>)) as Record<
        string,
        unknown
      > | null;
      return populateFields(name, schema, options?.relations, doc, populateOptions?.populate ?? []);
    },
    async create(data: Partial<InferSchema<S>>) {
      validate(name, schema, data as Record<string, unknown>, true);
      await checkUniqueFields(name, schema, data as Record<string, unknown>, repository);
      return repository.create(data as Record<string, unknown>) as Promise<InferSchema<S>>;
    },
    async update(id: string | number, data: Partial<InferSchema<S>>) {
      validate(name, schema, data as Record<string, unknown>, false);
      await checkUniqueFields(name, schema, data as Record<string, unknown>, repository, id);
      return repository.update(id, data as Record<string, unknown>) as Promise<InferSchema<S>>;
    },
    ...(rawFindAll
      ? {
          async findAll(predicateOrCriteria?: unknown, findAllOptions?: PopulateOptions & Record<string, unknown>) {
            const docs = await rawFindAll.call(repository, predicateOrCriteria, findAllOptions);
            return populateMany(name, schema, options?.relations, docs, findAllOptions?.populate ?? []);
          },
        }
      : {}),
    ...(rawWithTransaction
      ? {
          async withTransaction(fn: (tx: unknown) => Promise<unknown>) {
            return rawWithTransaction.call(repository, (tx: unknown) =>
              fn(wrapTransactionalRepository(name, schema, tx as contracts.Repository<Record<string, unknown>>)),
            );
          },
        }
      : {}),
  } as unknown as Omit<R, RepositoryMethod> & ModelCoreRepository<InferSchema<S>> & DefinedModel<InferSchema<S>>;
}
