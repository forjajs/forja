import * as fs from "node:fs";
import * as path from "node:path";
import { Command, Args } from "@oclif/core";
import { requireOrmFeatureDir, resolveOrmDriver, repositoryCallArgs } from "../../ormDriver";

function toModelFileName(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export default class OrmNewCommand extends Command {
  static description = "Scaffold a new ORM model, wired to the driver already added via `forja add orm`.";

  static args = {
    name: Args.string({ required: true, description: "Model name, e.g. 'User'" }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(OrmNewCommand);
    const cwd = process.cwd();

    let ormFeatureDir: string;
    let driver: ReturnType<typeof resolveOrmDriver>;
    try {
      ormFeatureDir = requireOrmFeatureDir(cwd);
      driver = resolveOrmDriver(ormFeatureDir);
    } catch (err) {
      this.error((err as Error).message);
    }

    const modelName = toModelFileName(args.name);
    const modelsDir = path.join(ormFeatureDir, "models");
    const modelFilePath = path.join(modelsDir, `${modelName}.model.js`);

    if (fs.existsSync(modelFilePath)) {
      this.error(`"${modelFilePath}" already exists.`);
    }

    fs.mkdirSync(modelsDir, { recursive: true });

    const content = `const { defineModel, resolveEnv } = require("@forjajs/orm");
const createRepository = require("../driver.js"); // stable — never the driver's own file name
const config = require("../orm.config.js");

const env = resolveEnv(config);

/**
 * ${args.name} model — declare its fields below, they're validated on every
 * create()/update() before the driver ever sees the write.
 */
module.exports = (async () => {
  const repository = await createRepository(${repositoryCallArgs(driver, modelName)});
  return defineModel("${args.name}", {
    fields: {
      id: { type: "string", unique: true },
      // name: { type: "string", required: true },
    },
  }, repository);
})();
`;

    fs.writeFileSync(modelFilePath, content);
    this.log(`created ${path.relative(cwd, modelFilePath)}`);
    this.log(`usage: const ${args.name} = await require("./${path.relative(cwd, modelFilePath)}");`);
  }
}
