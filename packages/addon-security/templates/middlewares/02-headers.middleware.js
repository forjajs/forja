const helmet = require("helmet");

// Hardened HTTP headers. CSP starts from helmet's own safe defaults —
// projects using inline scripts/styles or third-party assets (CDN fonts,
// analytics...) will need to extend `directives` here as those needs come up.
// HSTS is meaningless (and can be actively wrong) over plain HTTP in dev, so
// it only kicks in once NODE_ENV=production and the app is actually served
// over TLS.
module.exports = helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "form-action": ["'self'"],
    },
  },
  hsts: process.env.NODE_ENV === "production",
  referrerPolicy: { policy: "no-referrer" },
});
