import * as fs from "node:fs";
import * as path from "node:path";
import { Command, Args } from "@oclif/core";
import prompts from "prompts";
import { copyLayer, mergeFragment } from "../scaffold";
import { addAddon, AddAddonError } from "../addAddon";

interface JsonObject {
  [key: string]: unknown;
}

interface ForjaDriver {
  package: string;
}

function ormDriverChoices(): { title: string; value: string }[] {
  try {
    const ormPackageJsonPath = require.resolve("@forjajs/orm/package.json");
    const ormPackageJson = JSON.parse(fs.readFileSync(ormPackageJsonPath, "utf8")) as JsonObject;
    const forjaDrivers = (ormPackageJson.forjaDrivers as Record<string, ForjaDriver>) ?? {};
    return Object.entries(forjaDrivers).map(([name, driver]) => ({
      title: `${name} (${driver.package})`,
      value: name,
    }));
  } catch {
    return [];
  }
}

const TEMPLATES_DIR = path.join(__dirname, "..", "..", "templates");

const RENDER_CHOICES = [
  { title: "Server views — EJS", value: "ejs" },
  { title: "Server views — Pug", value: "pug" },
  { title: "Server views — Handlebars", value: "handlebars" },
  { title: "Frontend SPA — React", value: "react" },
  { title: "Frontend SPA — Vue", value: "vue" },
  { title: "Frontend SPA — Svelte", value: "svelte" },
  { title: "None (API only)", value: "none" },
];

export default class NewCommand extends Command {
  static description = "Scaffold a new Forja project (asks stack questions).";

  static args = {
    name: Args.string({ required: true, description: "Project directory name" }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(NewCommand);
    const targetDir = path.join(process.cwd(), args.name);

    if (fs.existsSync(targetDir)) {
      this.error(`"${targetDir}" already exists.`);
    }

    const answers = await prompts(
      [
        {
          type: "select",
          name: "lang",
          message: "Language",
          choices: [
            { title: "TypeScript", value: "ts" },
            { title: "JavaScript", value: "js" },
          ],
        },
        {
          type: "select",
          name: "render",
          message: "How should pages be served? (SSR and a SPA frontend are mutually exclusive)",
          choices: RENDER_CHOICES,
        },
        {
          type: "select",
          name: "css",
          message: "Styling",
          choices: [
            { title: "SCSS", value: "scss" },
            { title: "Tailwind CSS", value: "tailwind" },
            { title: "None", value: "none" },
          ],
        },
        {
          type: "select",
          name: "tests",
          message: "Test runner",
          choices: [
            { title: "Vitest", value: "vitest" },
            { title: "Jest", value: "jest" },
            { title: "None", value: "none" },
          ],
        },
        {
          type: "confirm",
          name: "orm",
          message: "Add the ORM addon (@forjajs/orm)?",
          initial: false,
        },
        {
          type: (prev: boolean) => (prev ? "select" : null),
          name: "ormDriver",
          message: "Which storage driver?",
          choices: ormDriverChoices(),
        },
        {
          type: "confirm",
          name: "security",
          message: "Add the security addon (@forjajs/addon-security) — helmet, CORS, sessions, rate limiting, CSRF? (Recommended)",
          initial: true,
        },
      ],
      {
        onCancel: () => {
          this.error("Aborted.");
        },
      }
    );

    fs.mkdirSync(targetDir, { recursive: true });

    const layers = [
      path.join(TEMPLATES_DIR, "base"),
      path.join(TEMPLATES_DIR, "lang", answers.lang),
      path.join(TEMPLATES_DIR, "render", answers.render),
      path.join(TEMPLATES_DIR, "css", answers.css),
      path.join(TEMPLATES_DIR, "tests", answers.tests),
    ];

    let pkg: Record<string, unknown> = { name: args.name };

    for (const layer of layers) {
      copyLayer(layer, targetDir);
      pkg = mergeFragment(pkg, layer);
    }

    fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

    this.log(`\nForja project created at ${targetDir}`);
    this.log(`  language: ${answers.lang}`);
    this.log(`  render:   ${answers.render}`);
    this.log(`  css:      ${answers.css}`);
    this.log(`  tests:    ${answers.tests}`);

    if (answers.orm) {
      try {
        addAddon({
          cwd: targetDir,
          preset: "orm",
          driverName: answers.ormDriver,
          withExample: true, // fresh scaffold, nothing to conflict with yet
          log: (message) => this.log(message),
          warn: (message) => this.warn(message),
        });
      } catch (err) {
        if (err instanceof AddAddonError) {
          this.warn(`Could not add the ORM addon: ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    if (answers.security) {
      try {
        addAddon({
          cwd: targetDir,
          preset: "security",
          log: (message) => this.log(message),
          warn: (message) => this.warn(message),
        });
      } catch (err) {
        if (err instanceof AddAddonError) {
          this.warn(`Could not add the security addon: ${err.message}`);
        } else {
          throw err;
        }
      }
    }
  }
}
