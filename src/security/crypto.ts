import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function resolveKey(keyMaterial: string): Buffer {
  const key = Buffer.from(keyMaterial, "base64");
  if (key.length !== 32) {
    throw new Error(
      "REDDIT_TOKEN_ENCRYPTION_KEY must be 32-byte base64. Generate with: openssl rand -base64 32"
    );
  }
  return key;
}

export function encryptString(plaintext: string, keyMaterial: string): string {
  const key = resolveKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptString(serialized: string, keyMaterial: string): string {
  const key = resolveKey(keyMaterial);
  const [ivB64, tagB64, payloadB64] = serialized.split(":");
  if (!ivB64 || !tagB64 || !payloadB64) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const payload = Buffer.from(payloadB64, "base64");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
  return plaintext.toString("utf8");
}
