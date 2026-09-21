// Re-exported from @forjajs/contracts for backward compatibility with
// `import { contracts } from "@forjajs/core"` — the contracts themselves live
// in their own zero-dependency package now, since any non-HTTP addon (the ORM
// is the first) needs them without pulling in core's Express registry too.
export * as contracts from "@forjajs/contracts";
export * from "./registry";
export * from "./config";
