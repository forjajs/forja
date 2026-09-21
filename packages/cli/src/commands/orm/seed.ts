import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "@oclif/core";
import { requireOrmFeatureDir } from "../../ormDriver";

type SeedFn = () => Promise<void>;

export default class OrmSeedCommand extends Command {
  static description = "Run all ORM seed files for the current environment (NODE_ENV).";

  async run(): Promise<void> {
    const cwd = process.cwd();

    let ormFeatureDir: string;
    try {
      ormFeatureDir = requireOrmFeatureDir(cwd);
    } catch (err) {
      this.error((err as Error).message);
    }

    const seedsDir = path.join(ormFeatureDir, "seeds");
    if (!fs.existsSync(seedsDir)) {
      this.log("No seeds directory — nothing to do.");
      return;
    }

    const files = fs.readdirSync(seedsDir).filter((f) => f.endsWith(".seed.js")).sort();
    if (files.length === 0) {
      this.log("No seed files — nothing to do.");
      return;
    }

    for (const file of files) {
      const seed = require(path.join(seedsDir, file)) as SeedFn;
      await seed();
      this.log(`seeded ${file}`);
    }
  }
}
