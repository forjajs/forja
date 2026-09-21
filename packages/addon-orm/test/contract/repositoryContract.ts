import { describe, it, expect } from "vitest";
import type { QueryCriteria } from "../../src/query";

export interface ContractDoc extends Record<string, unknown> {
  id: string;
  name: string;
  age?: number;
}

interface MinimalRepository {
  findById(id: string): Promise<ContractDoc | null>;
  findOne(criteria: QueryCriteria<ContractDoc>): Promise<ContractDoc | null>;
  create(data: Partial<ContractDoc>): Promise<ContractDoc>;
  update(id: string, data: Partial<ContractDoc>): Promise<ContractDoc | null>;
  delete(id: string): Promise<void>;
  findAll?(
    predicateOrCriteria?: ((doc: ContractDoc) => boolean) | QueryCriteria<ContractDoc>,
    options?: { after?: string; limit?: number; sortBy?: keyof ContractDoc; sortDir?: "asc" | "desc" },
  ): Promise<ContractDoc[]>;
  withTransaction?<R>(fn: (tx: MinimalRepository) => Promise<R>): Promise<R>;
}

/**
 * One test suite, run once per driver, against the exact same assertions.
 * Every adapter (json-driver, sqlite, mysql, postgres, mongodb) must satisfy
 * the Repository<T> contract identically from the outside — that's the whole
 * point of the driver being swappable. `createRepository` must return a fresh,
 * empty repository each call (a new tmp file / new table / new collection),
 * so tests never interfere with each other.
 */
export function testRepositoryContract(driverName: string, createRepository: () => Promise<MinimalRepository>): void {
  describe(`Repository<T> contract — ${driverName}`, () => {
    it("creates a doc, generating an id when none is given", async () => {
      const repo = await createRepository();
      const created = await repo.create({ name: "Alice" });

      expect(created.id).toBeTruthy();
      expect(created.name).toBe("Alice");
    });

    it("finds a doc by id", async () => {
      const repo = await createRepository();
      const created = await repo.create({ name: "Bob" });

      const found = await repo.findById(created.id);
      expect(found).toEqual(created);
    });

    it("returns null from findById when the doc doesn't exist", async () => {
      const repo = await createRepository();
      expect(await repo.findById("missing")).toBeNull();
    });

    it("finds a doc by partial criteria", async () => {
      const repo = await createRepository();
      await repo.create({ name: "Carol", age: 30 });
      await repo.create({ name: "Dave", age: 40 });

      const found = await repo.findOne({ age: 40 });
      expect(found?.name).toBe("Dave");
    });

    it("returns null from findOne when nothing matches", async () => {
      const repo = await createRepository();
      expect(await repo.findOne({ name: "Ghost" })).toBeNull();
    });

    it("findOne/findAll support query operators, not just plain equality", async () => {
      const repo = await createRepository();
      await repo.create({ id: "q1", name: "Ann", age: 18 });
      await repo.create({ id: "q2", name: "Bo", age: 25 });
      await repo.create({ id: "q3", name: "Cy", age: 40 });

      expect((await repo.findOne({ age: { gt: 30 } }))?.name).toBe("Cy");
      expect(await repo.findOne({ age: { lt: 10 } })).toBeNull();

      if (!repo.findAll) return;
      const adults = await repo.findAll({ age: { gte: 25 } });
      expect(adults.map((d) => d.id).sort()).toEqual(["q2", "q3"]);

      const byName = await repo.findAll({ name: { in: ["Ann", "Cy"] } });
      expect(byName.map((d) => d.id).sort()).toEqual(["q1", "q3"]);

      const notAnn = await repo.findAll({ name: { ne: "Ann" } });
      expect(notAnn.map((d) => d.id).sort()).toEqual(["q2", "q3"]);
    });

    it("updates a doc, merging with existing fields", async () => {
      const repo = await createRepository();
      const created = await repo.create({ name: "Eve", age: 25 });

      const updated = await repo.update(created.id, { age: 26 });
      expect(updated).toEqual({ id: created.id, name: "Eve", age: 26 });
    });

    it("deletes a doc", async () => {
      const repo = await createRepository();
      const created = await repo.create({ name: "Frank" });

      await repo.delete(created.id);
      expect(await repo.findById(created.id)).toBeNull();
    });

    it("findAll returns every doc, optionally filtered", async () => {
      const repo = await createRepository();
      if (!repo.findAll) return; // not every adapter exposes it (e.g. hand-rolled ones may skip it)

      await repo.create({ name: "Gina", age: 20 });
      await repo.create({ name: "Hank", age: 50 });

      expect(await repo.findAll()).toHaveLength(2);
      expect(await repo.findAll((doc) => doc.age! > 30)).toHaveLength(1);
    });

    it("findAll paginates with { after, limit }, id-ordered", async () => {
      const repo = await createRepository();
      if (!repo.findAll) return;

      // ids assigned in creation order (uuid v4 isn't sortable that way, so
      // pin explicit ids to make the id-ascending order deterministic here).
      await repo.create({ id: "a", name: "First" });
      await repo.create({ id: "b", name: "Second" });
      await repo.create({ id: "c", name: "Third" });

      const page1 = await repo.findAll(undefined, { limit: 2 });
      expect(page1.map((d) => d.id)).toEqual(["a", "b"]);

      const page2 = await repo.findAll(undefined, { after: page1[page1.length - 1].id });
      expect(page2.map((d) => d.id)).toEqual(["c"]);
    });

    it("findAll sorts by an arbitrary field via { sortBy, sortDir }", async () => {
      const repo = await createRepository();
      if (!repo.findAll) return;

      await repo.create({ id: "s1", name: "Zed", age: 10 });
      await repo.create({ id: "s2", name: "Amy", age: 30 });
      await repo.create({ id: "s3", name: "Mid", age: 20 });

      const ascByAge = await repo.findAll(undefined, { sortBy: "age", sortDir: "asc" });
      expect(ascByAge.map((d) => d.id)).toEqual(["s1", "s3", "s2"]);

      const descByAge = await repo.findAll(undefined, { sortBy: "age", sortDir: "desc" });
      expect(descByAge.map((d) => d.id)).toEqual(["s2", "s3", "s1"]);
    });

    it("withTransaction commits every write when fn succeeds", async () => {
      const repo = await createRepository();
      if (!repo.withTransaction) return; // not every adapter exposes it

      await repo.withTransaction(async (tx) => {
        await tx.create({ id: "tx-1", name: "Committed" });
      });

      expect(await repo.findById("tx-1")).toEqual({ id: "tx-1", name: "Committed" });
    });

    it("withTransaction undoes every write when fn throws", async () => {
      const repo = await createRepository();
      if (!repo.withTransaction) return;

      await repo.create({ id: "pre-existing", name: "Before" });

      await expect(
        repo.withTransaction(async (tx) => {
          await tx.create({ id: "tx-2", name: "Should not survive" });
          await tx.update("pre-existing", { name: "Should not survive either" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(await repo.findById("tx-2")).toBeNull();
      expect(await repo.findById("pre-existing")).toEqual({ id: "pre-existing", name: "Before" });
    });
  });
}
