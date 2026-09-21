# @forjajs/contracts

The dependency-inversion interfaces shared across the Forja ecosystem, plus the
runtime guard that enforces them. Zero dependencies, no Express, no HTTP
anything — usable in a web server, a CLI, a background worker, or any plain
Node.js project. [Forja](https://github.com/forjajs/forja) is not required.

**This is plumbing, not a destination.** You'll almost never `npm install` it
by hand — it's a `peerDependency` of `@forjajs/orm`, `@forjajs/core`, and every
other Forja addon, and npm (7+) installs peer dependencies automatically. If
you're using any of those, this package is already sitting in your
`node_modules` whether you asked for it or not; there's nothing here to
configure or call directly in ordinary application code.

The one case where you *do* reach for it on purpose: you're writing your own
driver adapter or your own addon, and you need `Repository<T>` (or one of the
other contracts below) to type against, plus `assertImplements()` to guard it
at runtime.

## Why this is its own package

Every Forja addon — `@forjajs/orm`, `@forjajs/addon-auth`, a future
`@forjajs/addon-i18n` — needs to depend on *some* shape for "a repository" or
"a hasher" without depending on a concrete implementation. That shape used to
live inside `@forjajs/core`, alongside `@forjajs/core`'s own Express-specific
route/middleware auto-discovery registry.

That was fine as long as every addon was HTTP-based. It stopped being fine the
moment a non-HTTP addon (`@forjajs/orm`, usable standalone in a CLI tool or a
worker with no Express in sight) needed the `Repository<T>` contract: depending
on `@forjajs/core` pulled in Express as a transitive dependency for a project
that might never touch HTTP at all.

`@forjajs/contracts` is the part every addon actually needs — genuinely
zero-dependency. `@forjajs/core` now depends on *this* package for its own
`contracts` re-export, instead of the other way around.

## Install (only if you need it directly)

```bash
npm install @forjajs/contracts
```

Skip this if you're just using `@forjajs/orm` or another addon — it's already
coming along as a peer dependency.

## The contracts

Each contract is a plain TypeScript interface plus a `*_METHODS` constant
(the exact list of method names `assertImplements` checks at runtime — see
below). Nothing here is abstract-class-based or requires extending anything;
any object shaped like the interface satisfies the contract.

### `Repository<T>`

```ts
interface Repository<T = Record<string, unknown>> {
  findById(id: string | number): Promise<T | null>;
  findOne(criteria: Partial<T>): Promise<T | null>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>): Promise<T>;
  delete(id: string | number): Promise<void>;
}
```

Fulfilled by any persistence implementation — `@forjajs/orm`'s generic engine,
a hand-rolled adapter for a driver with its own real query engine (MongoDB), a
plain in-memory store in a test. Engines depend on this shape, never on a
concrete database.

### `Hasher`

```ts
interface Hasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}
```

Fulfilled by any password-hashing implementation (bcrypt, argon2, scrypt...).

### `ViewEngine`

```ts
interface ViewEngine {
  extension: string;
  render(templatePath: string, locals: Record<string, unknown>): Promise<string>;
}
```

Fulfilled by any server-side template engine (Pug, EJS, Handlebars...).

### `Addon`

```ts
interface Addon {
  name: string;
  register(app: Application, config: Record<string, unknown>): void | Promise<void>;
}
```

Fulfilled by every official or third-party Forja addon. Note this is the one
contract here that does mention Express's `Application` type — it's still
defined here rather than in `@forjajs/core`, since every addon (including
non-HTTP ones) needs to describe itself this way to `forja add`, even if its
own `register()` never touches `app` for anything beyond mounting nothing.

## `assertImplements()`

```ts
function assertImplements(
  contractName: string,
  implementation: Record<string, unknown> | null | undefined,
  methods: readonly string[],
): void;
```

TypeScript interfaces are erased at compile time — anything wired up
dynamically (an addon resolved by name, a driver picked at `forja add` time)
still needs a runtime check that it actually implements the contract it claims
to. `assertImplements` is that check: it throws immediately, naming every
missing method, instead of failing later with an obscure "undefined is not a
function" deep inside a request.

```ts
import { assertImplements, REPOSITORY_METHODS } from "@forjajs/contracts";

assertImplements("Repository", myRepository, REPOSITORY_METHODS);
// throws: "Repository" contract violation: missing method(s) delete
```

Each contract exports its own `*_METHODS` constant
(`REPOSITORY_METHODS`, `HASHER_METHODS`, `VIEW_ENGINE_METHODS`, `ADDON_METHODS`)
— always pass the constant, not a hand-typed array, so the check can never
drift out of sync with the interface it's meant to guard.

## License

MIT
