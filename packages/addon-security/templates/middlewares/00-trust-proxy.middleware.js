const config = require("../../features/security/security.config.js");

// Behind a reverse proxy/load balancer (nginx, Heroku, a cloud LB...), Express
// sees the proxy's own IP/protocol, not the client's — req.ip, req.secure,
// and the "X-Forwarded-*" headers helmet/rate-limit/session rely on are wrong
// until "trust proxy" is set. Left at the Express default (false), every
// client behind the same proxy shares one IP as far as express-rate-limit is
// concerned, and secure-cookie/HTTPS checks can be fooled by a spoofed
// X-Forwarded-Proto header — this must run before rate-limit/session/helmet.
//
// TRUST_PROXY is unset by default (safest: no proxy assumed, matches a local
// dev server talking directly to the client). Set it once you know your
// deployment's proxy topology: "1" for a single reverse proxy, a higher
// number for a known proxy chain length, or a specific subnet/IP per
// Express's `trust proxy` docs. Must not be "true" in production unless every
// client request truly passes through a proxy you control — "true" trusts
// X-Forwarded-For unconditionally, and the ORIGINAL Express default with the
// same risk is why this is opt-in, not automatic.
module.exports = function trustProxy(req, res, next) {
  if (config.trustProxy && req.app.get("trust proxy") !== config.trustProxy) {
    req.app.set("trust proxy", config.trustProxy);
  }
  next();
};
