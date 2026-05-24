import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const presetsDir = join(process.cwd(), "public", "presets");
const manifestPath = join(presetsDir, "manifest.json");

async function readManifest() {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(path, value) {
  await mkdir(presetsDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "PUT") {
    res.setHeader("Allow", "POST, PUT");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const preset = payload?.preset;
  const previousId = typeof payload?.previousId === "string" ? payload.previousId : null;
  const manifest = await readManifest();
  const nextPath = `public/presets/${preset.id}.json`;
  const filePath = join(process.cwd(), nextPath);

  await writeJson(filePath, preset);

  const nextEntries = Array.isArray(manifest.presets) ? [...manifest.presets] : [];
  const existingIndex = nextEntries.findIndex((entry) => entry.id === (previousId || preset.id));

  if (existingIndex >= 0) {
    nextEntries[existingIndex] = { id: preset.id, path: nextPath };
  } else {
    nextEntries.push({ id: preset.id, path: nextPath });
  }

  await writeJson(manifestPath, {
    ...manifest,
    presets: nextEntries,
  });

  res.status(200).json({ preset, manifest: { ...manifest, presets: nextEntries } });
}
