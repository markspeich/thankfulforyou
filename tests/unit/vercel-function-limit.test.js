import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Vercel Hobby deployment", () => {
  it("keeps direct API entrypoints within the 12-function limit", async () => {
    const entries = await readdir(new URL("../../api/", import.meta.url), { withFileTypes: true });
    const ignored = new Set((await readFile(new URL("../../.vercelignore", import.meta.url), "utf8"))
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("api/"))
      .map((entry) => entry.slice("api/".length)));
    const functions = entries
      .filter((entry) => entry.isFile()
        && !entry.name.startsWith("_")
        && /\.(?:js|py)$/.test(entry.name)
        && !ignored.has(entry.name))
      .map((entry) => entry.name)
      .sort();

    expect(functions, `Vercel functions: ${functions.join(", ")}`).toHaveLength(12);
  });
});
