import { randomUUID } from "node:crypto";
import { testRepositoryContract } from "../contract/repositoryContract";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createMongoRepository = require("../../templates/orm.mongodb-repository.js");

// Defaults match docker-compose.test.yml — `docker compose -f
// docker-compose.test.yml up -d --wait` before running this suite.
const uri = process.env.TEST_MONGODB_URL ?? "mongodb://127.0.0.1:27017/?replicaSet=rs0";

testRepositoryContract("mongodb", async () => {
  const collectionName = `t_${randomUUID().replace(/-/g, "_")}`;
  return createMongoRepository(uri, "orm_test", collectionName);
});
