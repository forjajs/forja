# @forjajs/addon-security

Forja's official security hardening addon: trust-proxy handling, cookie
parsing, hardened HTTP headers, CORS, compression, HTTP Parameter Pollution
protection, NoSQL-injection sanitization, rate limiting, sessions, and CSRF
protection. Usable standalone in any Express app
— [Forja](https://github.com/forjajs/forja) is not required, but `forja add
security` wires it in automatically and mounts every middleware in the right
order for you.

This is **not** authentication (`@forjajs/addon-auth` — login, password
hashing, route guards). It's the layer underneath: the hardening every
Express app needs regardless of whether it has a login system at all.

## What's inside

| File | What it does |
| --- | --- |
| `00-trust-proxy.middleware.js` | Sets Express's `trust proxy` from `TRUST_PROXY` — unset by default (no proxy assumed). Needed for `req.ip`, `secure`, and `X-Forwarded-*` to be trustworthy behind a reverse proxy/load balancer. |
| `01-cookie-parser.middleware.js` | Parses the `Cookie` header — session and CSRF both read `req.cookies`. |
| `02-headers.middleware.js` | `helmet`, with a CSP starting from its safe defaults plus `form-action: 'self'`. HSTS only enables once `NODE_ENV=production` (meaningless over plain HTTP in dev). |
| `03-cors.middleware.js` | `cors`, driven by a `CORS_ORIGIN` allowlist — **required** in production, refuses to fall back to `origin: "*"`. |
| `04-compression.middleware.js` | `compression`, no config needed. |
| `05-hpp.middleware.js` | `hpp` — guards against `?role=user&role=admin`-style parameter pollution. |
| `06-sanitize.middleware.js` | `express-mongo-sanitize` — strips `$`/`.`-keyed NoSQL operator injection (`{"email":{"$gt":""}}`) from `req.body`/`query`/`params`. |
| `07-rate-limit.middleware.js` | A generous global baseline (`express-rate-limit`) against volume-based abuse. |
| `08-session.middleware.js` | `express-session` with secure cookie defaults (`httpOnly`, `sameSite: "lax"`, `secure` in production). Requires `SESSION_SECRET`. |
| `09-csrf.middleware.js` | Hand-rolled double-submit-cookie CSRF check — no `csurf` (deprecated/unmaintained). Only enforced when `req.session` exists and the method isn't safe (`GET`/`HEAD`/`OPTIONS`). |
| `security.rateLimiters.js` | `createRateLimiter(options)` — a **stricter**, route-scoped limiter factory for login/register/password-reset, not auto-mounted. |

The ten `NN-*.middleware.js` files are global — meant to run on every
request — and the numeric prefixes fix their load order (trust proxy before
rate-limit/session, cookies before session, session before CSRF, etc.).
`security.rateLimiters.js` is the one piece you require explicitly, only
where you actually need a tighter limit.

## Environment variables

| Variable | Required | Default |
| --- | --- | --- |
| `TRUST_PROXY` | no | unset — no proxy assumed. `"1"` for a single reverse proxy, or any Express `trust proxy` value (subnet, `"loopback"`...) |
| `CORS_ORIGIN` | in production | none — CORS is disabled entirely in dev if unset |
| `SESSION_SECRET` | always | none — throws at boot if missing |
| `SESSION_NAME` | no | `forja.sid` |
| `SESSION_MAX_AGE_MS` | no | `3600000` (1h) |
| `RATE_LIMIT_WINDOW_MS` | no | `900000` (15min) |
| `RATE_LIMIT_MAX` | no | `300` |
| `NODE_ENV` | no | governs HSTS, cookie `secure`, and whether `CORS_ORIGIN` is required |

## Standalone usage (no Forja)

Nothing here auto-mounts on its own outside Forja's `MiddlewareRegistry` —
`require()` each file and `app.use()` it yourself, in the same order as the
table above (the numeric prefixes only matter for the auto-discovery
convention; by hand, you just need cookies before session, and session before
CSRF).

```bash
npm install @forjajs/addon-security helmet cors compression hpp \
  express-mongo-sanitize express-rate-limit express-session cookie-parser
```

```js
const express = require("express");
const app = express();

// Copy these files from node_modules/@forjajs/addon-security/templates/
// into your own project (e.g. shared/middlewares/) and require them from
// there — they're plain, editable Express middlewares, not a library API.
app.use(require("./shared/middlewares/00-trust-proxy.middleware.js"));
app.use(require("./shared/middlewares/01-cookie-parser.middleware.js"));
app.use(require("./shared/middlewares/02-headers.middleware.js"));
app.use(require("./shared/middlewares/03-cors.middleware.js"));
app.use(require("./shared/middlewares/04-compression.middleware.js"));
app.use(require("./shared/middlewares/05-hpp.middleware.js"));
app.use(require("./shared/middlewares/06-sanitize.middleware.js"));
app.use(require("./shared/middlewares/07-rate-limit.middleware.js"));
app.use(require("./shared/middlewares/08-session.middleware.js"));
app.use(require("./shared/middlewares/09-csrf.middleware.js"));

const { createRateLimiter } = require("./features/security/security.rateLimiters.js");

app.post("/login", createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
  // ...
});

app.listen(3000);
```

There's no package export to `require("@forjajs/addon-security")` directly —
like every Forja addon, the actual code you run is the copy that lands in
your project, free to edit once it's there. The package itself is just the
template source plus the npm dependency wiring.

## Forja-integrated usage

```bash
forja add security
```

Copies the ten global middlewares into `shared/middlewares/` — picked up
automatically by `@forjajs/core`'s `MiddlewareRegistry` in load order, nothing
to wire by hand — and `security.rateLimiters.js` into `features/security/`.
Adds every dependency listed above to `package.json` and installs exactly
those (never a bare `npm install`).

`forja new` asks for it too, defaulting to **yes** — unlike the ORM prompt
(defaults to no, since not every project needs a database), security is
recommended for every project regardless of stack:

```
? Add the security addon (@forjajs/addon-security) — helmet, CORS, sessions,
  rate limiting, CSRF? (Recommended) (Y/n)
```

### Using the session Forja gives you

`@forjajs/addon-auth`'s route guard (`req.session?.userId`) depends on a
session middleware existing — before this addon, nothing set one up.
`forja add auth` after (or alongside) `forja add security` now gets a real,
working session out of the box:

```js
// features/auth/auth.route.js (from @forjajs/addon-auth)
router.post("/login", async (req, res) => {
  const user = await engine.authenticateUser(req.body);
  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  req.session.userId = user.id; // now backed by a real, secure-cookie session
  res.json(user);
});
```

### Using the stricter rate limiter on a sensitive route

```js
// features/auth/auth.route.js
const { createRateLimiter } = require("../security/security.rateLimiters");

router.post("/login", createRateLimiter({ max: 10 }), async (req, res) => {
  // the global 07-rate-limit.middleware.js baseline (300 req/15min) is too
  // loose to stop credential stuffing — this route gets its own, tighter cap
});
```

## License

MIT
