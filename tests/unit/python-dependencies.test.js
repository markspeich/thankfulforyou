import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function dependencyNamesFromRequirements(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/[<>=!~]/)[0].toLowerCase());
}

function dependencyNamesFromPyproject(source) {
  const dependenciesBlock = source.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (!dependenciesBlock) {
    return [];
  }

  return Array.from(dependenciesBlock[1].matchAll(/"([^"]+)"/g), (match) =>
    match[1].split(/[<>=!~]/)[0].toLowerCase(),
  );
}

describe("Python deployment dependencies", () => {
  test("keeps requirements.txt and pyproject.toml dependencies in sync", () => {
    const requirements = dependencyNamesFromRequirements(readFileSync("requirements.txt", "utf8"));
    const pyproject = dependencyNamesFromPyproject(readFileSync("pyproject.toml", "utf8"));

    expect(pyproject).toEqual(requirements);
  });
});