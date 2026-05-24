import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const PRESET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function resolveStoragePaths(root = process.cwd()) {
  const presetsDir = join(root, "public", "presets");
  return {
    presetsDir,
    manifestPath: join(presetsDir, "manifest.json"),
  };
}

function readJsonBody(req) {
  if (req.body == null) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new Error("Preset payload must be valid JSON.");
    }
  }

  return req.body;
}

function isValidPresetId(value) {
  return typeof value === "string" && PRESET_ID_PATTERN.test(value);
}

function normalizePresetPayload(preset) {
  if (!preset || typeof preset !== "object") {
    return preset;
  }

  return {
    ...preset,
    name: typeof preset?.name === "string" ? preset.name.trim() : "",
  };
}

function resolvePresetPath(root, presetId) {
  return {
    relativePath: `public/presets/${presetId}.json`,
    absolutePath: join(root, "public", "presets", `${presetId}.json`),
  };
}

async function readManifest(root) {
  const { manifestPath } = resolveStoragePaths(root);
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function deleteOldPresetFile(root, oldPath, nextPath) {
  if (oldPath === nextPath || typeof oldPath !== "string" || !oldPath.startsWith("public/presets/")) {
    return;
  }

  const absoluteOldPath = resolve(root, oldPath);
  const presetsRoot = resolve(root, "public", "presets");
  const relativePath = relative(presetsRoot, absoluteOldPath);
  const isInsidePresetsRoot = relativePath && !relativePath.startsWith("..") && !relativePath.includes(":");

  if (!isInsidePresetsRoot) {
    return;
  }

  await rm(absoluteOldPath, { force: true });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "PUT") {
      res.setHeader("Allow", "POST, PUT");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    const root = process.cwd();
    const payload = readJsonBody(req);
    const preset = normalizePresetPayload(payload?.preset);
    const previousId = typeof payload?.previousId === "string" ? payload.previousId.trim() : null;

    if (!preset || typeof preset !== "object") {
      res.status(400).json({ error: "Preset payload is required." });
      return;
    }

    if (!isValidPresetId(preset.id)) {
      res.status(400).json({ error: "Preset id must be a lowercase slug." });
      return;
    }

    if (!preset.name) {
      res.status(400).json({ error: "Preset name is required." });
      return;
    }

    if (previousId && !isValidPresetId(previousId)) {
      res.status(400).json({ error: "previousId must be a lowercase slug." });
      return;
    }

    const manifest = await readManifest(root);
    const nextEntries = Array.isArray(manifest.presets) ? [...manifest.presets] : [];
    const lookupId = req.method === "PUT" ? (previousId || preset.id) : preset.id;
    const existingIndex = nextEntries.findIndex((entry) => entry.id === lookupId);
    const conflictingIndex = nextEntries.findIndex((entry) => entry.id === preset.id);

    if (req.method === "POST" && conflictingIndex >= 0) {
      res.status(409).json({ error: "Preset id already exists." });
      return;
    }

    if (req.method === "PUT" && existingIndex < 0) {
      res.status(404).json({ error: "Preset to update was not found." });
      return;
    }

    if (req.method === "PUT" && conflictingIndex >= 0 && conflictingIndex !== existingIndex) {
      res.status(409).json({ error: "Preset id already exists." });
      return;
    }

    const { relativePath: nextPath, absolutePath: filePath } = resolvePresetPath(root, preset.id);
    await writeJson(filePath, preset);

    const existingEntry = existingIndex >= 0 ? nextEntries[existingIndex] : null;
    if (existingIndex >= 0) {
      nextEntries[existingIndex] = { id: preset.id, path: nextPath };
    } else {
      nextEntries.push({ id: preset.id, path: nextPath });
    }

    const nextManifest = {
      ...manifest,
      defaultPresetId: req.method === "PUT" && previousId === manifest.defaultPresetId
        ? preset.id
        : manifest.defaultPresetId,
      presets: nextEntries,
    };

    await writeJson(resolveStoragePaths(root).manifestPath, nextManifest);

    if (req.method === "PUT" && existingEntry) {
      await deleteOldPresetFile(root, existingEntry.path, nextPath);
    }

    res.status(200).json({ preset, manifest: nextManifest });
  } catch (error) {
    if (error instanceof Error && error.message === "Preset payload must be valid JSON.") {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to save preset.",
    });
  }
}
