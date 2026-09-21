import { randomUUID } from "node:crypto";
import { testRepositoryContract } from "../contract/repositoryContract";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createMysqlRepository = require("../../templates/orm.mysql-repository.js");

// Defaults match docker-compose.test.yml — `docker compose -f
// docker-compose.test.yml up -d --wait` before running this suite.
const connectionUri = process.env.TEST_MYSQL_URL ?? "mysql://root@127.0.0.1:33061/orm_test";

testRepositoryContract("mysql", async () => {
  const tableName = `t_${randomUUID().replace(/-/g, "_")}`;
  return createMysqlRepository(connectionUri, tableName);
});
