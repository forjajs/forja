import "dotenv/config";
import { createConfig } from "@forjajs/core";

// Add fields here as your project needs them (session secrets, DB URL...) — this
// is your project's own config, not something Forja imposes a fixed shape for.
export default createConfig({
  env: { env: "NODE_ENV", default: "development" },
  name: { env: "APP_NAME", default: "forja-app" },
  host: { env: "HOST", default: "localhost" },
  port: { env: "PORT", default: 3000, parse: Number },
  defaultLang: { env: "DEFAULT_LANG", default: "en" },
});
