# @forjajs/orm

Forja's in-house, multi-driver ORM. A real object/document mapper — declared field
schemas, type-safe `create()`/`update()`/`findOne()` inferred straight from your
schema (no hand-written TS interfaces, same ergonomics as Zod's `z.infer`),
relations, migrations, seeds — built on a deliberately small, **open** driver
contract instead of a fixed list of dialects.

This document has two halves, because `@forjajs/orm` genuinely works both ways:

- **[Part 1 — Inside a Forja project](#part-1--inside-a-forja-project)**: you scaffold
  with `forja new` / `forja add orm`, the CLI wires everything, you mostly just
  declare schemas and call methods.
- **[Part 2 — Standalone, no Forja](#part-2--standalone-no-forja)**: you `npm install
  @forjajs/orm` directly in any Node.js project, wire it up by hand, no CLI, no
  `features/` convention, nothing Forja-specific required.

Both halves use the exact same package, the exact same functions, the exact same
guarantees. Part 1 is Part 2 with the boilerplate generated for you.

---

## Why this exists, and how it's different

Most ORMs (Sequelize, TypeORM, Prisma...) ship a **fixed set of dialects** baked
into the package itself — MySQL, Postgres, SQLite, MSSQL — maintained by the ORM's
own team, inside the ORM's own repo. You can't add a new one without forking the
project.

`@forjajs/orm` ships with **one official driver** (`@forjajs/json-driver`, a real
page-based B+tree storage engine, see its own README), but the *mechanism* for
plugging in a driver is public and open. Anyone — you, a third party, a future
Forja package — can write an adapter for any storage backend and use it with the
exact same `defineModel()`, the exact same generated `create()`/`findOne()`/
`update()`/`delete()`, the exact same migrations/seeds tooling. Nothing in
`@forjajs/orm` needs to know your driver exists.

This works because of one architectural rule, applied consistently everywhere in
Forja (the same pattern backs `Hasher`/bcrypt in `@forjajs/addon-auth`):

> **`@forjajs/orm` depends on a *contract*, never on a concrete driver.**

The contract is `Repository<T>` (from `@forjajs/contracts`):

```ts
interface Repository<T> {
  findById(id: string | number): Promise<T | null>;
  findOne(criteria: Partial<T>): Promise<T | null>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>): Promise<T>;
  delete(id: string | number): Promise<void>;
}
```

`@forjajs/orm`'s own `package.json` has **zero dependency** on `@forjajs/json-driver`
or any other driver — not in `dependencies`, not in `peerDependencies`. Installing
`@forjajs/orm` never forces a specific storage engine onto your project. You (or
the CLI, on your behalf) choose exactly one driver, install exactly that one, and
nothing else.

---

# Part 1 — Inside a Forja project

## 1.1 Getting it wired in

**Option A — at project creation.** `forja new my-app` asks, among its other
stack questions:

```
? Add the ORM addon (@forjajs/orm)? (y/N)
? Which storage driver? json-driver (@forjajs/json-driver)
```

Say yes, and the generated project already has `@forjajs/orm` + the chosen driver
installed, `features/orm/` wired up, **and** — because a brand-new project has
nothing to conflict with — a full working example: a `User` model plus (if you
picked a server-rendered view engine: Pug for now) real `/register` and `/login`
routes with HTML forms, proving the whole stack end to end. Delete it, keep it,
build on it — it's yours the moment it's generated, like every other file Forja
gives you.

**Option B — on a project you already built.** Needed a database halfway through?

```sh
forja add orm --driver=json-driver
```

This **only** wires the driver and its config — no assumptions, no demo `User`
model, no register/login example, because you've likely already got your own
routes, your own naming, your own idea of what your first model should be called.
It won't guess. If you *do* want the starter example on an existing project too,
opt in explicitly:

```sh
forja add orm --driver=json-driver --example
```

Either way, `forja add <preset>` never runs a blanket `npm install` — it installs
*exactly* the packages it just added to your `package.json` (`@forjajs/orm`,
`@forjajs/contracts`, and the chosen driver package), nothing else in your project
gets touched.

Both entry points — `forja new`'s inline prompt and the standalone `forja add orm`
— go through the exact same code path internally, so behavior never drifts between
"chosen at creation" and "added later." If you've already fully customized
`features/auth-example/` or `views/register.pug` and run `forja add orm --example`
again for some reason, existing files are detected and left untouched (a warning
is printed instead of a silent overwrite) — nothing you've written is ever
clobbered.

## 1.2 What `forja add orm` actually writes

```
features/orm/
  orm.config.js                             # per-environment storage paths (dev/test/prod)
  orm.@forjajs-json-driver-repository.js     # the driver adapter — see 1.3
  models/                                    # created on demand, by forja orm new / --example
  migrations/                                # created on demand, by forja orm make migration
  seeds/                                     # created on demand, by forja orm make seed
```

Plus, in your project's `package.json`:

```json
{
  "dependencies": {
    "@forjajs/orm": "*",
    "@forjajs/contracts": "*",
    "@forjajs/json-driver": "*"
  }
}
```

`@forjajs/contracts` is there because it's a `peerDependency` of `@forjajs/orm` —
it's the zero-dependency package that owns the `Repository` contract type and
`assertImplements`, shared by every addon (HTTP-based or not) without pulling in
`@forjajs/core`'s Express-specific registry too. The CLI always adds peer
dependencies alongside the addon itself. `@forjajs/json-driver` is there because
*you* chose it as your driver — swap `--driver` for a future driver and this line
changes, the first two never do.

## 1.3 The generated driver adapter

`features/orm/orm.@forjajs-json-driver-repository.js`:

```js
const { openDatabase } = require("@forjajs/json-driver");
const { createRepositoryFromStore } = require("@forjajs/orm");

module.exports = async function createJsonRepository(filePath) {
  const db = await openDatabase(filePath);
  return createRepositoryFromStore(db);
};
```

This file is **yours** — it's copied into your project, not imported from
`node_modules`. Nothing else in Forja depends on its exact name or shape beyond
"exports an async function taking a file path, returning a `Repository`-shaped
object." Swap it for a hand-written adapter to a different driver at any time
without touching `@forjajs/orm` itself or any of your models — same pattern as
`auth.password.js` swapping bcrypt for argon2 without touching `auth.engine.js`.

`createRepositoryFromStore` (exported by `@forjajs/orm`, see [2.3](#23-createrepositoryfromstore-the-generic-engine))
is the reusable, driver-agnostic engine underneath: it implements
`findById`/`findOne`/`create`/`update`/`delete` (plus `findAll`/`countDistinct`)
once, given only a minimal `get`/`set`/`delete`/`scan` primitive shape — which
`json-driver`'s `openDatabase()` already happens to satisfy exactly, so the
adapter above is only a few lines.

## 1.4 Environments: `orm.config.js`

```js
// features/orm/orm.config.js
module.exports = {
  development: { path: "data/dev" },
  test:        { path: "data/test" },
  production:  { path: "data/prod" },
};
```

`resolveEnv(config)` (exported by `@forjajs/orm`) picks the active entry by
`process.env.NODE_ENV` (defaults to `"development"` if unset — a plain `node
index.js` during local dev never accidentally touches `test` or `production`
data), and **creates the directory if it doesn't exist yet** — every model file
calls it, so the very first `npm start` on a fresh clone just works, no manual
`mkdir data` step, regardless of which driver you're using (this lives here, in
`@forjajs/orm` itself, once — not duplicated per driver adapter).

Add more environments, rename the paths, point a given env somewhere outside the
project entirely — it's a plain object you own.

## 1.5 Declaring a model: `forja orm new`

```sh
forja orm new User
```

Detects which driver you already wired in (by matching the adapter file present
under `features/orm/`), and writes `features/orm/models/user.model.js`:

```js
const { defineModel, resolveEnv } = require("@forjajs/orm");
const createRepository = require("../orm.@forjajs-json-driver-repository.js");
const config = require("../orm.config.js");

const env = resolveEnv(config);

module.exports = (async () => {
  const repository = await createRepository(`${env.path}/user.json-driver`);
  return defineModel("User", {
    fields: {
      id: { type: "string", unique: true },
      // name: { type: "string", required: true },
    },
  }, repository);
})();
```

Declare your real fields in place of the commented-out example — see
[2.4](#24-schema-reference) for every field shape (`string`/`number`/`boolean`,
nested `object`, `relation`, `unique`, `required`). The `id` field is always
there, always `unique: true` — every document's `id` is the underlying store's own
key, so a duplicate is structurally impossible, and having it declared like any
other field means it validates the same way and shows up in editor autocomplete
instead of being an invisible, undocumented special case.

### The one wrinkle: model creation is `async`

`createRepository(filePath)` is `async` (it opens a real file), so the whole
`defineModel(...)` composition has to be awaited — that's why the model file's
`module.exports` is an **async IIFE**, i.e. `module.exports` is a `Promise`, not
the model itself:

```js
// ❌ WRONG — CommonJS can't top-level await, and even if it could, `User` here
// would be a Promise, not the model — `User.findOne` doesn't exist yet.
const User = await require("./models/user.model.js");

// ✅ Right — await it wherever you actually use it (inside an async route
// handler, for instance):
router.get("/", async (req, res) => {
  const User = await require("../orm/models/user.model.js");
  const user = await User.findOne({ email: "admin@example.com" });
  res.render("home", { user });
});
```

A common, slightly more efficient pattern: `require()` the Promise once at the
top of the route file (module-level, `require()` is cached, cheap to call again),
then `await` that same Promise inside each handler:

```js
const userModel = require("../orm/models/user.model.js"); // a Promise, not the model
router.get("/", async (req, res) => {
  const User = await userModel; // resolves once, then instantly on every later call
  const user = await User.findOne({ email: "..." });
});
```

## 1.6 Using the model

```js
await User.create({ email: "a@a.com", name: "Alice" });
// → { id: "generated-uuid", email: "a@a.com", name: "Alice" }

await User.findById("generated-uuid");
await User.findOne({ email: "a@a.com" });
await User.update("generated-uuid", { name: "Alicia" });
await User.delete("generated-uuid");

await User.findAll();                              // every document
await User.findAll((doc) => doc.age > 18);          // filtered, in-process
await User.countDistinct("country");                // approximate, HyperLogLog-backed
```

Every field you declared `required: true` must be present on `create()` — not on
`update()`, since `update()` takes a *partial* patch and only validates the
fields you actually pass. Every field you declared `unique: true` (including the
implicit `id`) is checked against every other document before the write goes
through; a collision throws before the driver ever sees it.

Passing an undeclared field, or a field of the wrong type, throws immediately —
`"User" validation failed: "age" must be a number, got string`.

## 1.7 Migrations

`json-driver` is schemaless — there's no `ALTER TABLE` to run, because a document
can already have any shape. A "migration" here means something narrower but still
genuinely useful: a versioned script that **transforms already-written
documents** — backfilling a new field's default, renaming a field, reshaping a
nested object — applied once, tracked, never re-applied.

```sh
forja orm make migration add_country_to_user
```

writes `features/orm/migrations/0001_add_country_to_user.js`:

```js
module.exports = {
  async up(ctx) {
    const users = await ctx.openRepository("user");
    const docs = await users.findAll();
    for (const doc of docs) {
      await users.update(doc.id, { ...doc, country: "unknown" });
    }
  },
  async down(ctx) {
    // reverse the change made in up()
  },
};
```

`ctx.openRepository(name)` opens any collection by name, using whichever driver
is already wired in — a migration can touch several collections in one file if
it needs to.

```sh
forja orm migrate
```

Runs every migration file under `features/orm/migrations/` in filename order
(hence the numeric prefix), skipping any already applied. "Already applied" is
tracked in its own collection, `_migrations`, stored via the same driver, in the
current environment's data directory — so `test` and `development` track their
applied migrations completely separately, same as their actual data.

## 1.8 Seeds

Seeds populate fixture/demo data — no state tracking, no "already applied"
concept, they just run.

```sh
forja orm make seed user            # --count 5 by default
forja orm make seed user --count 20
```

requires a model to already exist (`forja orm new user` first) and writes
`features/orm/seeds/0001_user.seed.js`:

```js
const { fakeFromSchema } = require("@forjajs/orm");

module.exports = async function seed() {
  const user = await require("../models/user.model.js");
  for (let i = 0; i < 5; i++) {
    await user.create(await fakeFromSchema(user.schema));
  }
};
```

`fakeFromSchema` (see [2.5](#25-fakefromschema-auto-generated-fixtures)) reads the
model's own declared schema and generates a value of the right shape for every
field — strings, numbers, booleans, recursively for nested objects. You never
hand-write fixture data.

If the model has a `relation` field, the generated seed also includes a
`resolveRelation` function: it loads the related model, reads its existing
records (`findAll()`), and picks one at random (or 1–3 for `hasMany`) — which
means **the related model must be seeded first**. Seed files are numbered like
migrations specifically so you can control this: rename the numeric prefix to
reorder `0001_user.seed.js` before `0002_post.seed.js` if `Post` has a `relation`
to `User`.

```sh
forja orm seed
```

Runs every `*.seed.js` file under `features/orm/seeds/`, in filename order, for
whichever `NODE_ENV` is active — point it at `test` for CI/TI fixtures, at
`development` for local demo data. Never run it against `production` unless you
genuinely mean to seed production data.

## 1.9 Full CLI reference

| Command | What it does |
|---|---|
| `forja add orm --driver=<name> [--example]` | Wires the chosen driver + `orm.config.js` into an existing project. `--example` also generates a starter `User` model (+ register/login if a Pug view engine is configured). |
| `forja orm new <Name>` | Scaffolds `models/<name>.model.js`, wired to whichever driver is already present. |
| `forja orm make migration <name>` | Scaffolds a numbered migration file. |
| `forja orm migrate` | Applies every pending migration for the active `NODE_ENV`. |
| `forja orm make seed <name> [--count N]` | Scaffolds a numbered seed file, auto-filled from `<name>`'s model schema (default `N`: 5). |
| `forja orm seed` | Runs every seed file for the active `NODE_ENV`. |

## 1.10 Worked example: a tiny blog, end to end

Two related models, a migration, seeds, relation-aware fixtures — the pieces from
above, put together into something you'd actually build. Assumes `forja add orm
--driver=json-driver` already ran.

### Models

```sh
forja orm new User
forja orm new Post
```

`features/orm/models/user.model.js` — fill in the commented example:

```js
return defineModel("User", {
  fields: {
    id: { type: "string", unique: true },
    email: { type: "string", required: true, unique: true },
    displayName: { type: "string", required: true },
  },
}, repository);
```

`features/orm/models/post.model.js`:

```js
return defineModel("Post", {
  fields: {
    id: { type: "string", unique: true },
    title: { type: "string", required: true },
    body: { type: "string", required: true },
    published: { type: "boolean", required: true },
    authorId: { type: "relation", relation: { model: "User", kind: "belongsTo" } },
  },
}, repository);
```

### A route using both

```js
// features/blog/blog.route.js
const router = require("express").Router();
const userModel = require("../orm/models/user.model.js");
const postModel = require("../orm/models/post.model.js");

router.get("/posts", async (req, res) => {
  const Post = await postModel;
  const posts = await Post.findAll((post) => post.published);
  res.json(posts);
});

router.post("/posts", async (req, res) => {
  const User = await userModel;
  const Post = await postModel;

  const author = await User.findOne({ email: req.body.authorEmail });
  if (!author) return res.status(404).json({ error: "Unknown author" });

  const post = await Post.create({
    title: req.body.title,
    body: req.body.body,
    published: false,
    authorId: author.id,
  });
  res.status(201).json(post);
});

module.exports = router;
```

### A migration: giving every existing post a `publishedAt`

Say `Post` later grows a `publishedAt` field, and every post created before this
change needs a sensible default:

```sh
forja orm make migration add_published_at_to_post
```

`features/orm/migrations/0001_add_published_at_to_post.js`:

```js
module.exports = {
  async up(ctx) {
    const posts = await ctx.openRepository("post");
    const docs = await posts.findAll();
    for (const doc of docs) {
      await posts.update(doc.id, { ...doc, publishedAt: doc.published ? new Date(0).toISOString() : null });
    }
  },
  async down(ctx) {
    const posts = await ctx.openRepository("post");
    const docs = await posts.findAll();
    for (const doc of docs) {
      const { publishedAt, ...rest } = doc;
      await posts.update(doc.id, rest);
    }
  },
};
```

```sh
forja orm migrate
```

Also add `publishedAt: { type: "string", required: false }` to `Post`'s schema in
`post.model.js` itself — the migration backfills *existing* documents, the schema
change is what makes the field validated (and offered by autocomplete) going
forward. They're two separate, deliberate steps; a migration never rewrites your
model file for you.

### Seeds, in dependency order

`Post.authorId` is a `relation` to `User` — `User` must be seeded first, so
generate seeds in that order (the numeric prefix reflects it automatically,
since each `forja orm make seed` call just picks the next number):

```sh
forja orm make seed user --count 3
forja orm make seed post --count 10
```

```sh
forja orm seed
```

produces, in order: `0001_user.seed.js` runs first (3 fake users, no
dependencies), then `0002_post.seed.js` (10 fake posts, each with a real
`authorId` picked at random from the 3 users just created via
`resolveRelation` — see [1.8](#18-seeds)). Run it again on a fresh `data/test/`
directory (`NODE_ENV=test forja orm seed`) to get deterministic-shaped, if not
deterministic-valued, fixtures for integration tests.

---

# Part 2 — Standalone, no Forja

Everything below works in **any** Node.js project — a plain Express app, a CLI
tool, a background worker, nothing Forja-flavored required. `@forjajs/orm` has no
runtime dependency on the rest of the Forja ecosystem beyond `@forjajs/contracts`
(for the `Repository` contract type and `assertImplements` — a genuinely tiny,
zero-dependency package, not `@forjajs/core`: no Express, no HTTP anything).

## 2.1 Install

```sh
npm install @forjajs/orm @forjajs/json-driver
```

(or whichever driver you're using instead of `json-driver` — `@forjajs/orm`
itself never pulls one in for you, by design, see [Why this exists](#why-this-exists-and-how-its-different)).

## 2.2 The three-line minimum

```js
const { openDatabase } = require("@forjajs/json-driver");
const { createRepositoryFromStore, defineModel } = require("@forjajs/orm");

async function main() {
  const db = await openDatabase("./data/users.json-driver");
  const repository = createRepositoryFromStore(db);

  const User = defineModel("User", {
    fields: {
      email: { type: "string", required: true, unique: true },
      name: { type: "string", required: true },
    },
  }, repository);

  const alice = await User.create({ email: "a@a.com", name: "Alice" });
  console.log(await User.findOne({ email: "a@a.com" }));
}

main();
```

No `features/` directory, no `orm.config.js`, no CLI. `resolveEnv` is entirely
optional — call `openDatabase()` with whatever path you want, computed however
you want (an env var, a CLI flag, a hardcoded string for a quick script).

## 2.3 `createRepositoryFromStore`: the generic engine

```ts
function createRepositoryFromStore<T extends Record<string, unknown>>(
  store: Store<T>,
): OrmRepository<T>;

interface Store<T> {
  get(id: string): Promise<T | null>;
  set(id: string, doc: T): Promise<void>;
  delete(id: string): Promise<void>;
  scan(predicate?: (doc: T) => boolean): Promise<T[]>;
}
```

This is the actual `findById`/`findOne`/`create`/`update`/`delete` logic,
written once, working against any object that exposes those four primitives.
`json-driver`'s `openDatabase()` return value already has exactly this shape
(plus `has()` and `close()`, which `Store` doesn't need and ignores) — that's why
the driver adapter is trivial. If you write your own driver on top of, say,
`better-sqlite3`, and it's naturally KV-shaped (a table keyed by `id`, no real
`WHERE` support you want to leverage), you can implement `Store<T>` around it and
get the same generic engine for free.

`OrmRepository<T>` extends the base `Repository<T>` contract with two more
methods, used by migrations/seeds and generally useful on their own:

```ts
interface OrmRepository<T> extends Repository<T> {
  findAll(predicate?: (doc: T) => boolean): Promise<T[]>;
  countDistinct(field: keyof T): Promise<number>; // HyperLogLog-backed estimate
}
```

**When *not* to use `createRepositoryFromStore`**: if your driver has real query
capabilities you want to actually use — a SQL `WHERE` clause instead of
client-side filtering over a full table scan — don't force it through the
`get`/`set`/`scan` shape. Implement `Repository<T>` yourself, by hand, using your
driver's real primitives for `findOne`. The *contract* (the five-method shape) is
what every driver must satisfy; the *implementation* backing it is free to be
whatever's actually efficient for that driver. `createRepositoryFromStore` is a
convenience for KV-shaped stores, not a requirement.

## 2.4 Schema reference

```ts
interface ModelSchema {
  fields: Record<string, FieldSchema>;
}

interface FieldSchema {
  type: "string" | "number" | "boolean" | "object" | "relation";
  required?: boolean;   // enforced on create(), not on update() (which is a partial patch)
  unique?: boolean;      // checked via findOne() before every create()/update()
  fields?: Record<string, FieldSchema>;   // only for type: "object" — a nested, defined structure
  relation?: { model: string; kind: "belongsTo" | "hasMany" };  // only for type: "relation"
}
```

**Primitives** — `string`, `number`, `boolean`: checked with `typeof`.

**`object`** — a genuinely nested, *defined* structure (not a free-form blob):

```js
fields: {
  address: {
    type: "object",
    fields: {
      city: { type: "string", required: true },
      zip: { type: "string" },
    },
  },
}
```

validated recursively (error messages trace the full path, e.g.
`"address.city" is required`), and generated recursively by `fakeFromSchema`.

**`relation`** — a reference to another model, by name. `belongsTo` stores one id
(a plain string); `hasMany` stores an array of ids:

```js
fields: {
  authorId: { type: "relation", relation: { model: "User", kind: "belongsTo" } },
  tagIds:   { type: "relation", relation: { model: "Tag", kind: "hasMany" } },
}
```

Validated as an id / array of ids — `@forjajs/orm` does **not** enforce
referential integrity (it never checks the referenced id actually exists on
`create()`/`update()`), by design: enforcing that would mean every driver's
generic path needs to query a *different* collection mid-write, which stops being
a cheap, driver-agnostic operation. If you need that guarantee, add it in your
own composition (a wrapper function, or a migration-time check).

**`unique`** — works on any field, at any depth of the top level (not inside
nested `object` fields — only declared at the top of `fields`). Before a
`create()`/`update()` write goes through, `defineModel` calls
`repository.findOne({ [field]: value })`; if a match exists (and, on `update()`,
it isn't the very document being updated), the write is rejected with a clear
error instead of silently producing a duplicate.

**`id`** is implicit — every model gets `id: { type: "string", unique: true }`
merged in automatically at validation time, purely internally: `Model.schema`
itself still exposes exactly the schema *you* passed to `defineModel`, not the
merged one. You never need to declare `id` yourself for it to be enforced — the
CLI's generated model files declare it anyway (see [1.5](#15-declaring-a-model-forja-orm-new)),
purely so it shows
up in your own file and in editor autocomplete instead of being an invisible rule
you have to remember.

### Type inference — no hand-written interface

```ts
const User = defineModel("User", {
  fields: {
    email: { type: "string", required: true },
    age: { type: "number" },
  },
}, repository);

// TypeScript already knows:
//   User.create(data: { email: string; age?: number })       — age optional
//   User.findOne(criteria: Partial<{ id: string; email: string; age: number }>)
// Full autocomplete on every field name and type, straight from the object
// literal you just wrote — the exact same ergonomics as Zod's `z.infer`.
```

This works because `defineModel`'s schema parameter is a TypeScript `const` type
parameter — the literal shape of the object you write is preserved and fed
through a set of mapped/conditional types (`InferSchema<S>`) to produce the
document type. No manual `interface User { ... }` to keep in sync with the schema
ever again.

## 2.5 `fakeFromSchema`: auto-generated fixtures

```ts
function fakeFromSchema<T>(
  schema: ModelSchema,
  resolveRelation?: (field: string, relation: RelationSchema) => Promise<unknown>,
): Promise<T>;
```

Generates one document with a random, correctly-typed value for every declared
field — strings (with a light email-shaped heuristic when the field name
contains `"email"`), numbers, booleans, recursively for nested `object` fields.
`relation` fields need a `resolveRelation` callback (there's no generic way to
pick "a valid related id" without knowing where the related records live) — omit
it and a `relation` field throws instead of silently writing garbage. This is
exactly what the CLI's generated seed files wire up for you (see
[1.8](#18-seeds)); calling it directly, you provide your own resolver, or skip it
entirely for schemas with no relations.

## 2.6 `resolveEnv`: optional, not required

```ts
function resolveEnv(config: Record<string, { path: string }>): { path: string };
```

Purely a convenience for picking a storage directory by `NODE_ENV` and ensuring
it exists — entirely optional outside a Forja project. Skip it and just compute
your own path however fits your project (an env var read directly, a CLI flag, a
constant). It has no dependency on anything else in `@forjajs/orm` and can be
used on its own even if you don't touch `defineModel` at all.

## 2.7 `HyperLogLog`: also usable standalone

```ts
import { HyperLogLog, createHyperLogLog } from "@forjajs/orm";

const hll = new HyperLogLog(); // precision 14 by default: 16384 registers, ~0.8% typical error
hll.add("some-value");
hll.add("some-value");        // adding the same value again doesn't inflate the count
hll.count();                  // → approximate number of *distinct* values added

const merged = hllA.merge(hllB); // union of two independently-tracked sets — must share the same precision
```

A standard dense-register HyperLogLog (Flajolet et al.), with a MurmurHash3
finalizer mixed in after the FNV-1a hash — needed because FNV-1a alone has weak
avalanche on its high bits for short/sequential inputs, which biases the register
index and skews every estimate without it (this was caught and fixed during
development: an unmixed hash produced ~11% error against a true ~0.8% expected).
`countDistinct(field)` on any `OrmRepository` is built directly on this, so a
large collection's cardinality can be estimated without holding every distinct
value in memory.

## 2.8 Writing your own driver

The entire surface a driver adapter needs to satisfy is the `Repository<T>`
contract — five methods, four of which can usually be trivial wrappers:

```js
const contracts = require("@forjajs/contracts");

async function createMyDriverRepository(connectionString) {
  const client = await myDriverLibrary.connect(connectionString);

  const repository = {
    async findById(id) {
      /* your driver's real "get by id" */
    },
    async findOne(criteria) {
      /* your driver's real query — e.g. an actual SQL WHERE, not a full scan */
    },
    async create(data) {
      /* insert, return the created doc including its id */
    },
    async update(id, data) {
      /* patch, return the updated doc */
    },
    async delete(id) {
      /* delete by id */
    },
  };

  contracts.assertImplements("Repository", repository, contracts.REPOSITORY_METHODS);
  return repository;
}

module.exports = createMyDriverRepository;
```

`contracts.assertImplements` is optional but recommended — it's a runtime guard
(TypeScript interfaces don't exist at runtime) that throws immediately, with a
clear message naming every missing method, instead of failing later with a
confusing "undefined is not a function" three calls deep into a request. It's the
same guard `createRepositoryFromStore` itself uses internally.

Whatever you return from this function — as long as it has the five methods —
plugs directly into `defineModel(name, schema, repository)` exactly like the
official `json-driver` adapter does. `defineModel` never imports, requires, or
knows about any specific driver package; it only calls the five methods on
whatever `Repository`-shaped object you hand it.

## 2.9 Reference adapters for popular databases

None of these ship with `@forjajs/orm` — they're not official Forja packages,
just worked, correct examples proving the contract is genuinely open. Copy one,
adapt it, `npm install` whichever driver library it needs (never added to
`@forjajs/orm`'s own `dependencies`, same rule as [`json-driver`](#why-this-exists-and-how-its-different)).

### MongoDB — the best fit, real document store

MongoDB is already document-shaped, so the mapping is closer to 1:1 than any
relational option, and its `findOne` is a **real** query against Mongo's own
query engine — not a client-side scan:

```sh
npm install mongodb
```

```js
const { MongoClient, ObjectId } = require("mongodb");
const { randomUUID } = require("node:crypto");

async function createMongoRepository(uri, dbName, collectionName) {
  const client = await MongoClient.connect(uri);
  const collection = client.db(dbName).collection(collectionName);

  return {
    async findById(id) {
      return collection.findOne({ id });
    },
    async findOne(criteria) {
      return collection.findOne(criteria); // real Mongo query, uses indexes if you add them
    },
    async create(data) {
      const id = data.id ?? randomUUID();
      const doc = { ...data, id };
      await collection.insertOne(doc);
      return doc;
    },
    async update(id, data) {
      const result = await collection.findOneAndUpdate(
        { id },
        { $set: data },
        { returnDocument: "after" },
      );
      return result.value;
    },
    async delete(id) {
      await collection.deleteOne({ id });
    },
    // bonus, matching OrmRepository's extras (not required by the base contract):
    async findAll(predicate) {
      const docs = await collection.find({}).toArray();
      return predicate ? docs.filter(predicate) : docs;
    },
  };
}

module.exports = createMongoRepository;
```

Note the deliberate choice to keep `id` as your own field (a plain string, via
`randomUUID()`) rather than relying on Mongo's own `_id`/`ObjectId` — that keeps
every document's `id` a plain string across every driver, so a schema's
`relation` fields (which store ids as strings/string arrays, see
[2.4](#24-schema-reference)) behave identically regardless of which database is
actually backing a given model. If you'd rather use `_id` natively, map it in
`findById`/`create`/`update` and keep the public shape (`doc.id` as a string) the
same.

### PostgreSQL — relational, JSONB-column pattern

Postgres has no native "just store a document" mode, but `jsonb` gets you close
enough to reuse [`createRepositoryFromStore`](#23-createrepositoryfromstore-the-generic-engine)
directly instead of hand-writing all five methods:

```sh
npm install pg
```

```js
const { Pool } = require("pg");
const { createRepositoryFromStore } = require("@forjajs/orm");

async function createPostgresRepository(connectionString, tableName) {
  const pool = new Pool({ connectionString });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id   TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);

  const store = {
    async get(id) {
      const { rows } = await pool.query(`SELECT data FROM ${tableName} WHERE id = $1`, [id]);
      return rows[0]?.data ?? null;
    },
    async set(id, doc) {
      await pool.query(
        `INSERT INTO ${tableName} (id, data) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [id, doc],
      );
    },
    async delete(id) {
      await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
    },
    async scan(predicate) {
      const { rows } = await pool.query(`SELECT data FROM ${tableName}`);
      const docs = rows.map((r) => r.data);
      return predicate ? docs.filter(predicate) : docs;
    },
  };

  return createRepositoryFromStore(store);
}

module.exports = createPostgresRepository;
```

`findOne`/`countDistinct` still do a full-table `SELECT` + in-process filtering
here — fine for small-to-medium tables, and honest about the trade-off you're
making by reusing the generic KV engine instead of hand-rolling real `WHERE`
clauses. For a table you expect to grow large and query heavily, skip
`createRepositoryFromStore` and implement `Repository<T>` by hand instead
(mirroring the MongoDB example above, but with real SQL `WHERE ... = $1` in
`findOne`) — that's exactly the case [2.3](#23-createrepositoryfromstore-the-generic-engine)
and [2.8](#28-writing-your-own-driver) call out.

### MySQL — same JSON-column pattern

Nearly identical to the Postgres adapter, `mysql2/promise`'s API just differs
slightly (positional `?` placeholders instead of `$1`, and MySQL's JSON column
type instead of `jsonb`):

```sh
npm install mysql2
```

```js
const mysql = require("mysql2/promise");
const { createRepositoryFromStore } = require("@forjajs/orm");

async function createMysqlRepository(connectionUri, tableName) {
  const pool = mysql.createPool(connectionUri);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id   VARCHAR(255) PRIMARY KEY,
      data JSON NOT NULL
    )
  `);

  const store = {
    async get(id) {
      const [rows] = await pool.query(`SELECT data FROM ${tableName} WHERE id = ?`, [id]);
      return rows[0]?.data ?? null;
    },
    async set(id, doc) {
      await pool.query(
        `INSERT INTO ${tableName} (id, data) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [id, JSON.stringify(doc)],
      );
    },
    async delete(id) {
      await pool.query(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
    },
    async scan(predicate) {
      const [rows] = await pool.query(`SELECT data FROM ${tableName}`);
      const docs = rows.map((r) => r.data);
      return predicate ? docs.filter(predicate) : docs;
    },
  };

  return createRepositoryFromStore(store);
}

module.exports = createMysqlRepository;
```

### SQLite — embedded, synchronous driver wrapped as async

`better-sqlite3` is deliberately synchronous (faster for an embedded database,
no event-loop round-trip per query) — the adapter still exposes `async`
methods, since that's what the `Repository<T>` contract requires, they just
resolve instantly:

```sh
npm install better-sqlite3
```

```js
const Database = require("better-sqlite3");
const { createRepositoryFromStore } = require("@forjajs/orm");

function createSqliteRepository(filePath, tableName) {
  const db = new Database(filePath);
  db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);

  const getStmt = db.prepare(`SELECT data FROM ${tableName} WHERE id = ?`);
  const upsertStmt = db.prepare(
    `INSERT INTO ${tableName} (id, data) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  );
  const deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
  const allStmt = db.prepare(`SELECT data FROM ${tableName}`);

  const store = {
    async get(id) {
      const row = getStmt.get(id);
      return row ? JSON.parse(row.data) : null;
    },
    async set(id, doc) {
      upsertStmt.run(id, JSON.stringify(doc));
    },
    async delete(id) {
      deleteStmt.run(id);
    },
    async scan(predicate) {
      const docs = allStmt.all().map((row) => JSON.parse(row.data));
      return predicate ? docs.filter(predicate) : docs;
    },
  };

  return createRepositoryFromStore(store);
}

module.exports = createSqliteRepository;
```

Unlike the other three, `new Database(filePath)` here is itself synchronous, so
`createSqliteRepository` doesn't strictly need to be `async` — it's written that
way anyway, purely so every adapter in this section has the exact same call
shape (`const repo = await createXRepository(...)`) and swapping one driver for
another never means touching the code that calls it.

### Wiring any of these into a Forja project

Save whichever one you need as `features/orm/orm.<name>-repository.js` (matching
the naming convention `forja orm new` expects, though nothing enforces the
filename — it's only ever `require()`d by the model files you write), point your
own `models/*.model.js` files at it instead of the generated json-driver adapter,
and everything else — `defineModel`, migrations, seeds, `forja orm new` — works
completely unaware of the swap. `forja add orm --driver=...` itself doesn't yet
know about MySQL/Postgres/SQLite/MongoDB specifically (only `json-driver` is
wired into its `--driver` flag today, see [1.9](#19-full-cli-reference)); until an
official package ships for one of these, wiring one in is a couple of manual file
edits, not a CLI command.

---

## Design notes / gotchas (both halves)

- **`update()` never requires fields.** It takes `Partial<T>` — only the fields
  you actually pass are validated (type-checked, unique-checked); anything you
  omit is left as-is.
- **Unknown fields are always rejected**, on both `create()` and `update()` — a
  typo in a field name fails loudly instead of silently getting dropped or stored
  unchecked.
- **`unique` costs a read before every write** (`findOne()` under the hood). For
  a KV store via `createRepositoryFromStore`, that's a full `scan()` with a
  predicate — fine at the data sizes this driver targets, but know that it's
  there if you're declaring `unique` on a field you write to very frequently.
- **Relations are not enforced at write time** — see [2.4](#24-schema-reference).
  `@forjajs/orm` validates *shape* (an id, or an array of ids), never existence.
- **`defineModel`'s document type is inferred from the schema you pass to it, not
  from the repository's own generic type** — you can hand it a loosely-typed
  `Repository<Record<string, unknown>>` (which is exactly what every driver
  adapter above returns) and still get a fully-typed model back. This is
  deliberate: the schema is the single source of truth for what a document looks
  like, not the driver.

---

## FAQ / troubleshooting

**"`await User.findOne(...)` throws `User.findOne is not a function`."**
`User` here is almost certainly still the *Promise* returned by the async model
file, not the resolved model — see [1.5, "The one wrinkle"](#the-one-wrinkle-model-creation-is-async).
`const User = await require("../orm/models/user.model.js");` first, then call
methods on `User`.

**"`SyntaxError: await is only valid in async functions` / `ERR_REQUIRE_ASYNC_MODULE`
at the top of my route file."**
You tried to `await require(...)` at the top level of a CommonJS file — Node's
CommonJS loader doesn't support top-level `await` at all (that's an ESM-only
feature). Assign the `require()` result — the Promise — to a variable without
`await`, and `await` *that variable* inside an `async` route handler instead.

**"My server crashes with `ENOENT: no such file or directory` opening a
`.json-driver` file."**
This shouldn't happen anymore inside a Forja project — `resolveEnv()` creates the
environment's directory before returning it, and every generated model file calls
`resolveEnv()` before opening anything. If you're standalone (Part 2) and wrote
your own path resolution, make sure the parent directory exists before calling
`openDatabase()` — `json-driver` itself deliberately does *not* create directories
for you (it stays a plain, surprise-free storage engine usable entirely outside
Forja); that responsibility belongs to whoever decides the path, which in the
Forja flow is `@forjajs/orm`'s `resolveEnv()`, not the driver.

**"I declared a field as `unique` but two documents still ended up with the same
value."**
Two concurrent `create()` calls can both pass the uniqueness check (`findOne()`
finds nothing yet) before either one's `create()` has actually written — there's
a race window, because the check-then-write isn't atomic across two separate
calls. For `json-driver`, all operations against one open database are already
serialized through an internal mutex, which narrows the window a lot but a
`findOne` from one in-flight `create()` can still run before another's `create()`
finishes if they're not awaited sequentially. If you need a hard guarantee under
real concurrency, serialize writes to that model yourself (a queue, or awaiting
one `create()` fully before starting the next) rather than relying on the
uniqueness check alone.

**"TypeScript doesn't autocomplete my schema's field keys in a plain `.js` file."**
You need a `jsconfig.json` at your project root with `"checkJs": true` (the base
Forja `forja new` template includes one already, tuned with
`"maxNodeModuleJsDepth": 0` and `"noImplicitAny": false` specifically so
untyped packages like Express don't flood you with unrelated diagnostics — see
`packages/cli/templates/lang/js/jsconfig.json` in the Forja monorepo for the exact
config). Without `checkJs`, VS Code's JS language service falls back to plain
lexical/word completion for `.js` files instead of full semantic, type-aware
completion — the schema's field-level suggestions (`type`, `required`, `unique`,
`fields`, `relation`) specifically depend on it being on.

**"Do I need `@forjajs/orm` published on npm to get type completion locally?"**
No — TypeScript (and VS Code's language service) resolves types from whatever's
actually in `node_modules`, regardless of whether it came from the public
registry or a `file:` dependency pointing at a local folder. If you're developing
against an unpublished/local build of `@forjajs/orm`, point your `package.json`
at it with `"@forjajs/orm": "file:../path/to/addon-orm"` and `npm install` — full
completion works identically to a published package.

**"Can I mix drivers — some models on `json-driver`, others on something else?"**
Yes. Nothing about `defineModel` or a model file ties your whole project to one
driver — each model's own file chooses which adapter to `require()`. Generate a
second adapter (by hand, or via a future `forja add orm --driver=<other>` once
more official drivers ship) and point a specific model at it instead of the
default one.
