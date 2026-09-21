import * as path from "node:path";
import { Command } from "@oclif/core";
import { resolveMigrationContext, type MigrationModule } from "../../ormMigrationContext";

export default class OrmMigrateCommand extends Command {
  static description = "Apply pending ORM migrations for the current environment (NODE_ENV).";

  async run(): Promise<void> {
    const cwd = process.cwd();

    let ctx: Awaited<ReturnType<typeof resolveMigrationContext>>;
    try {
      ctx = await resolveMigrationContext(cwd);
    } catch (err) {
      this.error((err as Error).message);
    }

    const { migrationsDir, files, openRepository, migrationsRepo } = ctx;
    if (files.length === 0) {
      this.log("No migrations directory — nothing to do.");
      return;
    }

    let appliedCount = 0;

    for (const file of files) {
      const id = file.replace(/\.js$/, "");
      const already = await migrationsRepo.findById(id);
      if (already) continue;

      const migration = require(path.join(migrationsDir, file)) as MigrationModule;
      await migration.up({ openRepository });
      await migrationsRepo.create({ id, appliedAt: new Date().toISOString() });
      this.log(`applied ${file}`);
      appliedCount++;
    }

    if (appliedCount === 0) {
      this.log("Already up to date.");
    }
  }
}
