import { describe, it, expect } from "vitest";

// These have no custom logic and no config dependency — they configure a
// well-known third-party middleware and export it as-is. The real assertion
// is "requiring the file doesn't throw and yields an Express middleware
// function" — the actual behavior (headers set, gzip applied...) is that
// dependency's own responsibility, already covered by its own test suite.
//
// 02-cors, 05-rate-limit and 06-session are excluded here — they require
// security.config.js via a relative path built for the deployed project
// layout (shared/middlewares/ + features/security/ as siblings), which only
// exists once copied by `forja add security` — see cors.test.ts,
// rateLimit.test.ts and session.test.ts, which build that layout in a tmp dir
// first.
describe.each([["00-cookie-parser.middleware.js"], ["01-headers.middleware.js"], ["03-compression.middleware.js"], ["04-hpp.middleware.js"]])(
  "%s",
  (file) => {
    it("loads and exports an Express middleware function", () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const middleware = require(`../templates/middlewares/${file}`);
      expect(typeof middleware).toBe("function");
    });
  },
);
