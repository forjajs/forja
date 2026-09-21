import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { testRepositoryContract } from "../contract/repositoryContract";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createJsonRepository = require("../../templates/orm.@forjajs-json-driver-repository.js");

testRepositoryContract("json-driver", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orm-contract-json-"));
  const filePath = path.join(dir, `${randomUUID()}.json-driver`);
  return createJsonRepository(filePath);
});
