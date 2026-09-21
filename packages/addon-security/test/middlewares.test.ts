import { describe, it, expect } from "vitest";

// These have no custom logic and no config dependency — they configure a
// well-known third-party middleware and export it as-is. The real assertion
// is "requiring the file doesn't throw and yields an Express middleware
// function" — the actual behavior (headers set, gzip applied...) is that
// dependency's own responsibility, already covered by its own test suite.
//
// 00-trust-proxy, 03-cors, 07-rate-limit and 08-session are excluded here —
// they require security.config.js via a relative path built for the deployed
// project layout (shared/middlewares/ + features/security/ as siblings),
// which only exists once copied by `forja add security` — see
// trustProxy.test.ts, cors.test.ts, rateLimit.middleware.test.ts and
// session.test.ts, which build that layout in a tmp dir first.
describe.each([["01-cookie-parser.middleware.js"], ["02-headers.middleware.js"], ["04-compression.middleware.js"], ["05-hpp.middleware.js"], ["06-sanitize.middleware.js"]])(
  "%s",
  (file) => {
    it("loads and exports an Express middleware function", () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const middleware = require(`../templates/middlewares/${file}`);
      expect(typeof middleware).toBe("function");
    });
  },
);
