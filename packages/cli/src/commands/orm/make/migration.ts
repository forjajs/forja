import * as fs from "node:fs";
import * as path from "node:path";
import { Command, Args } from "@oclif/core";
import { requireOrmFeatureDir } from "../../../ormDriver";

export default class OrmMakeMigrationCommand extends Command {
  static description = "Scaffold a new ORM migration file.";

  static args = {
    name: Args.string({ required: true, description: "Migration name, e.g. 'add_age_to_user'" }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(OrmMakeMigrationCommand);
    const cwd = process.cwd();

    let ormFeatureDir: string;
    try {
      ormFeatureDir = requireOrmFeatureDir(cwd);
    } catch (err) {
      this.error((err as Error).message);
    }

    const migrationsDir = path.join(ormFeatureDir, "migrations");
    fs.mkdirSync(migrationsDir, { recursive: true });

    const existing = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".js"));
    const nextNumber = String(existing.length + 1).padStart(4, "0");
    const fileName = `${nextNumber}_${args.name}.js`;
    const filePath = path.join(migrationsDir, fileName);

    const content = `/**
 * Migration: ${args.name}
 * Transforms already-written documents — json-driver has no schema to ALTER,
 * so a migration here means: read existing docs via ctx.openRepository(name),
 * write them back changed.
 */
module.exports = {
  async up(ctx) {
    // const users = await ctx.openRepository("user");
    // const docs = await users.findAll();
    // for (const doc of docs) {
    //   await users.update(doc.id, { ...doc, newField: "default" });
    // }
  },

  async down(ctx) {
    // reverse the change made in up()
  },
};
`;

    fs.writeFileSync(filePath, content);
    this.log(`created ${path.relative(cwd, filePath)}`);
  }
}
