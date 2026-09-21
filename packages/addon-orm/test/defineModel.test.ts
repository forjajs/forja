import { describe, it, expect } from "vitest";
import { createRepositoryFromStore, type Store } from "../src/createRepositoryFromStore";
import { defineModel, type ModelSchema } from "../src/defineModel";

interface UserDoc extends Record<string, unknown> {
  id: string;
  email: string;
  age?: number;
  address?: { city: string };
  tagIds?: string[];
  authorId?: string;
}

function createInMemoryStore(): Store<UserDoc> {
  return createStore<UserDoc>();
}

function createStore<T extends Record<string, unknown>>(): Store<T> {
  const docs = new Map<string, T>();
  return {
    async get(id) {
      return docs.get(id) ?? null;
    },
    async set(id, doc) {
      docs.set(id, doc);
    },
    async delete(id) {
      docs.delete(id);
    },
    async scan(predicate) {
      const all = [...docs.values()];
      return predicate ? all.filter(predicate) : all;
    },
  };
}

const userSchema: ModelSchema = {
  fields: {
    email: { type: "string", required: true },
    age: { type: "number", required: false },
  },
};

describe("defineModel", () => {
  it("creates a doc that satisfies the schema", async () => {
    const model = defineModel("User", userSchema, createRepositoryFromStore(createInMemoryStore()));
    const created = await model.create({ email: "a@a.com" });
    expect(created.email).toBe("a@a.com");
  });

  it("rejects create() when a required field is missing", async () => {
    const model = defineModel("User", userSchema, createRepositoryFromStore(createInMemoryStore()));
    await expect(model.create({ age: 20 })).rejects.toThrow(/"email" is required/);
  });

  it("rejects create() when a field has the wrong type", async () => {
    const model = defineModel("User", userSchema, createRepositoryFromStore(createInMemoryStore()));
    await expect(model.create({ email: "a@a.com", age: "old" as unknown as number })).rejects.toThrow(
      /"age" must be a number/,
    );
  });

  it("rejects create() when an undeclared field is passed", async () => {
    const model = defineModel("User", userSchema, createRepositoryFromStore(createInMemoryStore()));
    await expect(model.create({ email: "a@a.com", nope: 1 } as never)).rejects.toThrow(/unknown field "nope"/);
  });

  it("rejects update() the same way as create()", async () => {
    const model = defineModel("User", userSchema, createRepositoryFromStore(createInMemoryStore()));
    const created = await model.create({ email: "a@a.com" });
    await expect(model.update(created.id, { age: "old" as unknown as number })).rejects.toThrow(
      /"age" must be a number/,
    );
  });

  it("validates nested object fields recursively", async () => {
    const schema: ModelSchema = {
      fields: {
        email: { type: "string", required: true },
        address: { type: "object", fields: { city: { type: "string", required: true } } },
      },
    };
    const model = defineModel("User", schema, createRepositoryFromStore(createInMemoryStore()));

    await expect(model.create({ email: "a@a.com", address: {} as never })).rejects.toThrow(
      /"address.city" is required/,
    );

    const created = await model.create({ email: "a@a.com", address: { city: "Paris" } });
    expect(created.address).toEqual({ city: "Paris" });
  });

  it("validates relation fields: belongsTo must be a string id", async () => {
    const schema: ModelSchema = {
      fields: {
        email: { type: "string", required: true },
        authorId: { type: "relation", relation: { model: "User", kind: "belongsTo" } },
      },
    };
    const model = defineModel("Post", schema, createRepositoryFromStore(createInMemoryStore()));

    await expect(model.create({ email: "a@a.com", authorId: 42 as unknown as string })).rejects.toThrow(
      /"authorId" must be an id/,
    );

    const created = await model.create({ email: "a@a.com", authorId: "user-1" });
    expect(created.authorId).toBe("user-1");
  });

  it("validates relation fields: hasMany must be an array of string ids", async () => {
    const schema: ModelSchema = {
      fields: {
        email: { type: "string", required: true },
        tagIds: { type: "relation", relation: { model: "Tag", kind: "hasMany" } },
      },
    };
    const model = defineModel("Post", schema, createRepositoryFromStore(createInMemoryStore()));

    await expect(model.create({ email: "a@a.com", tagIds: "t1" as unknown as string[] })).rejects.toThrow(
      /"tagIds" must be an array of ids/,
    );

    const created = await model.create({ email: "a@a.com", tagIds: ["t1", "t2"] });
    expect(created.tagIds).toEqual(["t1", "t2"]);
  });

  it("declares an implicit unique 'id' field, rejecting a caller-supplied duplicate id", async () => {
    const model = defineModel("User", userSchema, createRepositoryFromStore(createInMemoryStore()));
    const created = await model.create({ email: "a@a.com" });

    await expect(model.create({ id: created.id, email: "b@b.com" } as never)).rejects.toThrow(
      /"id" must be unique/,
    );
  });

  it("rejects create() when a unique field's value is already taken", async () => {
    const schema: ModelSchema = {
      fields: { email: { type: "string", required: true, unique: true } },
    };
    const model = defineModel("User", schema, createRepositoryFromStore(createInMemoryStore()));

    await model.create({ email: "a@a.com" });
    await expect(model.create({ email: "a@a.com" })).rejects.toThrow(/"email" must be unique/);
  });

  it("allows update() to keep a unique field's own existing value", async () => {
    const schema: ModelSchema = {
      fields: { email: { type: "string", required: true, unique: true }, age: { type: "number" } },
    };
    const model = defineModel("User", schema, createRepositoryFromStore(createInMemoryStore()));

    const created = await model.create({ email: "a@a.com" });
    const updated = await model.update(created.id, { email: "a@a.com", age: 30 });
    expect(updated.age).toBe(30);
  });

  it("rejects update() when a unique field's value collides with another doc", async () => {
    const schema: ModelSchema = {
      fields: { email: { type: "string", required: true, unique: true } },
    };
    const model = defineModel("User", schema, createRepositoryFromStore(createInMemoryStore()));

    await model.create({ email: "a@a.com" });
    const second = await model.create({ email: "b@b.com" });

    await expect(model.update(second.id, { email: "a@a.com" })).rejects.toThrow(/"email" must be unique/);
  });

  it("exposes name and schema on the returned model", () => {
    const model = defineModel("User", userSchema, createRepositoryFromStore(createInMemoryStore()));
    expect(model.name).toBe("User");
    expect(model.schema).toBe(userSchema);
  });

  it("withTransaction: validation still applies to create()/update() made inside the callback", async () => {
    const model = defineModel("User", userSchema, createRepositoryFromStore(createInMemoryStore())) as unknown as {
      withTransaction<R>(fn: (tx: typeof model) => Promise<R>): Promise<R>;
    } & typeof model;

    await expect(
      model.withTransaction(async (tx) => {
        await tx.create({ age: 20 } as never); // missing required "email" — should still be rejected
      }),
    ).rejects.toThrow(/"email" is required/);
  });

  it("withTransaction: a later validation failure rolls back earlier writes made in the same callback", async () => {
    const schema: ModelSchema = {
      fields: { email: { type: "string", required: true, unique: true } },
    };
    const model = defineModel("User", schema, createRepositoryFromStore(createInMemoryStore())) as unknown as {
      withTransaction<R>(fn: (tx: typeof model) => Promise<R>): Promise<R>;
    } & typeof model;

    await expect(
      model.withTransaction(async (tx) => {
        await tx.create({ email: "a@a.com" });
        await tx.create({ email: "a@a.com" }); // unique violation — throws, should undo the first create too
      }),
    ).rejects.toThrow(/"email" must be unique/);

    expect(await model.findOne({ email: "a@a.com" })).toBeNull();
  });
});

