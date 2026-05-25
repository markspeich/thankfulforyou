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
      defaultPresetId: "preset-a1f4c8e2b601",
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

async function writePresetFile(root, preset) {
  await writeFile(
    join(root, "public", "presets", `${preset.id}.json`),
    `${JSON.stringify(preset, null, 2)}\n`,
    "utf8",
  );
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
  it("classifies malformed json request bodies as client errors", async () => {
    const { root } = await createPresetWorkspace();
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      body: "{not-json",
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Preset payload must be valid JSON." });
  });

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

  it("rejects presets whose trimmed names are empty", async () => {
    const { root, presetsDir } = await createPresetWorkspace();
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      body: {
        preset: {
          schemaVersion: 1,
          id: "blank-name",
          name: "   ",
          lineDefaults: { fontId: "candlepin" },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
          listingAssignments: [],
        },
      },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Preset name is required." });
    const manifest = JSON.parse(await readFile(join(presetsDir, "manifest.json"), "utf8"));
    expect(manifest.presets).toEqual([]);
  });

  it("rejects post requests when the preset id already exists", async () => {
    const { root } = await createPresetWorkspace({
      schemaVersion: 1,
      defaultPresetId: "preset-a1f4c8e2b601",
      presets: [{ id: "preset-a1f4c8e2b601", path: "public/presets/preset-a1f4c8e2b601.json" }],
    });
    await writeFile(join(root, "public", "presets", "preset-a1f4c8e2b601.json"), "{\n  \"id\": \"preset-a1f4c8e2b601\"\n}\n", "utf8");
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "POST",
      body: {
        preset: {
          schemaVersion: 1,
          id: "preset-a1f4c8e2b601",
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

  it("renames an existing preset on put and updates the manifest entry", async () => {
    const existingPreset = {
      schemaVersion: 1,
      id: "skywalk-rn",
      name: "Skywalk RN",
      lineDefaults: { fontId: "skywalk" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "skywalk" } }],
      listingAssignments: [],
    };
    const { root, presetsDir } = await createPresetWorkspace({
      schemaVersion: 1,
      defaultPresetId: "skywalk-rn",
      presets: [{ id: "skywalk-rn", path: "public/presets/skywalk-rn.json" }],
    });
    await writePresetFile(root, existingPreset);
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    const renamedPreset = {
      ...existingPreset,
      id: "skywalk-rn-updated",
      name: "Skywalk RN Updated",
    };

    await handler({
      method: "PUT",
      body: {
        previousId: "skywalk-rn",
        preset: renamedPreset,
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.preset).toEqual(renamedPreset);
    const manifest = JSON.parse(await readFile(join(presetsDir, "manifest.json"), "utf8"));
    expect(manifest.presets).toEqual([
      { id: "skywalk-rn-updated", path: "public/presets/skywalk-rn-updated.json" },
    ]);
    await expect(readFile(join(presetsDir, "skywalk-rn-updated.json"), "utf8")).resolves.toContain("\"Skywalk RN Updated\"");
  });

  it("updates the default preset id when renaming the current default preset", async () => {
    const defaultPreset = {
      schemaVersion: 1,
      id: "skywalk-rn",
      name: "Skywalk RN",
      lineDefaults: { fontId: "skywalk" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "skywalk" } }],
      listingAssignments: [],
    };
    const secondaryPreset = {
      schemaVersion: 1,
      id: "preset-a1f4c8e2b601",
      name: "All Candlepin",
      lineDefaults: { fontId: "candlepin" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
      listingAssignments: [],
    };
    const { root, presetsDir } = await createPresetWorkspace({
      schemaVersion: 1,
      defaultPresetId: "skywalk-rn",
      presets: [
        { id: "preset-a1f4c8e2b601", path: "public/presets/preset-a1f4c8e2b601.json" },
        { id: "skywalk-rn", path: "public/presets/skywalk-rn.json" },
      ],
    });
    await writePresetFile(root, defaultPreset);
    await writePresetFile(root, secondaryPreset);
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      body: {
        previousId: "skywalk-rn",
        preset: {
          ...defaultPreset,
          id: "skywalk-rn-renamed",
          name: "Skywalk RN Renamed",
        },
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.manifest.defaultPresetId).toBe("skywalk-rn-renamed");
    const manifest = JSON.parse(await readFile(join(presetsDir, "manifest.json"), "utf8"));
    expect(manifest.defaultPresetId).toBe("skywalk-rn-renamed");
    expect(manifest.presets).toEqual([
      { id: "preset-a1f4c8e2b601", path: "public/presets/preset-a1f4c8e2b601.json" },
      { id: "skywalk-rn-renamed", path: "public/presets/skywalk-rn-renamed.json" },
    ]);
  });

  it("rejects put renames that would collide with another preset id", async () => {
    const { root } = await createPresetWorkspace({
      schemaVersion: 1,
      defaultPresetId: "skywalk-rn",
      presets: [
        { id: "skywalk-rn", path: "public/presets/skywalk-rn.json" },
        { id: "preset-a1f4c8e2b601", path: "public/presets/preset-a1f4c8e2b601.json" },
      ],
    });
    await writePresetFile(root, {
      schemaVersion: 1,
      id: "skywalk-rn",
      name: "Skywalk RN",
      lineDefaults: { fontId: "skywalk" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "skywalk" } }],
      listingAssignments: [],
    });
    await writePresetFile(root, {
      schemaVersion: 1,
      id: "preset-a1f4c8e2b601",
      name: "All Candlepin",
      lineDefaults: { fontId: "candlepin" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "candlepin" } }],
      listingAssignments: [],
    });
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      body: {
        previousId: "skywalk-rn",
        preset: {
          schemaVersion: 1,
          id: "preset-a1f4c8e2b601",
          name: "Collision",
          lineDefaults: { fontId: "skywalk" },
          lineRules: [{ match: { kind: "all" }, settings: { fontId: "skywalk" } }],
          listingAssignments: [],
        },
      },
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ error: "Preset id already exists." });
  });

  it("removes the old preset file after a successful rename", async () => {
    const existingPreset = {
      schemaVersion: 1,
      id: "skywalk-rn",
      name: "Skywalk RN",
      lineDefaults: { fontId: "skywalk" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "skywalk" } }],
      listingAssignments: [],
    };
    const { root, presetsDir } = await createPresetWorkspace({
      schemaVersion: 1,
      defaultPresetId: "skywalk-rn",
      presets: [{ id: "skywalk-rn", path: "public/presets/skywalk-rn.json" }],
    });
    await writePresetFile(root, existingPreset);
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      body: {
        previousId: "skywalk-rn",
        preset: {
          ...existingPreset,
          id: "skywalk-rn-final",
          name: "Skywalk RN Final",
        },
      },
    }, response);

    expect(response.statusCode).toBe(200);
    await expect(readFile(join(presetsDir, "skywalk-rn.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(presetsDir, "skywalk-rn-final.json"), "utf8")).resolves.toContain("\"Skywalk RN Final\"");
  });

  it("does not delete crafted manifest paths outside the presets directory during rename cleanup", async () => {
    const existingPreset = {
      schemaVersion: 1,
      id: "skywalk-rn",
      name: "Skywalk RN",
      lineDefaults: { fontId: "skywalk" },
      lineRules: [{ match: { kind: "all" }, settings: { fontId: "skywalk" } }],
      listingAssignments: [],
    };
    const { root } = await createPresetWorkspace({
      schemaVersion: 1,
      defaultPresetId: "skywalk-rn",
      presets: [{ id: "skywalk-rn", path: "public/presets/../presets-evil/secret.json" }],
    });
    await mkdir(join(root, "public", "presets-evil"), { recursive: true });
    await writeFile(
      join(root, "public", "presets-evil", "secret.json"),
      "{\"keep\":true}\n",
      "utf8",
    );
    process.chdir(root);
    const handler = await loadHandler();
    const response = createResponseRecorder();

    await handler({
      method: "PUT",
      body: {
        previousId: "skywalk-rn",
        preset: {
          ...existingPreset,
          id: "skywalk-rn-safe",
          name: "Skywalk RN Safe",
        },
      },
    }, response);

    expect(response.statusCode).toBe(200);
    await expect(readFile(join(root, "public", "presets-evil", "secret.json"), "utf8")).resolves.toContain("\"keep\":true");
  });
});
