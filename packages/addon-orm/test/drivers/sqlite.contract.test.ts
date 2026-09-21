import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { testRepositoryContract } from "../contract/repositoryContract";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createSqliteRepository = require("../../templates/orm.sqlite-repository.js");

testRepositoryContract("sqlite", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orm-contract-sqlite-"));
  const filePath = path.join(dir, "test.sqlite3");
  const tableName = `t_${randomUUID().replace(/-/g, "_")}`;
  return createSqliteRepository(filePath, tableName);
});