interface PostDoc extends Record<string, unknown> {
  id: string;
  title: string;
  authorId: string;
  tagIds: string[];
}

describe("defineModel relations/populate", () => {
  function buildUserAndPost() {
    const userSchema: ModelSchema = {
      fields: { email: { type: "string", required: true } },
    };
    const postSchema: ModelSchema = {
      fields: {
        title: { type: "string", required: true },
        authorId: { type: "relation", relation: { model: "User", kind: "belongsTo" } },
        tagIds: { type: "relation", relation: { model: "Tag", kind: "hasMany" } },
      },
    };

    const userModel = defineModel("User", userSchema, createRepositoryFromStore(createStore<UserDoc>()));
    const postModel = defineModel("Post", postSchema, createRepositoryFromStore(createStore<PostDoc>()), {
      relations: { authorId: async () => userModel },
    });

    return { userModel, postModel };
  }

  it("findById/findOne leave relation fields as plain ids when populate isn't requested", async () => {
    const { userModel, postModel } = buildUserAndPost();
    const author = await userModel.create({ email: "a@a.com" });
    const post = await postModel.create({ title: "Hello", authorId: author.id, tagIds: [] });

    const found = await postModel.findById(post.id);
    expect(found!.authorId).toBe(author.id);
  });

  it("findById populates a belongsTo relation into the actual related doc", async () => {
    const { userModel, postModel } = buildUserAndPost();
    const author = await userModel.create({ email: "a@a.com" });
    const post = await postModel.create({ title: "Hello", authorId: author.id, tagIds: [] });

    const found = await postModel.findById(post.id, { populate: ["authorId"] });
    expect(found!.authorId).toEqual(author);
  });

  it("findOne populates too", async () => {
    const { userModel, postModel } = buildUserAndPost();
    const author = await userModel.create({ email: "a@a.com" });
    await postModel.create({ title: "Hello", authorId: author.id, tagIds: [] });

    const found = await postModel.findOne({ title: "Hello" }, { populate: ["authorId"] });
    expect(found!.authorId).toEqual(author);
  });

  it("findAll populates every returned doc", async () => {
    const { userModel, postModel } = buildUserAndPost();
    const author = await userModel.create({ email: "a@a.com" });
    await postModel.create({ title: "One", authorId: author.id, tagIds: [] });
    await postModel.create({ title: "Two", authorId: author.id, tagIds: [] });

    const all = await (postModel as unknown as { findAll: (c?: unknown, o?: unknown) => Promise<PostDoc[]> }).findAll(
      undefined,
      { populate: ["authorId"] },
    );
    expect(all).toHaveLength(2);
    for (const post of all) {
      expect(post.authorId).toEqual(author);
    }
  });

  it("populates a hasMany relation into an array of related docs", async () => {
    const tagSchema: ModelSchema = { fields: { name: { type: "string", required: true } } };
    const tagModel = defineModel("Tag", tagSchema, createRepositoryFromStore(createStore()));
    const t1 = await tagModel.create({ name: "js" });
    const t2 = await tagModel.create({ name: "ts" });

    const postSchema: ModelSchema = {
      fields: {
        title: { type: "string", required: true },
        tagIds: { type: "relation", relation: { model: "Tag", kind: "hasMany" } },
      },
    };
    const postModel = defineModel("Post", postSchema, createRepositoryFromStore(createStore<PostDoc>()), {
      relations: { tagIds: async () => tagModel },
    });

    const post = await postModel.create({ title: "Hello", tagIds: [t1.id, t2.id] });
    const found = await postModel.findById(post.id, { populate: ["tagIds"] });
    expect(found!.tagIds).toEqual([t1, t2]);
  });

  it("throws when populate is requested for a field with no relation loader configured", async () => {
    const { postModel } = buildUserAndPost();
    const post = await postModel.create({ title: "Hello", authorId: "x", tagIds: [] });

    // Rebuild without a loader for authorId to exercise the missing-loader path.
    const bareSchema: ModelSchema = {
      fields: {
        title: { type: "string", required: true },
        authorId: { type: "relation", relation: { model: "User", kind: "belongsTo" } },
        tagIds: { type: "relation", relation: { model: "Tag", kind: "hasMany" } },
      },
    };
    const bareStore = createStore<PostDoc>();
    await bareStore.set(post.id, post);
    const bareModel = defineModel("Post", bareSchema, createRepositoryFromStore(bareStore));

    await expect(bareModel.findById(post.id, { populate: ["authorId"] })).rejects.toThrow(
      /no relation loader configured/,
    );
  });

  it("throws when populate is requested for a field that isn't a relation", async () => {
    const { userModel } = buildUserAndPost();
    const user = await userModel.create({ email: "a@a.com" });

    await expect(userModel.findById(user.id, { populate: ["email"] })).rejects.toThrow(
      /isn't declared as a relation field/,
    );
  });
});
