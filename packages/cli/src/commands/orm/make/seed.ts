import * as fs from "node:fs";
import * as path from "node:path";
import { Command, Args, Flags } from "@oclif/core";
import { requireOrmFeatureDir } from "../../../ormDriver";

export default class OrmMakeSeedCommand extends Command {
  static description = "Scaffold a new ORM seed file, auto-filled from the model's declared schema.";

  static args = {
    name: Args.string({ required: true, description: "Seed name, matches an existing model, e.g. 'user'" }),
  };

  static flags = {
    count: Flags.integer({ description: "Number of fake records to generate", default: 5 }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(OrmMakeSeedCommand);
    const cwd = process.cwd();

    let ormFeatureDir: string;
    try {
      ormFeatureDir = requireOrmFeatureDir(cwd);
    } catch (err) {
      this.error((err as Error).message);
    }

    const modelFilePath = path.join(ormFeatureDir, "models", `${args.name}.model.js`);
    if (!fs.existsSync(modelFilePath)) {
      this.error(`"${modelFilePath}" doesn't exist — run "forja orm new ${args.name}" first.`);
    }

    const seedsDir = path.join(ormFeatureDir, "seeds");
    fs.mkdirSync(seedsDir, { recursive: true });

    // Numbered prefix, like migrations: lets the user control seed order when
    // relations mean a related model must be seeded first.
    const existing = fs.readdirSync(seedsDir).filter((f) => f.endsWith(".seed.js"));
    const nextNumber = String(existing.length + 1).padStart(4, "0");
    const filePath = path.join(seedsDir, `${nextNumber}_${args.name}.seed.js`);

    const content = `const { fakeFromSchema } = require("@forjajs/orm");

/**
 * Seed: ${args.name}
 * Auto-fills ${flags.count} fake records from the model's declared schema —
 * runs for whatever NODE_ENV is active when "forja orm seed" is invoked
 * (point it at "test" for TI fixtures, "development" for local demo data).
 *
 * Relation fields are resolved by picking a random existing record from the
 * related model — that model must be seeded first (rename this file's numeric
 * prefix if you need to reorder it relative to other seeds).
 */
module.exports = async function seed() {
  const ${args.name} = await require("../models/${args.name}.model.js");

  const relatedCache = {};
  async function resolveRelation(field, relation) {
    if (!relatedCache[relation.model]) {
      const relatedModelName = relation.model.charAt(0).toLowerCase() + relation.model.slice(1);
      const relatedModel = await require(\`../models/\${relatedModelName}.model.js\`);
      relatedCache[relation.model] = await relatedModel.findAll();
    }
    const docs = relatedCache[relation.model];
    if (docs.length === 0) {
      throw new Error(\`Seed "${args.name}" needs at least one "\${relation.model}" record — seed it first.\`);
    }
    if (relation.kind === "hasMany") {
      const count = 1 + Math.floor(Math.random() * Math.min(3, docs.length));
      return Array.from({ length: count }, () => docs[Math.floor(Math.random() * docs.length)].id);
    }
    return docs[Math.floor(Math.random() * docs.length)].id;
  }

  for (let i = 0; i < ${flags.count}; i++) {
    await ${args.name}.create(await fakeFromSchema(${args.name}.schema, resolveRelation));
  }
};
`;

    fs.writeFileSync(filePath, content);
    this.log(`created ${path.relative(cwd, filePath)}`);
  }
}
