# `@forjajs/json-driver` — a real, page-based B+tree JSON storage engine

## Addon philosophy: drivers are swappable, everything works standalone

Forja's core rule ("libre par défaut, équipé par choix") applies recursively: not
just Forja itself, but every addon, must be usable on its own — outside Forja,
and outside the other addons it's designed to pair with.

`@forjajs/orm` (existing empty scaffold at `packages/addon-orm/`) is **DB-agnostic**.
It only knows a small storage-driver contract (see `Repository<T>` /
`JsonEngineOptions`-shaped API below) — never a concrete storage implementation.
`@forjajs/json-driver` is the **first official driver**: a real page-based B+tree
engine, but it's just one interchangeable implementation. A future
`@forjajs/mysql-driver` or `@forjajs/postgres-driver` would plug into `@forjajs/orm`
the exact same way. This mirrors the `Hasher` contract / `auth.password.js`
pattern already used by `addon-auth`: the engine (`auth.engine.js`, or here
`@forjajs/orm`) depends only on a contract, never on bcrypt or a specific driver.

Concretely, this means three valid, independent ways to use this work once it
ships:
1. **`@forjajs/json-driver` alone** — any Node project can `openDatabase()`
   directly, with zero `@forjajs/orm` and zero Forja dependency at all.
2. **`@forjajs/orm` + `@forjajs/json-driver`** — the common Forja case, wired via
   `forja add orm` (or `forja add json-driver`, or both).
3. **`@forjajs/orm` + a different driver** (e.g. a future MySQL driver) — same
   `Repository<T>` contract, different backing store, `@forjajs/orm`'s own code
   never changes.

## Context

Forja's addon ecosystem (`packages/addon-orm/`, npm name `@forjajs/orm`) is currently an
empty scaffold. The README already commits Forja to shipping an in-house, multi-DB ORM,
and every addon in this repo follows strict dependency inversion: an engine depends only
on a **contract** from `@forjajs/core` (`Hasher`, `Repository`...), never on a concrete
implementation — see `auth.engine.js`, which knows only the `Hasher`/`Repository`
contracts, while the concrete bcrypt implementation lives isolated in `auth.password.js`.

Rather than a naive "load the whole JSON file into a `Map`" driver, the goal here is a
**real page-based storage engine** — a Pager doing page-granular disk I/O, slotted pages
for variable-length JSON records, overflow pages for oversized documents, and an actual
B+tree index for `id` lookup and ordered scans. This is deliberately more ambitious than
strictly necessary for Forja's use case; it's an explicit choice to build (and understand)
a real storage engine rather than reach for something like lowdb, which does no indexing
at all and would gain nothing from being wrapped.

Confirmed with the user: the engine must be **fully decoupled from Forja** — no dependency
on `@forjajs/core`, Express, or any Forja concept — so it's usable standalone by any Node
project, not just inside a Forja app. `@forjajs/orm` becomes a thin adapter on top, exposing
a `Repository<T>`-conforming implementation, mirroring exactly how `auth.engine.js`
depends on the `Hasher` contract while a separate file holds the concrete implementation.

