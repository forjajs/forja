import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sanitize = require("../templates/middlewares/06-sanitize.middleware.js");

describe("06-sanitize.middleware", () => {
  it("strips NoSQL operator keys ($gt, $where...) from req.body", () => {
    const req = { body: { email: { $gt: "" }, password: "x" }, query: {}, params: {} };
    let calls = 0;

    sanitize(req, {}, () => calls++);

    expect(calls).toBe(1);
    expect(req.body.email).toEqual({});
  });

  it("leaves ordinary payloads untouched", () => {
    const req = { body: { email: "a@b.com", password: "x" }, query: {}, params: {} };

    sanitize(req, {}, () => {});

    expect(req.body).toEqual({ email: "a@b.com", password: "x" });
  });
});
