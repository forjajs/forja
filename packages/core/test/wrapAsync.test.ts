import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { wrapAsync } from "../src/registry/wrapAsync";

function fakeReqRes() {
  return { req: {} as Request, res: {} as Response };
}

describe("wrapAsync", () => {
  it("does not call next() when the async handler resolves", async () => {
    const handler = vi.fn(async () => {});
    const next = vi.fn() as NextFunction;
    const { req, res } = fakeReqRes();

    wrapAsync(handler)(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards a rejected promise to next(), instead of leaving the request hanging", async () => {
    const error = new Error("boom");
    const handler = vi.fn(async () => {
      throw error;
    });
    const next = vi.fn() as NextFunction;
    const { req, res } = fakeReqRes();

    wrapAsync(handler)(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(error);
  });

  it("wraps a synchronous handler that returns a non-promise value without throwing", async () => {
    const handler = vi.fn(() => undefined as unknown as void);
    const next = vi.fn() as NextFunction;
    const { req, res } = fakeReqRes();

    expect(() => wrapAsync(handler)(req, res, next)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).not.toHaveBeenCalled();
  });
});
