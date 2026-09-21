import { describe, it, expect } from "vitest";
import express from "express";
import { assertNoRouteCollisions } from "../src/registry/routeCollisions";

describe("assertNoRouteCollisions", () => {
  it("does nothing when every file declares distinct routes", () => {
    const a = express.Router();
    a.get("/users", () => {});
    const b = express.Router();
    b.post("/users", () => {});

    expect(() =>
      assertNoRouteCollisions([
        { file: "a.route.js", router: a },
        { file: "b.route.js", router: b },
      ]),
    ).not.toThrow();
  });

  it("throws when two files declare the exact same method + path", () => {
    const a = express.Router();
    a.post("/register", () => {});
    const b = express.Router();
    b.post("/register", () => {});

    expect(() =>
      assertNoRouteCollisions([
        { file: "a.route.js", router: a },
        { file: "b.route.js", router: b },
      ]),
    ).toThrow(/Route collision: "POST \/register" is declared in both "a.route.js" and "b.route.js"/);
  });

  it("does not flag routes that merely overlap by design (param vs literal)", () => {
    const a = express.Router();
    a.get("/users/:id", () => {});
    const b = express.Router();
    b.get("/users/new", () => {});

    expect(() =>
      assertNoRouteCollisions([
        { file: "a.route.js", router: a },
        { file: "b.route.js", router: b },
      ]),
    ).not.toThrow();
  });

  it("does not flag the same method + path declared twice within the SAME file", () => {
    const a = express.Router();
    a.get("/ping", () => {});
    a.get("/ping", () => {}); // legitimate multi-handler chain on one route

    expect(() => assertNoRouteCollisions([{ file: "a.route.js", router: a }])).not.toThrow();
  });

  it("does not confuse two different HTTP methods on the same path", () => {
    const a = express.Router();
    a.get("/users", () => {});
    const b = express.Router();
    b.post("/users", () => {});
    b.get("/users", () => {}); // this one DOES collide with a's GET /users

    expect(() =>
      assertNoRouteCollisions([
        { file: "a.route.js", router: a },
        { file: "b.route.js", router: b },
      ]),
    ).toThrow(/GET \/users/);
  });
});
