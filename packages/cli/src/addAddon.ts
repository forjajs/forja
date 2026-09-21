import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { copyLayer } from "./scaffold";
import { repositoryCallArgs, ormConfigContent, resolveOrmDriver } from "./ormDriver";
import { writeEnvVars, type ForjaEnvVar } from "./envVars";

export const OFFICIAL_PRESETS = ["auth", "orm", "realtime", "i18n", "security"] as const;
export type Preset = (typeof OFFICIAL_PRESETS)[number];

export const PACKAGE_NAME: Record<Preset, string> = {
  auth: "@forjajs/addon-auth",
  orm: "@forjajs/orm",
  realtime: "@forjajs/addon-realtime",
  i18n: "@forjajs/addon-i18n",
  security: "@forjajs/addon-security",
};

interface JsonObject {
  [key: string]: unknown;
}

interface ForjaDriver {
  template: string;
  package: string;
  extension?: string;
  kind: "filesystem" | "network";
  /** Network drivers only — env vars their orm.config.js needs (DATABASE_URL...), auto-appended to .env/.env.example. */
  env?: ForjaEnvVar[];
}


export interface AddAddonOptions {
  cwd: string;
  preset: Preset;
  /** Required only for addons that declare forjaDrivers (currently just `orm`). */
  driverName?: string;
  /**
   * Generate the starter example (a User model, plus register/login if a view
   * engine is configured). Fine to assume on a brand-new `forja new` scaffold
   * (nothing to conflict with) — presumptuous on a project someone already
   * built, so `forja add orm` on its own defaults this to false; pass true
   * explicitly (--example) to opt in there too.
   */
  withExample?: boolean;
  log: (message: string) => void;
  warn: (message: string) => void;
}

export class AddAddonError extends Error {}

/**
 * Wires an official addon into a project: copies its templates/, adds its
 * dependencies to package.json, and installs exactly those (never a bare
 * "npm install"). Shared by `forja add <preset>` and `forja new`'s inline
 * "add the ORM now?" prompt, so both stay in sync.
 */
