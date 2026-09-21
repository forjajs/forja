import * as path from "node:path";
import { Command, Flags } from "@oclif/core";
import { resolveMigrationContext, type MigrationModule } from "../../../ormMigrationContext";

export default class OrmMigrateRollbackCommand extends Command {
  static description =
    "Roll back the most recently applied ORM migrations, in reverse order, by calling their down(ctx).";

  static flags = {
    steps: Flags.integer({ description: "Number of applied migrations to roll back", default: 1 }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(OrmMigrateRollbackCommand);
    const cwd = process.cwd();

    let ctx: Awaited<ReturnType<typeof resolveMigrationContext>>;
    try {
      ctx = await resolveMigrationContext(cwd);
    } catch (err) {
      this.error((err as Error).message);
    }

    const { migrationsDir, files, openRepository, migrationsRepo } = ctx;

    // Walk migrations newest-first, keep only the ones actually recorded as
    // applied (skips any migration file that was added but never migrated).
    const applied: string[] = [];
    for (const file of [...files].reverse()) {
      const id = file.replace(/\.js$/, "");
      if (await migrationsRepo.findById(id)) applied.push(file);
      if (applied.length === flags.steps) break;
    }

    if (applied.length === 0) {
      this.log("No applied migrations to roll back.");
      return;
    }

    for (const file of applied) {
      const id = file.replace(/\.js$/, "");
      const migration = require(path.join(migrationsDir, file)) as MigrationModule;

      if (typeof migration.down !== "function") {
        this.warn(`"${file}" has no down() — skipping, its _migrations record stays as applied.`);
        continue;
      }

      await migration.down({ openRepository });
      await migrationsRepo.delete(id);
      this.log(`rolled back ${file}`);
    }
  }
}
