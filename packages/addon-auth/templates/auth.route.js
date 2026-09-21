const router = require("express").Router();
const { validateBody } = require("@forjajs/addon-validator");
const { createAuthEngine } = require("./auth.engine");
const hasher = require("./auth.password");

// No Repository<T> wired yet — this stub fails loudly instead of pretending
// to work (the old version of this file silently accepted writes and lost
// them: `create(data) { return data; }` looked like a working repository
// until you tried to log back in).
//
// Wire ANY implementation of the Repository<T> contract here — nothing above
// this line cares which one. auth.engine.js only ever calls
// findOne/create/update/delete/findById, so any of these work unchanged:
//
//   @forjajs/orm (auto-wired for you instead of this stub if features/orm/
//   already existed when you ran `forja add auth` — see auth.route.orm.js):
//     const userModel = require("../orm/models/user.model.js");
//     const users = await userModel; // resolve once, reuse per request
//
//   raw SQL (pg):
//     const users = {
//       async findOne({ email }) {
//         const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
//         return rows[0] ?? null;
//       },
//       async create(data) {
//         const { rows } = await pool.query(
//           "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *",
//           [data.email, data.passwordHash],
//         );
//         return rows[0];
//       },
//       async findById(id) { /* ... */ },
//       async update(id, data) { /* ... */ },
//       async delete(id) { /* ... */ },
//     };
//
//   Prisma/Drizzle/anything else: same five methods, whatever query API
//   they give you underneath.
//
// @forjajs/contracts's assertImplements() only checks that these five method
// names exist — it can't tell a real implementation from a stub that has the
// right shape but does nothing, which is exactly how the old default here
// went unnoticed. Throwing on every call is what actually catches "nobody
// wired this yet" immediately, the first time a request hits it.
function notWired(method) {
  return () => {
    throw new Error(
      `@forjajs/addon-auth: features/auth/auth.route.js's "users" has no real Repository<T> wired (${method} was called). ` +
        `See the comment above it for how to plug in @forjajs/orm, raw SQL, or any other stack.`,
    );
  };
}

const users = {
  findById: notWired("findById"),
  findOne: notWired("findOne"),
  create: notWired("create"),
  update: notWired("update"),
  delete: notWired("delete"),
};

const engine = createAuthEngine({ hasher, users });

const registerSchema = {
  email: { required: true, isEmail: true },
  password: { required: true, min: 8, max: 72 },
};

const loginSchema = {
  email: { required: true, isEmail: true },
  password: { required: true },
};

router.post("/register", validateBody(registerSchema), async (req, res) => {
  const user = await engine.registerUser(req.body);
  res.status(201).json(user);
});

router.post("/login", validateBody(loginSchema), async (req, res) => {
  const user = await engine.authenticateUser(req.body);
  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  // auth.middleware.js's guard checks req.session?.userId — nothing else
  // ever sets it, so without this line every route behind the guard would
  // reject a freshly logged-in user. Requires @forjajs/addon-security's
  // session middleware (or your own express-session setup) to be mounted.
  if (req.session) req.session.userId = user.id;
  res.json(user);
});

module.exports = router;
