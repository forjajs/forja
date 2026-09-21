import { randomUUID } from "node:crypto";
import { testRepositoryContract } from "../contract/repositoryContract";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createPostgresRepository = require("../../templates/orm.postgres-repository.js");

// Defaults match docker-compose.test.yml — `docker compose -f
// docker-compose.test.yml up -d --wait` before running this suite.
const connectionString = process.env.TEST_POSTGRES_URL ?? "postgres://postgres@127.0.0.1:54321/orm_test";

testRepositoryContract("postgres", async () => {
  const tableName = `t_${randomUUID().replace(/-/g, "_")}`;
  return createPostgresRepository(connectionString, tableName);
});
