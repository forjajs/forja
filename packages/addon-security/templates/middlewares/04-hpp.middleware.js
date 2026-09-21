const hpp = require("hpp");

// Guards against HTTP Parameter Pollution (?role=user&role=admin) — without
// this, which value req.query.role resolves to is driven by the parser, not
// by anything the app decided.
module.exports = hpp();
