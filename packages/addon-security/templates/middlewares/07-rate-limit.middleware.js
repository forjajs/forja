const rateLimit = require("express-rate-limit");
const config = require("../../features/security/security.config.js");

// Global baseline against brute-force/DoS-by-volume. Deliberately generous —
// this is the floor applied to every request; tighter limits for sensitive
// routes (login, register, password reset) belong on the route itself via
// createRateLimiter() from security.rateLimiters.js, not here.
module.exports = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});
