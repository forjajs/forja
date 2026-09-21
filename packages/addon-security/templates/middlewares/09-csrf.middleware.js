const crypto = require("node:crypto");

// Hand-rolled double-submit-cookie CSRF protection — no external dependency
// (csurf is deprecated/unmaintained; this pattern needs nothing but a signed
// random token compared cookie-vs-request).
//
// Only enforced when req.session exists: cookie/session-based auth is exactly
// what CSRF attacks a third-party site into riding; a pure token/JWT API with
// no cookies has nothing here to forge. Safe methods (GET/HEAD/OPTIONS) never
// mutate state, so they're exempt too.
const COOKIE_NAME = "forja.csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

module.exports = function csrfProtection(req, res, next) {
  if (!req.session) return next();

  if (!req.cookies?.[COOKIE_NAME]) {
    const token = crypto.randomBytes(32).toString("hex");
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false, // must be readable by the client to echo back in a header/hidden field
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    req.csrfToken = () => token;
  } else {
    req.csrfToken = () => req.cookies[COOKIE_NAME];
  }

  if (SAFE_METHODS.has(req.method)) return next();

  const submitted = req.get("x-csrf-token") || req.body?._csrf;
  const expected = req.cookies?.[COOKIE_NAME];

  if (!submitted || !expected || submitted !== expected) {
    return res.status(403).json({ error: "invalid_csrf_token" });
  }

  next();
};
