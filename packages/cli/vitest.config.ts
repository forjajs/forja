import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several test files call process.chdir() to exercise CLI commands that
    // read process.cwd() (migrate, switch-driver, ...) — that's a mutation of
    // real global process state, not per-worker state, so running test files
    // in parallel races them against each other. Force everything sequential.
    fileParallelism: false,
  },
});
