import { describe, it, expect } from "vitest";
import { createRepositoryFromStore, type Store } from "../src/createRepositoryFromStore";

interface TestDoc extends Record<string, unknown> {
  id: string;
  name: string;
  age?: number;
}

function createInMemoryStore(): Store<TestDoc> {
  const docs = new Map<string, TestDoc>();
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

describe("createRepositoryFromStore", () => {
  it("creates a doc, generating an id when none is given", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    const created = await repo.create({ name: "Alice" });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Alice");
  });

  it("finds a doc by id", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    const created = await repo.create({ name: "Bob" });

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
  });

  it("returns null from findById when the doc doesn't exist", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    expect(await repo.findById("missing")).toBeNull();
  });

  it("finds a doc by partial criteria", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    await repo.create({ name: "Carol", age: 30 });
    await repo.create({ name: "Dave", age: 40 });

    const found = await repo.findOne({ age: 40 });
    expect(found?.name).toBe("Dave");
  });

  it("returns null from findOne when nothing matches", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    expect(await repo.findOne({ name: "Ghost" })).toBeNull();
  });

  it("updates a doc, merging with existing fields", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    const created = await repo.create({ name: "Eve", age: 25 });

    const updated = await repo.update(created.id, { age: 26 });
    expect(updated).toEqual({ id: created.id, name: "Eve", age: 26 });
  });

  it("deletes a doc", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    const created = await repo.create({ name: "Frank" });

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it("findAll returns every doc, optionally filtered", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    await repo.create({ name: "Gina", age: 20 });
    await repo.create({ name: "Hank", age: 50 });

    expect(await repo.findAll()).toHaveLength(2);
    expect(await repo.findAll((doc) => doc.age! > 30)).toHaveLength(1);
  });

  it("countDistinct approximates the number of distinct values for a field", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    await repo.create({ name: "Ian", age: 10 });
    await repo.create({ name: "Jill", age: 10 });
    await repo.create({ name: "Kate", age: 20 });

    expect(await repo.countDistinct("age")).toBe(2);
  });

  it("findAll paginates with { after, limit } when the store has no list(), sorted by id", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    await repo.create({ id: "a", name: "First" });
    await repo.create({ id: "b", name: "Second" });
    await repo.create({ id: "c", name: "Third" });

    expect((await repo.findAll(undefined, { limit: 2 })).map((d) => d.id)).toEqual(["a", "b"]);
    expect((await repo.findAll(undefined, { after: "b" })).map((d) => d.id)).toEqual(["c"]);
  });

  it("findAll delegates to store.list() when present, instead of scan()+sort", async () => {
    const store = createInMemoryStore();
    let listCalled = false;
    store.list = async ({ after, limit } = {}) => {
      listCalled = true;
      const all = await store.scan();
      const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
      const filtered = after ? sorted.filter((d) => d.id > after) : sorted;
      return limit !== undefined ? filtered.slice(0, limit) : filtered;
    };
    const repo = createRepositoryFromStore<TestDoc>(store);
    await repo.create({ id: "a", name: "First" });

    await repo.findAll(undefined, { limit: 1 });
    expect(listCalled).toBe(true);
  });

  it("withTransaction commits writes made inside a successful callback", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());

    await repo.withTransaction(async (tx) => {
      await tx.create({ id: "tx-1", name: "Committed" });
    });

    expect(await repo.findById("tx-1")).toEqual({ id: "tx-1", name: "Committed" });
  });

  it("withTransaction undoes create/update/delete made before a throw, in reverse order", async () => {
    const repo = createRepositoryFromStore<TestDoc>(createInMemoryStore());
    await repo.create({ id: "existing", name: "Original", age: 1 });

    await expect(
      repo.withTransaction(async (tx) => {
        await tx.create({ id: "new-doc", name: "Should vanish" });
        await tx.update("existing", { name: "Mutated" });
        await tx.delete("existing");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await repo.findById("new-doc")).toBeNull();
    expect(await repo.findById("existing")).toEqual({ id: "existing", name: "Original", age: 1 });
  });
});
