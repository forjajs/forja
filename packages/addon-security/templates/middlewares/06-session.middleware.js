const session = require("express-session");
const config = require("../../features/security/security.config.js");

// Session cookie config that @forjajs/addon-auth's guard (`req.session?.userId`)
// relies on — no addon previously set express-session up, so `forja add auth`
// alone did not actually give you a working session. This closes that gap.
// SESSION_SECRET is required — security.config.js already throws at boot if
// it's missing, no fallback needed here.
module.exports = session({
  name: config.sessionName,
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: config.sessionMaxAgeMs,
  },
});
