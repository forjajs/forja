import * as fs from "node:fs";
import * as path from "node:path";
import { Command, Args, Flags } from "@oclif/core";
import { addAddon, AddAddonError, OFFICIAL_PRESETS, type Preset } from "../addAddon";

export default class AddCommand extends Command {
  static description = "Plug an official Forja addon/preset into the current project.";

  static args = {
    preset: Args.string({
      required: true,
      description: `Addon to add (${OFFICIAL_PRESETS.join(", ")}) — security is recommended for every project.`,
      options: OFFICIAL_PRESETS as unknown as string[],
    }),
  };

  static flags = {
    driver: Flags.string({
      description: "Storage driver to wire in (only relevant for `orm`, e.g. json-driver).",
    }),
    example: Flags.boolean({
      description:
        "Generate the starter example too (a User model, plus register/login if a view engine is configured). " +
        "Off by default here — this command runs against a project you've likely already built on, so it never " +
        "assumes you want demo files; `forja new` turns this on automatically since there's nothing to conflict with yet.",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AddCommand);
    const preset = args.preset as Preset;

    const cwd = process.cwd();
    if (!fs.existsSync(path.join(cwd, "package.json"))) {
      this.error(`No package.json found in "${cwd}" — run this inside a Forja project.`);
    }

    try {
      addAddon({
        cwd,
        preset,
        driverName: flags.driver,
        withExample: flags.example,
        log: (message) => this.log(message),
        warn: (message) => this.warn(message),
      });
    } catch (err) {
      if (err instanceof AddAddonError) {
        this.error(err.message);
      }
      throw err;
    }
  }
}
