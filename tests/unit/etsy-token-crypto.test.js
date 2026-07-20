import { describe, expect, it } from "vitest";

import {
  decryptEtsySecret,
  encryptEtsySecret,
  openEtsyOAuthState,
  readEtsyTokenEncryptionKey,
  sealEtsyOAuthState,
} from "../../api/_lib/etsy-token-crypto.js";

const key = Buffer.alloc(32, 7);

describe("Etsy token crypto", () => {
  it("reads an exactly 32-byte base64 key", () => {
    expect(readEtsyTokenEncryptionKey({ ETSY_TOKEN_ENCRYPTION_KEY: key.toString("base64") })).toEqual(key);
    expect(() => readEtsyTokenEncryptionKey({ ETSY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") }))
      .toThrow("ETSY_TOKEN_ENCRYPTION_KEY must be base64 encoding of exactly 32 bytes.");
  });

  it("round-trips secrets with a fresh IV", () => {
    const first = encryptEtsySecret("access-token", key);
    const second = encryptEtsySecret("access-token", key);
    expect(decryptEtsySecret(first, key)).toBe("access-token");
    expect(first.iv).not.toBe(second.iv);
    expect(first).toMatchObject({ version: 1, algorithm: "aes-256-gcm" });
  });

  it("returns generic failures for wrong keys and tampered envelopes", () => {
    const envelope = encryptEtsySecret("access-token", key);
    expect(() => decryptEtsySecret(envelope, Buffer.alloc(32, 8))).toThrow("Unable to decrypt Etsy secret.");
    expect(() => decryptEtsySecret({ ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` }, key))
      .toThrow("Unable to decrypt Etsy secret.");
  });

  it("round-trips structured OAuth state", () => {
    const payload = { workspaceId: "workspace-1", nonce: "nonce-1", returnTo: "/orders" };
    expect(openEtsyOAuthState(sealEtsyOAuthState(payload, key), key)).toEqual(payload);
  });
});
