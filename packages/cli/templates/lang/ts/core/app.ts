import * as fs from "node:fs";
import * as path from "node:path";
import express from "express";
import { RouteRegistry, MiddlewareRegistry } from "@forjajs/core";
import config from "../config";
import { notFoundHandler, errorHandler } from "./errorHandler";

// Always resolved from the project root (where the app is started), never from
// __dirname — once compiled, __dirname points into dist/, but features/,
// shared/middlewares/ and views/ are never compiled, they only ever exist at the
// project root.
const projectRoot = process.cwd();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(projectRoot, "public")));

// Exposed via `req.app.get("config")` instead of a plain `require("../config")`
// in feature/route files — those live under features/ and are never compiled,
// so a relative require would break in TS projects (config.ts only ever exists
// compiled inside dist/). Going through the app instance sidesteps that entirely.
app.set("config", config);

// forja.view.json is present only when the chosen render option is a server-side
// view engine (EJS/Pug/Handlebars) — absent for API-only or SPA-frontend projects.
// Same principle as NeoChess-Legacy's config.js `isAlreadyImplement` flag: some
// engines (EJS, Pug) are understood natively by Express once named via
// `app.set("view engine", ...)`; others (Handlebars) need their module's factory
// registered explicitly via `app.engine(...)` first.
const viewConfigPath = path.join(projectRoot, "forja.view.json");
if (fs.existsSync(viewConfigPath)) {
  const view = JSON.parse(fs.readFileSync(viewConfigPath, "utf8"));
  app.set("views", path.join(projectRoot, "views"));

  if (!view.isAlreadyImplement) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(view.module);
    const factory = view.export ? mod[view.export] : mod;
    app.engine(view.engine, factory(view.options || {}));
  }

  app.set("view engine", view.engine);
}

const middlewareRegistry = new MiddlewareRegistry(app, {
  middlewaresDir: path.join(projectRoot, "shared", "middlewares"),
});
middlewareRegistry.load();

const routeRegistry = new RouteRegistry(app, {
  featuresDir: path.join(projectRoot, "features"),
});
routeRegistry.load();

// Must come after every registry .load() — Express matches middlewares in
// registration order, so mounting these any earlier would catch requests
// that a real route further down would otherwise have handled.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
