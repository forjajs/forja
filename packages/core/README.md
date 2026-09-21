# @forjajs/core

Forja's core: a registry-driven, feature-based Express foundation. No fixed
project structure baked into your code — drop a `*.route.js` file under a
folder and it's mounted, drop a `*.middleware.js` file and it runs on every
request. Nothing to register by hand, no central list of routes to keep in
sync as a project grows.

[Forja](https://github.com/forjajs/forja) itself (the `forja` CLI) scaffolds
projects that use this package, but `@forjajs/core` works in any Express app —
the CLI is not required.

## Install

```bash
npm install @forjajs/core express
```

`@forjajs/contracts` (the DIP interfaces this package's `contracts` re-export
comes from) is a `peerDependency` and gets installed automatically alongside
this one on npm 7+.

## `RouteRegistry`

Recursively scans a directory for files ending in a suffix (default
`.route.js`), `require()`s each one, and mounts what it exports (an Express
Router) onto your app.

```js
const express = require("express");
const path = require("node:path");
const { RouteRegistry } = require("@forjajs/core");

const app = express();

new RouteRegistry(app, { featuresDir: path.join(__dirname, "features") }).load();
// features/users/users.route.js, features/posts/posts.route.js, etc. —
// every one found and mounted, nothing to list anywhere else.

app.listen(3000);
```

A route file just exports a Router:

```js
// features/users/users.route.js
const router = require("express").Router();

router.get("/users", (req, res) => res.json([]));

module.exports = router;
```

## `MiddlewareRegistry`

Same idea, for **global** middlewares only — things that must run on every
request (a logger, a config loader, an i18n resolver). Default suffix
`.middleware.js`, mounted in alphabetical order — name files with a numeric
prefix when order matters (`01-logger.middleware.js`, `02-auth.middleware.js`).

```js
const { MiddlewareRegistry } = require("@forjajs/core");

new MiddlewareRegistry(app, { middlewaresDir: path.join(__dirname, "shared/middlewares") }).load();
```

```js
// shared/middlewares/01-logger.middleware.js
module.exports = (req, res, next) => {
  console.log(req.method, req.path);
  next();
};
```

This is deliberately **not** for feature-scoped middlewares like an auth
guard — those apply to specific routes only, never to 100% of requests, so
they stay a plain `require()` in whichever route file needs them instead of
being auto-mounted here.

## `wrapAsync`

Express 4 does not forward a rejected promise from an async handler to
`next()` automatically — an unhandled rejection just hangs the request.

```js
const { wrapAsync } = require("@forjajs/core");

router.get("/users/:id", wrapAsync(async (req, res) => {
  const user = await findUser(req.params.id); // a rejection here now reaches your error middleware
  res.json(user);
}));
```

## `createConfig`

A generic, env-backed config loader — no fixed schema, no project-specific
fields baked into the framework. Each project describes its own shape:

```js
const { createConfig } = require("@forjajs/core");

const config = createConfig({
  port: { env: "PORT", default: 3000, parse: Number },
  sessionSecret: { env: "SESSION_SECRET", required: true },
});
```

A `required` field missing from the environment throws immediately at boot
(fail fast), instead of surfacing as an obscure bug later inside a request.

## `contracts`

Re-exported from [`@forjajs/contracts`](https://www.npmjs.com/package/@forjajs/contracts)
for convenience — `Repository<T>`, `Hasher`, `ViewEngine`, `Addon`, and the
`assertImplements()` runtime guard. See that package's own README for details;
if you're building a non-HTTP addon (no Express involved at all), depend on
`@forjajs/contracts` directly instead of pulling in this package just for the
contracts.

## License

MIT
