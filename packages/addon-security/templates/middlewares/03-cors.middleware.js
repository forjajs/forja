const cors = require("cors");
const config = require("../../features/security/security.config.js");

// config.corsOrigin is undefined in dev if CORS_ORIGIN is unset (cross-origin
// simply disabled, never silently opened to "*") and createConfig already
// throws at boot in production if it's missing — no fallback needed here.
module.exports = cors({
  origin: config.corsOrigin ?? false,
  credentials: true,
});
