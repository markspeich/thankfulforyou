import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/db/**/*.db.test.js"],
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