`auth.route.js` already has a stub `users` repository object with a TODO pointing at this
exact future integration ("replace with the in-house ORM's users repository once
`@forjajs/orm` exists") — that's the concrete acceptance target, though wiring it in is
flagged as an optional stretch milestone (it requires making that file's composition root
async, out of scope for the core deliverable).

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Package split | New standalone package **`packages/addon-json-driver`** (`@forjajs/json-driver`), library-shaped (compiled TS, real `dist/`) | Contains real machinery (Pager, B+tree, overflow) that must not be copy-pasted per-project like `addon-auth`'s templates are; zero Forja dependency so it's usable outside Forja entirely. |
| Page size | **4096 bytes** | Matches common OS/filesystem block size; SQLite's modern default for the same problem. |
| fs API | **`fs.promises`**, page-granular reads/writes at explicit offsets — never whole-file reads | This runs inside Express request handlers; sync I/O would stall the event loop for every concurrent request. |
| Tree shape | **B+tree** (data only in leaves, leaves linked via right-sibling pointer) | Leaf-chain scan is O(leaf pages), not a recursive walk — matches the `scan()`/`findOne` requirement. |
| Keys | Always UTF-8 strings internally (`String(id)` at the ORM boundary) | Avoids a dual numeric/string comparator; v1 has no range-query requirement, only equality + full scan. |
| Deletion | **Tombstone**: intra-page compaction always; cross-page merge/rebalance only when a leaf becomes fully empty (unlink + free it) | Full B-tree rebalancing has ~6-8 bug-prone cases; not worth it without WAL/crash-recovery anyway. A `compact()` extension point is named for later, not built now. |
| Secondary indexes | **Deferred** — `findOne`/scan does a full leaf-chain traversal + in-memory predicate filter | Honest and simple; fine for Forja's realistic small/medium-project audience. Clean extension point later (a second per-field B+tree). |
| Concurrency | Single in-process **async mutex** serializing every public `JsonDatabase` call (reads included) | No WAL/MVCC, so concurrent read+write against the same pages is unsafe. Multi-process locking is explicitly out of scope. |
| Durability | `flush()` (write dirty pages + fsync) after each top-level operation and on `close()` — **not** per individual page write | Best-effort, not crash-atomic. True crash-safety needs a WAL — explicitly out of scope for v1, documented as a known limitation. |
| Test runner | **Vitest**, devDependency scoped to `packages/addon-json-driver/package.json` only | Zero-config TS/ESM support matching the repo's `Node16`/ES2022 tsconfig; no existing test precedent elsewhere in the monorepo's own packages to conform to or conflict with. There's no CI in this repo, so verification means running these tests locally. |
| `@forjajs/orm` → `@forjajs/json-driver` dependency type | Normal `dependencies`, not `peerDependencies` | Matches the repo convention: `peerDependencies` are for what copied *template* code directly `require()`s in a consumer project. `@forjajs/json-driver` is only used internally by `@forjajs/orm`'s own compiled code. |

## On-disk format

**Page 0 (database header, 4096 bytes, ~26 bytes meaningful):**
`magic` (8B, `"FRJAJSN1"`) · `pageSize` (2B) · `rootPage` (4B) · `freeListHead` (4B) ·
`pageCount` (4B) · `recordCount` (4B) · rest reserved/zero. Page id 0 is reserved; content
pages start at 1; `0` doubles as "null" for any pointer field.

**Common 16-byte page header** (every content page): `pageType` (1B: internal/leaf/
overflow) · `numCells` (2B) · `cellContentStart` (2B) · `typeSpecific` (4B: leaf =
right-sibling page id, internal = leftmost-child page id) · reserved.

**Slotted-page layout** (SQLite-style, inside the 4080 usable bytes): a sorted
cell-pointer array grows up from the header; cell content grows down from `PAGE_SIZE`;
`cellContentStart` tracks the boundary. Insert = binary-search sorted position, append
cell bytes at the low end, insert a pointer-array entry. Delete = remove the pointer
entry; freed content bytes become reusable free space for that page's own future
inserts (periodic in-page defrag consolidates fragmentation).

**Leaf cell** (variable length): `keyLen`(2B) · `key` · `totalPayloadLen`(4B) ·
`localPayloadLen`(4B) · `overflowPage`(4B, 0 = none) · `payload` (up to
`MAX_LOCAL_PAYLOAD_BYTES = 1024`, chosen so a leaf always holds ≥3 cells even at max
non-overflowing size). `MAX_KEY_LENGTH_BYTES = 512` (a `crypto.randomUUID()` id is 36
chars, far under this).

**Internal cell**: `keyLen`(2B) · `key` (separator, a copy of some leaf key) ·
`rightChildPage`(4B). The node's leftmost child lives in the common header's
`typeSpecific` field, so N cells represent N+1 children. Branching factor is
byte-driven (not a fixed textbook order) — with ~36-byte UUID keys, ≈88 children per
internal node, so height 3 already addresses ~88³ ≈ 681K leaf pages.

**Overflow page** (`pageType = 0x03`): `nextOverflowPage`(4B, 0 = last) ·
`validBytes`(4B) · up to 4084 bytes of raw payload, chained.

## Module layout

```
packages/addon-json-driver/                    # NEW package, zero Forja dependency
  package.json  tsconfig.json
  src/
    constants.ts     # PAGE_SIZE, header offsets, page-type tags, size limits
    header.ts        # DatabaseHeader parse/serialize (page 0)
    pager.ts         # fd I/O, page cache (bounded Map, insertion-order LRU),
                      # free-list alloc/free (linked through freed pages' own bytes)
    slottedPage.ts    # generic, page-type-agnostic cell insert/delete/compact
    mutex.ts           # tiny AsyncMutex (promise-chain queue)
    database.ts         # wires Pager + BTree + Mutex behind openDatabase()
    btree/
      leaf.ts             # leaf cell encode/decode, insert/split/delete
      internal.ts          # internal cell encode/decode, insert/split
      overflow.ts           # overflow chain write/read/free
      btree.ts                # search/insert/delete/scan orchestration, root growth
    index.ts                  # public API surface (below)
  test/                        # sibling to src/, run directly by Vitest (no precompile)
    pager.test.ts  slottedPage.test.ts  btree.test.ts  overflow.test.ts  database.test.ts

packages/addon-orm/                      # EXISTING, modified
  package.json      # + "files": ["dist","templates"], + dependencies.@forjajs/json-driver
  src/
    index.ts             # was `export {}` → re-exports createJsonRepository
    jsonRepository.ts     # NEW: createJsonRepository<T>(filePath): Promise<Repository<T>>
  templates/                # NEW directory
    orm.repository.js        # composition-root example, mirrors auth.route.js's wiring

tsconfig.json (root)   # + { "path": "packages/addon-json-driver" } in references array
```

Public engine API (`packages/addon-json-driver/src/index.ts`):

```ts
export interface JsonEngineOptions { pageSize?: number; maxCachedPages?: number; }
export interface JsonDatabase {
  get(id: string): Promise<Record<string, unknown> | null>;
  set(id: string, doc: Record<string, unknown>): Promise<void>;   // upsert
  has(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
  scan(predicate?: (doc, id) => boolean): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}
export function openDatabase(filePath: string, options?: JsonEngineOptions): Promise<JsonDatabase>;
```

`@forjajs/orm`'s adapter (`jsonRepository.ts`) wraps `openDatabase()` and implements
`Repository<T>` from `packages/core/src/contracts/repository.ts`
(`findById`/`findOne`/`create`/`update`/`delete`), validated at construction via
`contracts.assertImplements("Repository", repository, contracts.REPOSITORY_METHODS)` —
the same pattern `auth.engine.js` uses. `findOne(criteria)` maps onto `db.scan()` with an
in-memory partial-match predicate. Each "collection" = one engine file (e.g.
`data/users.json-driver`); the engine itself has no concept of collections.

## Build order (each milestone independently testable before the next depends on it)

1. **Scaffolding** — new package skeleton, root `tsconfig.json` reference added, confirm `tsc -b` builds clean.
2. **Pager + header** — page cache, read/write/flush/close, linear growth only (no free-list yet). Test: round-trip write→close→reopen→read; corrupted-magic-bytes rejection.
3. **Free-list** — `allocatePage`/`freePage`. Test: freed ids get reused, `pageCount` doesn't grow while free-list has capacity.
4. **Slotted-page primitives** — generic cell insert/delete/compact on a raw `Buffer`, tested in isolation before any tree logic touches it (byte-manipulation bugs are far easier to catch here than through a tree-traversal failure).
5. **Single-leaf tree** — search/insert/delete correct only while everything fits in one leaf. Intentionally incomplete but independently testable.
6. **Overflow pages** — wired into leaf cell read/write. Test: payload exactly at the threshold, one page over, and a multi-hop chain — byte-identical reassembly in all three.
7. **Real B+tree** — leaf split, internal nodes, cascading split-on-insert, root growth. Test: forced splits at various fill levels (using a small test-only page size), including a root split growing tree height; every previously-inserted key still findable after each split.
8. **Tombstone delete** — intra-page compaction + empty-leaf reclamation. Test: delete-then-reinsert reuses freed pages; remaining keys still found via both `get()` and `scan()` at sub-50% occupancy.
9. **Public API** — `database.ts` + `mutex.ts` + `openDatabase()`. Test: `scan()` predicate filtering in key order; N concurrent read-modify-write ops against one field settle to exactly N (proves the mutex actually serializes — the single most important concurrency test).
10. **`@forjajs/orm` adapter** — `createJsonRepository`, `templates/orm.repository.js`, `package.json` changes.
11. *(Stretch, optional)* — wire `createJsonRepository` into `auth.route.js` in place of the stub, replacing the TODO comment. Requires making that file's composition root async-bootstrap-aware; not required for this plan's core deliverable.

## Verification

- `npm run test -w @forjajs/json-driver` (Vitest) after each milestone — no CI exists in this repo, so this is the actual gate.
- `tsc -b` at the repo root after milestones 1 and 10, to confirm the new package's project-reference wiring and `@forjajs/orm`'s updated `src/index.ts` both compile cleanly across the whole graph.
- End-to-end smoke check after milestone 10: a small script that `createJsonRepository`s a temp file, `create`s a few records, `findById`/`findOne`s them back, `update`s and `delete`s one, then reopens the same file path in a fresh process and confirms the surviving records read back correctly.

## Milestone 12+ — `forja orm` CLI: model, migration, seed, multi-env

Revision after milestone 10/11 design review: a repository (`Repository<T>`) alone is not
an ORM — an ORM maps objects to a **declared schema**. Without a schema there's nothing to
map, just a generic CRUD wrapper (which is what `createRepositoryFromStore` already is).
This milestone adds the schema layer and the CLI surface on top of it, plus the classic
three-environment split (dev/test/prod) so tests never touch dev or prod data.

Architecture:

- **`orm.config.js`** (generated at `features/orm/orm.config.js` by `forja add orm`) —
  maps `development` / `test` / `production` to a driver + storage path. Selected via
  `process.env.NODE_ENV` (defaults to `development`). Each env gets its own data files —
  `data/dev/`, `data/test/`, `data/prod/` — never shared, so running tests (TI) can never
  corrupt dev or prod data.
- **Model** (`defineModel`, new export in `@forjajs/orm/src/`) — wraps an `OrmRepository<T>`
  (from `createRepositoryFromStore` or any driver's own `Repository<T>`) with a declared
  field schema (`{ field: { type, required } }`), validated on `create`/`update` before the
  underlying driver ever sees the write. This is what actually earns the name "ORM."
  `forja orm new <Name>` scaffolds `features/orm/models/<name>.model.js` wiring this up for
  the project's chosen driver + current env.
- **Migration** — even though `json-driver` is schemaless (no `ALTER TABLE`), a migration
  here is a versioned transform script (`up(repository)` / `down(repository)`) applied to
  already-written documents (e.g. backfilling a new field's default, renaming a field).
  Applied migrations are tracked in a driver-native file (`data/<env>/_migrations.json-driver`)
  so `forja orm migrate` only runs what's pending. `forja orm make:migration <name>` scaffolds
  a new migration file.
- **Seed** — `features/orm/seeds/<name>.seed.js` (`async function seed() { await Model.create(...) }`).
  `forja orm make:seed <name>` scaffolds one, `forja orm seed` runs all seeds for the current env.
- **CLI surface** — new commands under `packages/cli/src/commands/orm/`: `new.ts`,
  `migrate.ts`, `seed.ts`, `make/migration.ts`, `make/seed.ts`. Each reads `orm.config.js`
  from the consumer project to resolve the active environment, mirroring how `add.ts`
  already resolves `forjaDrivers` from the addon's own `package.json`.

Build order:

12. **`defineModel` + schema validation** in `@forjajs/orm/src/` — unit-tested with Vitest
    alongside `createRepositoryFromStore`/`HyperLogLog`.
13. **`orm.config.js` template + env resolution** — `forja add orm` generates it; driver
    templates read the active env's path instead of a hardcoded file path.
14. **`forja orm new <Name>`** — scaffolds a model file for the addon's active driver.
15. **`forja orm make:migration` / `forja orm migrate`** — migration file scaffold + runner
    with a tracked-applied-migrations file.
16. **`forja orm make:seed` / `forja orm seed`** — seed file scaffold + runner.

## Critical files

- `packages/core/src/contracts/repository.ts` — the contract the adapter must satisfy exactly.
- `packages/addon-auth/templates/auth.engine.js` / `auth.password.js` — the DIP pattern being replicated (contract-only engine vs. isolated concrete implementation).
- `packages/addon-auth/templates/auth.route.js` — the stretch-milestone integration target (`users` stub + TODO).
- `packages/addon-orm/package.json`, `packages/addon-orm/src/index.ts` — existing empty scaffold to fill in.
- `packages/cli/src/commands/add.ts` — `forja add orm` currently warns-and-returns because `packages/addon-orm/templates/` doesn't exist; creating it makes this command actually scaffold.
- `tsconfig.json` (root) — needs the new package added to `references`.
