const router = require("express").Router();

// DEMO ONLY — hand-rolled language detection just to prove the concept here.
// Not a pattern to copy into your own features. Once @forjajs/addon-i18n ships:
//   1. `forja add i18n` to install its global middleware.
//   2. Delete `translations` and the `/:lang(en|fr)` param below — the addon
//      parses the URL language for you.
//   3. Read `req.lang` (or the addon's translation helper) instead.
// Until then this file is yours to edit or delete freely, like any other route.
const translations = {
  en: { welcome: "Welcome to", tagline: "An app by Forja · Free by default, equipped by choice." },
  fr: { welcome: "Bienvenue sur", tagline: "Une app par Forja · Libre par défaut, équipé par choix." },
};

// "/" auto-detects via Accept-Language; "/fr" and "/en" force a language
// explicitly, same URL convention as NeoChess-Legacy's `/:language?/login`.
router.get(["/", "/:lang(en|fr)"], (req, res) => {
  const lang = req.params.lang || req.acceptsLanguages("fr", "en") || req.app.get("config").defaultLang;
  res.render("home", { appName: req.app.get("config").name, lang, t: translations[lang] });
});

module.exports = router;
