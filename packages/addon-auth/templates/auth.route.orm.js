const router = require("express").Router();
const { validateBody } = require("@forjajs/addon-validator");
const { createAuthEngine } = require("./auth.engine");
const hasher = require("./auth.password");

// Auto-wired because @forjajs/orm was already installed (features/orm/
// existed) when `forja add auth` ran — see addAddon.ts's "auth" branch.
// auth.engine.js still only ever sees the Repository<T> contract; it has no
// idea this is @forjajs/orm underneath. Swap this require() for a different
// stack's own adapter any time without touching auth.engine.js — see the
// plain (non-ORM) version of this file for raw-SQL/Prisma/etc. examples.
const userModelPromise = require("../orm/models/user.model.js");

const engine = createAuthEngine({
  hasher,
  users: {
    async findById(id) {
      return (await userModelPromise).findById(id);
    },
    async findOne(criteria) {
      return (await userModelPromise).findOne(criteria);
    },
    async create(data) {
      return (await userModelPromise).create(data);
    },
    async update(id, data) {
      return (await userModelPromise).update(id, data);
    },
    async delete(id) {
      return (await userModelPromise).delete(id);
    },
  },
});

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