export function addAddon({ cwd, preset, driverName, withExample = false, log, warn }: AddAddonOptions): void {
  const packageName = PACKAGE_NAME[preset];

  let addonPackageJsonPath: string;
  try {
    addonPackageJsonPath = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new AddAddonError(`Could not resolve "${packageName}". Is it installed alongside @forjajs/cli?`);
  }
  const addonDir = path.dirname(addonPackageJsonPath);
  const templatesDir = path.join(addonDir, "templates");

  if (!fs.existsSync(templatesDir)) {
    warn(`"forja add ${preset}" has no templates yet — ${packageName} is still an empty package under construction.`);
    return;
  }

  const addonPackageJson = JSON.parse(fs.readFileSync(addonPackageJsonPath, "utf8")) as JsonObject;
  const peerDependencies = (addonPackageJson.peerDependencies as JsonObject) ?? {};
  const forjaDrivers = (addonPackageJson.forjaDrivers as Record<string, ForjaDriver>) ?? {};
  const forjaEnv = (addonPackageJson.forjaEnv as ForjaEnvVar[]) ?? [];

  let driverPackage: string | undefined;

  if (preset === "security") {
    // Unlike every other addon, security's templates are global middlewares
    // meant to run on 100% of requests (helmet, cors, sessions, rate-limit,
    // csrf...) — per @forjajs/core's own registry convention, that means
    // shared/middlewares/, never a features/ subfolder of routes that don't
    // exist here. Only the explicitly-required helpers (rate limiter factory
    // for sensitive routes) go under features/security/.
    const middlewaresSrc = path.join(templatesDir, "middlewares");
    const middlewaresDest = path.join(cwd, "shared", "middlewares");
    fs.mkdirSync(middlewaresDest, { recursive: true });
    for (const entry of fs.readdirSync(middlewaresSrc)) {
      const to = path.join(middlewaresDest, entry);
      if (fs.existsSync(to)) {
        throw new AddAddonError(`"${to}" already exists.`);
      }
    }
    copyLayer(middlewaresSrc, middlewaresDest);

    const libSrc = path.join(templatesDir, "lib");
    if (fs.existsSync(libSrc)) {
      const libDest = path.join(cwd, "features", "security");
      if (fs.existsSync(libDest)) {
        throw new AddAddonError(`"${libDest}" already exists.`);
      }
      fs.mkdirSync(libDest, { recursive: true });
      copyLayer(libSrc, libDest);
    }

    writeAddonDependencies({ cwd, preset, packageName, peerDependencies, driverPackage: undefined, log, warn });
    writeEnvVars({ cwd, label: preset, vars: forjaEnv, log });
    return;
  }

  const targetFeatureDir = path.join(cwd, "features", preset);
  if (fs.existsSync(targetFeatureDir)) {
    throw new AddAddonError(`"${targetFeatureDir}" already exists.`);
  }

  fs.mkdirSync(targetFeatureDir, { recursive: true });

  if (Object.keys(forjaDrivers).length > 0) {
    // orm-like addon: only wire in the one driver the user chose, never every
    // driver's adapter at once (each driver's real package is opt-in).
    const driverNames = Object.keys(forjaDrivers);
    const resolvedDriverName = driverName ?? (driverNames.length === 1 ? driverNames[0] : undefined);

    if (!resolvedDriverName || !(resolvedDriverName in forjaDrivers)) {
      throw new AddAddonError(`"forja add ${preset}" requires --driver (available: ${driverNames.join(", ")}).`);
    }

    const driver = forjaDrivers[resolvedDriverName];
    driverPackage = driver.package;

    const driverTemplatePath = path.join(templatesDir, driver.template);
    fs.copyFileSync(driverTemplatePath, path.join(targetFeatureDir, driver.template));

    // Stable indirection: models never require() a specific driver's adapter
    // file directly, only this one, fixed-name file. Switching drivers later
    // (a future `forja orm switch-driver`) just regenerates this one file —
    // no model file ever needs to change.
    fs.writeFileSync(
      path.join(targetFeatureDir, "driver.js"),
      `// Regenerated by \`forja add orm --driver=...\` (or a future \`forja orm switch-driver\`).
// Models require() this file, never a driver's adapter file directly — that's
// what lets the active driver change without touching any model.
module.exports = require("./${driver.template}");
`,
    );

    // Copy any non-driver-specific templates too (composition-root examples...),
    // except orm.config.js — its shape (path vs connectionString) depends on the
    // chosen driver's kind, so it's generated below instead of copied verbatim.
    for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
      const isAnyDriverTemplate = Object.values(forjaDrivers).some((d) => d.template === entry.name);
      if (isAnyDriverTemplate || entry.name === "orm.config.js") continue;
      const from = path.join(templatesDir, entry.name);
      const to = path.join(targetFeatureDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        copyLayer(from, to);
      } else {
        fs.copyFileSync(from, to);
      }
    }

    if (preset === "orm") {
      fs.writeFileSync(path.join(targetFeatureDir, "orm.config.js"), ormConfigContent(driver.kind));
      writeEnvVars({ cwd, label: resolvedDriverName, vars: driver.env ?? [], log });
    }
  } else if (preset === "auth") {
    // auth.route.js's "users" is a composition-root detail (which
    // Repository<T> implementation to inject into auth.engine.js) — auto-wire
    // it to @forjajs/orm when that's already sitting in the project, since
    // guessing wrong (or worse, shipping a stub that silently no-ops) is far
    // worse than staying unwired. Anything else (raw SQL, Prisma...) is still
    // just as supported, only manually — see the comment in auth.route.js.
    for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
      if (entry.name === "auth.route.js" || entry.name === "auth.route.orm.js") continue;
      const from = path.join(templatesDir, entry.name);
      const to = path.join(targetFeatureDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        copyLayer(from, to);
      } else {
        fs.copyFileSync(from, to);
      }
    }

    const ormFeatureDir = path.join(cwd, "features", "orm");
    const wireOrm = fs.existsSync(ormFeatureDir);

    if (wireOrm) {
      const userModelPath = path.join(ormFeatureDir, "models", "user.model.js");
      if (!fs.existsSync(userModelPath)) {
        writeOrmUserModel(ormFeatureDir, resolveOrmDriver(ormFeatureDir));
        log("Generated features/orm/models/user.model.js (none existed yet) to wire auth into.");
      }
      fs.copyFileSync(path.join(templatesDir, "auth.route.orm.js"), path.join(targetFeatureDir, "auth.route.js"));
      log("Detected @forjajs/orm already installed — wired auth.route.js to features/orm/models/user.model.js automatically.");
    } else {
      fs.copyFileSync(path.join(templatesDir, "auth.route.js"), path.join(targetFeatureDir, "auth.route.js"));
      log(
        "No ORM detected — features/auth/auth.route.js ships with a fail-fast stub. " +
          "Wire your own Repository<T> (raw SQL, Prisma, or run \"forja add orm\" first) — see the comment inside.",
      );
    }
  } else {
    copyLayer(templatesDir, targetFeatureDir);
  }

  writeAddonDependencies({ cwd, preset, packageName, peerDependencies, driverPackage, log, warn });
  writeEnvVars({ cwd, label: preset, vars: forjaEnv, log });

  if (preset === "orm" && driverPackage && withExample) {
    const resolvedDriverName = Object.keys(forjaDrivers).find((n) => forjaDrivers[n].package === driverPackage)!;
    generateOrmExample({ cwd, ormFeatureDir: targetFeatureDir, driver: forjaDrivers[resolvedDriverName], log, warn });
  } else if (preset === "orm") {
    log('Skipped the starter example (User model + register/login) — pass --example to generate it, or run "forja orm new <Model>" yourself.');
  }
}

