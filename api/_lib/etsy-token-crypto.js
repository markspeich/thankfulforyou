import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = 1;

function requireKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Etsy encryption key must contain exactly 32 bytes.");
  return key;
}

export function readEtsyTokenEncryptionKey(env = process.env) {
  const encoded = env?.ETSY_TOKEN_ENCRYPTION_KEY;
  try {
    if (typeof encoded !== "string" || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error();
    const key = Buffer.from(encoded, "base64");
    if (key.toString("base64") !== encoded || key.length !== 32) throw new Error();
    return key;
  } catch {
    throw new Error("ETSY_TOKEN_ENCRYPTION_KEY must be base64 encoding of exactly 32 bytes.");
  }
}

export function encryptEtsySecret(plaintext, key) {
  requireKey(key);
  if (typeof plaintext !== "string") throw new TypeError("Etsy secret must be a string.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { version: VERSION, algorithm: ALGORITHM, iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptEtsySecret(envelope, key) {
  try {
    requireKey(key);
    if (envelope?.version !== VERSION || envelope?.algorithm !== ALGORITHM) throw new Error();
    const iv = Buffer.from(envelope.iv, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    if (iv.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt Etsy secret.");
  }
}

export function sealEtsyOAuthState(payload, key) {
  return Buffer.from(JSON.stringify(encryptEtsySecret(JSON.stringify(payload), key)), "utf8").toString("base64url");
}

export function openEtsyOAuthState(value, key) {
  try {
    const envelope = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return JSON.parse(decryptEtsySecret(envelope, key));
  } catch {
    throw new Error("Unable to open Etsy OAuth state.");
  }
}
