import { readFile, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const encoder = new TextEncoder();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeUint32(buffer, offset, value) { buffer.writeUInt32LE(value >>> 0, offset); }

function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, contents } of entries) {
    const nameBuffer = encoder.encode(name);
    const source = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const compressed = deflateRawSync(source);
    const crc = crc32(source);
    const local = Buffer.alloc(30 + nameBuffer.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    writeUint32(local, 14, crc); writeUint32(local, 18, compressed.length); writeUint32(local, 22, source.length);
    local.writeUInt16LE(nameBuffer.length, 26); local.writeUInt16LE(0, 28); Buffer.from(nameBuffer).copy(local, 30); compressed.copy(local, 30 + nameBuffer.length);
    locals.push(local);
    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); writeUint32(central, 16, crc);
    writeUint32(central, 20, compressed.length); writeUint32(central, 24, source.length); central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    writeUint32(central, 38, 0); writeUint32(central, 42, offset); Buffer.from(nameBuffer).copy(central, 46);
    centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); writeUint32(end, 12, centralSize); writeUint32(end, 16, offset); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = await readFile(new URL("./amazon-customization-v3.json", import.meta.url));
  await writeFile(new URL("./amazon-customization.zip", import.meta.url), createZip([
    { name: "customization.json", contents: json },
    { name: "metadata.xml", contents: "<metadata />" },
    { name: "preview.jpg", contents: "synthetic preview" },
    { name: "preview.svg", contents: "<svg />" },
  ]));
}

export { createZip };