function writeAddonDependencies({
  cwd,
  preset,
  packageName,
  peerDependencies,
  driverPackage,
  log,
  warn,
}: {
  cwd: string;
  preset: Preset;
  packageName: string;
  peerDependencies: JsonObject;
  driverPackage: string | undefined;
  log: (message: string) => void;
  warn: (message: string) => void;
}): void {
  const targetPackageJsonPath = path.join(cwd, "package.json");
  const targetPackageJson = JSON.parse(fs.readFileSync(targetPackageJsonPath, "utf8")) as JsonObject;
  const dependencies = (targetPackageJson.dependencies as JsonObject) ?? {};

  dependencies[packageName] = "*";
  for (const dep of Object.keys(peerDependencies)) {
    if (!(dep in dependencies)) dependencies[dep] = "*";
  }
  if (driverPackage) {
    dependencies[driverPackage] = "*";
  }

  targetPackageJson.dependencies = dependencies;
  fs.writeFileSync(targetPackageJsonPath, JSON.stringify(targetPackageJson, null, 2) + "\n");

  const addedDeps = [packageName, ...Object.keys(peerDependencies), ...(driverPackage ? [driverPackage] : [])];
  log(
    preset === "security"
      ? "Added security middlewares to shared/middlewares/ (auto-mounted on every request)."
      : `Added "${preset}" to features/${preset}/`,
  );
  log(`Updated dependencies: ${addedDeps.join(", ")}`);

  // Only install what this command just added — never a bare "npm install"
  // (that would touch every dependency in the project, not just this addon's).
  log(`Installing ${addedDeps.join(", ")}...`);
  const result = spawnSync("npm", ["install", ...addedDeps], { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    warn("Install failed — run your package manager's install command manually.");
  }
}

interface ViewConfig {
  engine: string;
}

/**
 * Generates features/orm/models/user.model.js against whichever driver is
 * already wired in ormFeatureDir/driver.js. Shared by generateOrmExample
 * (forja add orm --example) and the "auth" branch's ORM auto-wiring (forja
 * add auth, when features/orm/ already exists but has no User model yet) —
 * both need the exact same model, just for different reasons.
 */
function writeOrmUserModel(ormFeatureDir: string, driver: ForjaDriver): void {
  const modelsDir = path.join(ormFeatureDir, "models");
  fs.mkdirSync(modelsDir, { recursive: true });

  fs.writeFileSync(
    path.join(modelsDir, "user.model.js"),
    `const { defineModel, resolveEnv } = require("@forjajs/orm");
const createRepository = require("../driver.js"); // stable — never the driver's own file name
const config = require("../orm.config.js");

const env = resolveEnv(config);

/**
 * User model — declare its fields below, they're validated on every
 * create()/update() before the driver ever sees the write.
 */
module.exports = (async () => {
  const repository = await createRepository(${repositoryCallArgs(driver, "user")});
  return defineModel("User", {
    fields: {
      id: { type: "string", unique: true },
      email: { type: "string", required: true, unique: true },
      passwordHash: { type: "string", required: true },
    },
  }, repository);
})();
`,
  );
}

/**
 * First-use example, generated only when ORM is added — a real `User` model
 * plus a working register/login flow (Pug forms), like AdonisJS's starter
 * kits. Runs identically whether ORM is picked at `forja new` time or added
 * later via `forja add orm` — both go through this same function. Deletable:
 * the user can throw it all away and start from scratch, nothing else depends
 * on it.
 */
function generateOrmExample({
  cwd,
  ormFeatureDir,
  driver,
  log,
  warn,
}: {
  cwd: string;
  ormFeatureDir: string;
  driver: ForjaDriver;
  log: (message: string) => void;
  warn: (message: string) => void;
}): void {
  writeOrmUserModel(ormFeatureDir, driver);

  const viewConfigPath = path.join(cwd, "forja.view.json");
  if (!fs.existsSync(viewConfigPath)) {
    log("Generated a User model at features/orm/models/user.model.js — no view engine configured, skipping the register/login example.");
    return;
  }

  const view = JSON.parse(fs.readFileSync(viewConfigPath, "utf8")) as ViewConfig;
  if (view.engine !== "pug") {
    warn(`Register/login example only ships for Pug for now (this project uses "${view.engine}") — skipped.`);
    return;
  }

  const authFeatureDir = path.join(cwd, "features", "auth-example");
  const authRoutePath = path.join(authFeatureDir, "auth-example.route.js");
  if (fs.existsSync(authRoutePath)) {
    warn(`"${authRoutePath}" already exists — leaving it untouched, skipping the register/login example.`);
    return;
  }

  fs.mkdirSync(authFeatureDir, { recursive: true });
  fs.writeFileSync(
    authRoutePath,
    `const router = require("express").Router();
const crypto = require("node:crypto");

// DEMO ONLY — a minimal register/login flow proving @forjajs/orm end to end.
// Password hashing here uses Node's built-in crypto (scrypt) to stay a
// zero-dependency example; swap in @forjajs/addon-auth (\`forja add auth\`)
// for a real session/JWT-backed auth system. Delete this file freely.
const userModel = require("../orm/models/user.model.js");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return \`\${salt}:\${hash}\`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

router.get("/register", (req, res) => {
  res.render("register", { error: null });
});

router.post("/register", async (req, res) => {
  const User = await userModel;
  const { email, password } = req.body;

  try {
    await User.create({ email, passwordHash: hashPassword(password) });
    res.redirect("/login");
  } catch (err) {
    res.render("register", { error: err.message });
  }
});

router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

router.post("/login", async (req, res) => {
  const User = await userModel;
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.render("login", { error: "Invalid email or password" });
  }

  res.redirect(\`/?user=\${encodeURIComponent(user.email)}\`);
});

module.exports = router;
`
  );

  const viewsDir = path.join(cwd, "views");
  fs.mkdirSync(viewsDir, { recursive: true });

  const registerViewPath = path.join(viewsDir, "register.pug");
  const loginViewPath = path.join(viewsDir, "login.pug");
  if (fs.existsSync(registerViewPath) || fs.existsSync(loginViewPath)) {
    warn(`"${registerViewPath}" or "${loginViewPath}" already exists — leaving views untouched.`);
    return;
  }

  fs.writeFileSync(
    registerViewPath,
    `doctype html
html
  head
    title Register
  body
    h1 Register
    if error
      p.error= error
    form(method="post" action="/register")
      input(type="email" name="email" placeholder="Email" required)
      input(type="password" name="password" placeholder="Password" required)
      button(type="submit") Register
    p
      a(href="/login") Already have an account? Login
`
  );

  fs.writeFileSync(
    loginViewPath,
    `doctype html
html
  head
    title Login
  body
    h1 Login
    if error
      p.error= error
    form(method="post" action="/login")
      input(type="email" name="email" placeholder="Email" required)
      input(type="password" name="password" placeholder="Password" required)
      button(type="submit") Login
    p
      a(href="/register") No account? Register
`
  );

  log("Generated a working register/login example: features/auth-example/, views/register.pug, views/login.pug — delete freely, it's yours.");
}
