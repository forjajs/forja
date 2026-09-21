import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const csrfProtection = require("../templates/middlewares/09-csrf.middleware.js");

interface FakeReq {
  session: Record<string, unknown> | null;
  cookies: Record<string, string>;
  method: string;
  body: Record<string, unknown>;
  get(name: string): string | undefined;
}

function fakeReq({
  session = {},
  cookies = {},
  method = "GET",
  headers = {},
  body = {},
}: {
  session?: Record<string, unknown> | null;
  cookies?: Record<string, string>;
  method?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
} = {}): FakeReq {
  return {
    session,
    cookies,
    method,
    body,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    cookies: {} as Record<string, string>,
    cookie(name: string, value: string) {
      res.cookies[name] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe("09-csrf.middleware", () => {
  it("skips enforcement when there is no session (pure token/JWT API)", () => {
    const req = fakeReq({ session: null, method: "POST" });
    const res = fakeRes();
    let calls = 0;

    csrfProtection(req, res, () => calls++);

    expect(calls).toBe(1);
  });

  it("skips enforcement on safe methods (GET) and issues a cookie", () => {
    const req = fakeReq({ method: "GET" });
    const res = fakeRes();
    let calls = 0;

    csrfProtection(req, res, () => calls++);

    expect(calls).toBe(1);
    expect(res.cookies["forja.csrf"]).toBeDefined();
  });

  it("rejects a mutating request with no submitted token", () => {
    const req = fakeReq({ method: "POST", cookies: { "forja.csrf": "abc" } });
    const res = fakeRes();
    let calls = 0;

    csrfProtection(req, res, () => calls++);

    expect(calls).toBe(0);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a mutating request whose submitted token doesn't match the cookie", () => {
    const req = fakeReq({
      method: "POST",
      cookies: { "forja.csrf": "abc" },
      headers: { "x-csrf-token": "wrong" },
    });
    const res = fakeRes();
    let calls = 0;

    csrfProtection(req, res, () => calls++);

    expect(calls).toBe(0);
    expect(res.statusCode).toBe(403);
  });

  it("accepts a mutating request whose submitted token matches the cookie", () => {
    const req = fakeReq({
      method: "POST",
      cookies: { "forja.csrf": "abc" },
      headers: { "x-csrf-token": "abc" },
    });
    const res = fakeRes();
    let calls = 0;

    csrfProtection(req, res, () => calls++);

    expect(calls).toBe(1);
    expect(res.statusCode).toBe(200);
  });
});
