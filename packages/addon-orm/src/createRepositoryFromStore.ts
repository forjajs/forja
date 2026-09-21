import { randomUUID } from "node:crypto";
import * as contracts from "@forjajs/contracts";
import { HyperLogLog } from "./hyperLogLog";
import { matchesCriteria, type QueryCriteria } from "./query";

/**
 * Minimal primitive shape any KV-style driver must expose to plug into the
 * generic Repository<T> implementation below. Richer drivers (SQL...) are not
 * expected to fit this shape — they implement Repository<T> directly instead,
 * with their own real query mechanics (WHERE, indexes...).
 */
export interface Store<T> {
  get(id: string): Promise<T | null>;
  set(id: string, doc: T): Promise<void>;
  delete(id: string): Promise<void>;
  scan(predicate?: (doc: T) => boolean): Promise<T[]>;
  /**
   * Optional: a driver that can push cursor pagination down to its own query
   * engine (SQL's `WHERE id > ? ORDER BY id LIMIT ?`) implements this for real
   * performance. Without it, findAll()'s pagination falls back to scan() +
   * in-memory sort/slice — correct, but reads every document first. Only used
   * when findAll() is called with no predicate/criteria (a plain page read) —
   * criteria-based or predicate-based calls always filter in-process, since a
   * generic Store has no query engine to push either into.
   */
  list?(options: FindAllOptions<T>): Promise<T[]>;
}

export interface FindAllOptions<T = Record<string, unknown>> {
  /** Only documents with the sort field strictly greater than this cursor. */
  after?: string;
  /** Max number of documents to return. */
  limit?: number;
  /** Field to sort (and cursor-paginate) by — defaults to "id". */
  sortBy?: keyof T;
  /** Sort direction — defaults to "asc". */
  sortDir?: "asc" | "desc";
}

export interface OrmRepository<T> extends contracts.Repository<T> {
  // Widened from contracts.Repository<T>'s Partial<T>: still accepts plain
  // equality (`{ age: 18 }`), but also per-field operators (`{ age: { gt: 18 } }`).
  findOne(criteria: QueryCriteria<T>): Promise<T | null>;

  /**
   * Approximate distinct-value count for `field`, via HyperLogLog — avoids
   * materializing every distinct value in memory for large collections.
   */
  countDistinct(field: keyof T): Promise<number>;

  /**
   * Documents matching `predicateOrCriteria` (all of them if omitted), sorted
   * by `options.sortBy` (id by default). Not part of Repository<T> itself —
   * migrations/seeds need it to read back existing data. Accepts either a
   * plain JS predicate (arbitrary logic, always filtered in-process) or a
   * QueryCriteria object (`{ age: { gt: 18 } }` — the same shape findOne()
   * takes). Pass `{ after, limit }` to page through a large collection
   * instead of loading it all at once — `after` is the last id you saw.
   */
  findAll(
    predicateOrCriteria?: ((doc: T) => boolean) | QueryCriteria<T>,
    options?: FindAllOptions<T>,
  ): Promise<T[]>;

  /**
   * Best-effort "transaction": runs `fn` against a scoped repository, and if
   * `fn` throws, undoes every write it made (in reverse order) before
   * rethrowing. This is NOT atomic — every write is still visible to
   * concurrent readers the instant it happens, since the underlying Store has
   * no BEGIN/COMMIT primitive. Real ACID transactions are the driver
   * adapter's job when its engine actually supports them (see the
   * sqlite/mysql/postgres/mongodb templates, which each override this with a
   * real one); this generic version exists so every driver has *some*
   * transaction support, json-driver included.
   */
  withTransaction<R>(fn: (tx: OrmRepository<T>) => Promise<R>): Promise<R>;
}

function sortDocs<T extends Record<string, unknown>>(docs: T[], options?: FindAllOptions<T>): T[] {
  const field = (options?.sortBy ?? "id") as keyof T;
  const dir = options?.sortDir ?? "asc";
  const sorted = [...docs].sort((a, b) => {
    const av = String(a[field]);
    const bv = String(b[field]);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

function paginate<T extends Record<string, unknown>>(docs: T[], options?: FindAllOptions<T>): T[] {
  const field = (options?.sortBy ?? "id") as keyof T;
  let result = sortDocs(docs, options);
  if (options?.after !== undefined) {
    const dir = options.sortDir ?? "asc";
    result = result.filter((doc) =>
      dir === "desc" ? String(doc[field]) < options.after! : String(doc[field]) > options.after!,
    );
  }
  if (options?.limit !== undefined) {
    result = result.slice(0, options.limit);
  }
  return result;
}

export function createRepositoryFromStore<
  T extends Record<string, unknown> = Record<string, unknown>,
>(store: Store<T>): OrmRepository<T> {
  function build(scopedStore: Store<T>, undoStack?: Array<() => Promise<void>>): OrmRepository<T> {
    const repository: OrmRepository<T> = {
      async findById(id) {
        return (await scopedStore.get(String(id))) ?? null;
      },

      async findOne(criteria) {
        const matches = await scopedStore.scan((doc) => matchesCriteria(doc, criteria));
        return (sortDocs(matches)[0] as T | undefined) ?? null;
      },

      async create(data) {
        const id = (data as Record<string, unknown>).id ?? randomUUID();
        const doc = { ...data, id } as unknown as T;
        await scopedStore.set(String(id), doc);
        undoStack?.push(() => scopedStore.delete(String(id)));
        return doc;
      },

      async update(id, data) {
        const existing = (await scopedStore.get(String(id))) ?? ({} as T);
        const updated = { ...existing, ...data, id } as T;
        await scopedStore.set(String(id), updated);
        undoStack?.push(() =>
          Object.keys(existing).length > 0
            ? scopedStore.set(String(id), existing)
            : scopedStore.delete(String(id)),
        );
        return updated;
      },

      async delete(id) {
        const existing = await scopedStore.get(String(id));
        await scopedStore.delete(String(id));
        if (existing) undoStack?.push(() => scopedStore.set(String(id), existing));
      },

      async findAll(predicateOrCriteria, options) {
        if (predicateOrCriteria === undefined) {
          // A driver's list() (SQL's WHERE id > ? ORDER BY id LIMIT ?) only
          // knows how to sort/cursor by id — anything else falls back to the
          // generic in-process sort, which can order by any field.
          const usesDefaultSort = options?.sortBy === undefined || options.sortBy === "id";
          if (usesDefaultSort && scopedStore.list) return scopedStore.list(options ?? {});
          return paginate(await scopedStore.scan(), options);
        }

        const predicate =
          typeof predicateOrCriteria === "function"
            ? predicateOrCriteria
            : (doc: T) => matchesCriteria(doc, predicateOrCriteria);
        return paginate(await scopedStore.scan(predicate), options);
      },

      async countDistinct(field) {
        const hll = new HyperLogLog();
        const docs = await scopedStore.scan();
        for (const doc of docs) {
          const value = doc[field];
          if (value !== undefined && value !== null) {
            hll.add(String(value));
          }
        }
        return hll.count();
      },

      async withTransaction(fn) {
        const nestedUndoStack: Array<() => Promise<void>> = [];
        const tx = build(scopedStore, nestedUndoStack);
        try {
          return await fn(tx);
        } catch (err) {
          for (const undo of nestedUndoStack.reverse()) {
            await undo();
          }
          throw err;
        }
      },
    };

    return repository;
  }

  const repository = build(store);
  contracts.assertImplements(
    "Repository",
    repository as unknown as Record<string, unknown>,
    contracts.REPOSITORY_METHODS,
  );
  return repository;
}
