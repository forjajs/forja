const cookieParser = require("cookie-parser");

// Must run before 06-session and 07-csrf — both read req.cookies, which only
// exists once this has parsed the raw Cookie header.
module.exports = cookieParser();
