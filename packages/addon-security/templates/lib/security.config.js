const { createConfig } = require("@forjajs/core");

// Single source of truth for every env-driven value the security middlewares
// need — same principle as NeoChess-Legacy's config.js: one parsed object,
// fail-fast on what's actually required, instead of a `process.env.X || Y`
// scattered in each middleware file (which silently accepts "unset" as "use
// the fallback", even for values that must never be left unset in production).
//
// Always plain JS, like every other addon-security file — shared/middlewares/
// and features/ are never compiled, so this is require()'d by relative path
// directly, not routed through req.app.get("config").
module.exports = createConfig({
  corsOrigin: {
    env: "CORS_ORIGIN",
    required: process.env.NODE_ENV === "production",
    parse: (raw) => raw.split(",").map((origin) => origin.trim()).filter(Boolean),
  },
  sessionSecret: { env: "SESSION_SECRET", required: true },
  sessionName: { env: "SESSION_NAME", default: "forja.sid" },
  sessionMaxAgeMs: { env: "SESSION_MAX_AGE_MS", default: 60 * 60 * 1000, parse: Number },
  rateLimitWindowMs: { env: "RATE_LIMIT_WINDOW_MS", default: 15 * 60 * 1000, parse: Number },
  rateLimitMax: { env: "RATE_LIMIT_MAX", default: 300, parse: Number },
});
