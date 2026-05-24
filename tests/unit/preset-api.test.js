import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalCwd = process.cwd();
const tempRoots = [];

async function createPresetWorkspace(manifest = null) {
  const root = await mkdtemp(join(tmpdir(), "preset-api-"));
  tempRoots.push(root);
  const presetsDir = join(root, "public", "presets");
  await mkdir(presetsDir, { recursive: true });
  await writeFile(
    join(presetsDir, "manifest.json"),
    `${JSON.stringify(manifest || {
      schemaVersion: 1,
      defaultPresetId: "all-candlepin",
      presets: [],
    }, null, 2)}\n`,
    "utf8",
  );
  return { root, presetsDir };
}

async function loadHandler() {
  vi.resetModules();
  const module = await import("../../api/presets.js");
  return module.default;
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
  };
}

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("preset persistence api", () => {
  it("rejects invalid preset ids before writing files", async () => {
    const { root, presetsDir } = await createPresetWorkspace();
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      body: {
        preset: {
          schemaVersion: 1,
          id: "../escape",
          name: "Escape",
          lineDefaults: { fontId: "candlepin" },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
          listingAssignments: [],
        },
      },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Preset id must be a lowercase slug." });
    const manifest = JSON.parse(await readFile(join(presetsDir, "manifest.json"), "utf8"));
    expect(manifest.presets).toEqual([]);
  });

  it("rejects post requests when the preset id already exists", async () => {
    const { root } = await createPresetWorkspace({
      schemaVersion: 1,
      defaultPresetId: "all-candlepin",
      presets: [{ id: "all-candlepin", path: "public/presets/all-candlepin.json" }],
    });
    await writeFile(join(root, "public", "presets", "all-candlepin.json"), "{\n  \"id\": \"all-candlepin\"\n}\n", "utf8");
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      body: {
        preset: {
          schemaVersion: 1,
          id: "all-candlepin",
          name: "All Candlepin",
          lineDefaults: { fontId: "candlepin" },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
          listingAssignments: [],
        },
      },
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: "Preset id already exists." });
  });

  it("requires put requests to target an existing preset id", async () => {
    const { root } = await createPresetWorkspace();
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      body: {
        previousId: "missing-preset",
        preset: {
          schemaVersion: 1,
          id: "renamed-preset",
          name: "Renamed Preset",
          lineDefaults: { fontId: "candlepin" },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
          listingAssignments: [],
        },
      },
    }, response);

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ error: "Preset to update was not found." });
  });

  it("writes a new preset file and manifest entry for a valid post", async () => {
    const { root, presetsDir } = await createPresetWorkspace();
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    const preset = {
      schemaVersion: 1,
      id: "skywalk-rn",
      name: "Skywalk RN",
      lineDefaults: { fontId: "skywalk" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "skywalk" } }],
      listingAssignments: [],
    };

    await handler({
      method: "POST",
      body: { preset },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.preset).toEqual(preset);
    const manifest = JSON.parse(await readFile(join(presetsDir, "manifest.json"), "utf8"));
    expect(manifest.presets).toEqual([
      { id: "skywalk-rn", path: "public/presets/skywalk-rn.json" },
    ]);
    const savedPreset = JSON.parse(await readFile(join(presetsDir, "skywalk-rn.json"), "utf8"));
    expect(savedPreset).toEqual(preset);
  });
});
