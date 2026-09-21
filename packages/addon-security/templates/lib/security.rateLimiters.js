const rateLimit = require("express-rate-limit");

/**
 * Stricter, route-scoped rate limiter — for login/register/password-reset,
 * where the global 05-rate-limit.middleware.js baseline is too loose to stop
 * a credential-stuffing attempt. Not auto-mounted: require it explicitly in
 * the route that needs it.
 *
 *   const { createRateLimiter } = require("../security/security.rateLimiters");
 *   router.post("/login", createRateLimiter(), ...);
 */
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
  });
}

module.exports = { createRateLimiter };
