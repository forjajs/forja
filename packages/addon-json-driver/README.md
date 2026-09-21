# @forjajs/json-driver

A real, page-based B+tree JSON document storage engine — written from scratch in
TypeScript, with zero dependencies. Usable on its own in any Node.js project, no
[Forja](https://github.com/forjajs/forja) required.

Not a "load the whole file into memory" JSON store. It's a genuine storage engine:
a `Pager` doing page-granular disk I/O (4096-byte pages, like SQLite), slotted
pages for variable-length records, overflow pages for oversized documents, and an
actual B+tree index for lookups and full scans.

## Status: v1, functionally complete, not battle-tested

This is a from-scratch storage engine built as a deep dive into how real databases
work under the hood — not a drop-in replacement for a production-grade embedded
database. It's fully tested (round-trips, forced splits, concurrent access,
tombstone deletion, overflow chains) and works correctly for everything it claims
to do. What it deliberately does **not** have yet:

- **No write-ahead log / crash recovery.** A crash mid-write can leave the file in
  an inconsistent state. `flush()` runs after every top-level operation, but
  that's best-effort durability, not ACID.
- **No multi-process locking.** The in-process `AsyncMutex` serializes every call
  within one Node process — it does nothing for two processes touching the same
  file.
- **No secondary indexes.** `findOne`/`scan` do a full leaf-chain traversal with
  an in-memory predicate filter. Fine for small/medium datasets, not built for
  large-scale querying.
- **No full B-tree rebalancing.** Deletes reclaim space via tombstone compaction
  and free completely-empty leaves, but never merge underfull neighboring pages.

If you need any of the above, reach for something mature (LevelDB, SQLite via
`better-sqlite3`, etc). This exists to be a real, understandable, hackable engine
— not to compete with them.

## Install

```bash
npm install @forjajs/json-driver
```

## Usage

```ts
import { openDatabase } from "@forjajs/json-driver";

const db = await openDatabase("./data/users.db");

await db.set("user-1", { name: "Ada", role: "admin" });

const user = await db.get("user-1"); // { name: "Ada", role: "admin" }
const exists = await db.has("user-1"); // true

const admins = await db.scan((doc) => doc.role === "admin");

await db.delete("user-1");
await db.close();
```

## API

```ts
interface JsonEngineOptions {
  pageSize?: number; // default 4096
}

interface JsonDatabase {
  get(id: string): Promise<Record<string, unknown> | null>;
  set(id: string, doc: Record<string, unknown>): Promise<void>; // upsert
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  scan(
    predicate?: (doc: Record<string, unknown>, id: string) => boolean,
  ): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}

function openDatabase(filePath: string, options?: JsonEngineOptions): Promise<JsonDatabase>;
```

Every call is serialized through an internal mutex — concurrent calls are safe
within one process, reads included.

## How it's built

See [`PLAN-json-engine.md`](https://github.com/forjajs/forja/blob/main/PLAN-json-engine.md)
in the main Forja repo for the full design: on-disk page format, B+tree cell
layout, the free-list, overflow chains, and the milestone-by-milestone build log.

## License

MIT
