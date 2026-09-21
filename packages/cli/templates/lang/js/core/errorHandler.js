// Mounted last, after every route registered by routeRegistry — reached once
// nothing else matched (notFoundHandler) or a handler threw (errorHandler).
// Renders a view when a view engine is configured (forja.view.json present —
// see app.js), JSON otherwise (API-only, or a SPA frontend rendering its own
// error UI) — either way this is a starting point, not a fixed contract, free
// to edit or replace since nothing else depends on its exact shape.

function renderOrJson(req, res, view, locals, json) {
  if (!req.app.get("view engine")) {
    res.json(json);
    return;
  }

  // Falls back to JSON instead of letting a missing/broken view template
  // throw here too — that would otherwise recurse straight back into this
  // same error handler.
  res.render(view, locals, (err, html) => {
    if (err) {
      res.json(json);
      return;
    }
    res.send(html);
  });
}

function notFoundHandler(req, res) {
  const appName = req.app.get("config")?.name;
  res.status(404);
  renderOrJson(req, res, "404", { appName }, { error: "not_found" });
}

// Express recognizes an error-handling middleware by its 4-argument arity —
// removing any of these four parameters (even the unused `next`) silently
// breaks the contract and this stops being called at all.
function errorHandler(err, req, res, next) {
  console.error(err);

  const appName = req.app.get("config")?.name;
  const status = err.status || 500;
  // Never leak an internal error's message/stack to the client in production
  // — only its shape (status code) is safe to expose by default.
  const message = process.env.NODE_ENV === "production" ? "internal_server_error" : err.message || "internal_server_error";

  res.status(status);
  renderOrJson(req, res, "error", { appName, status, message }, { error: message });
}

module.exports = { notFoundHandler, errorHandler };
