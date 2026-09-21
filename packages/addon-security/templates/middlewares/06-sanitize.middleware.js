const mongoSanitize = require("express-mongo-sanitize");

// Strips keys starting with "$" or containing "." from req.body/query/params
// — the NoSQL-operator-injection vector (e.g. {"email": {"$gt": ""}} bypassing
// a query meant to match a literal string). Defense-in-depth regardless of
// which @forjajs/orm driver is in use: cheap, has no effect on ordinary
// payloads, and SQL injection is a separate concern already handled by
// parameterized queries at the ORM/driver layer, not by this middleware.
module.exports = mongoSanitize();
