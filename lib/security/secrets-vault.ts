import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "../errors";

if (typeof window !== "undefined") {
  throw new Error("secrets-vault can only execute in a server context.");
}

const AAD = Buffer.from("punchpay:ai_credential:v1", "utf8");
const cachedKeysByPath = new Map<string, Buffer>();

function isHostedEnvironment(): boolean {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(
    process.env.VERCEL === "1" ||
      (supabaseUrl && supabaseKey) ||
      process.env.PUNCHPAY_REQUIRE_SESSION_SECRET === "1"
  );
}

function resolveKeyFilePath(): string {
  if (process.env.PUNCHPAY_VAULT_KEY_PATH?.trim()) {
    return process.env.PUNCHPAY_VAULT_KEY_PATH.trim();
  }
  const dbPath =
    process.env.PUNCHPAY_DB_PATH || path.join(process.cwd(), ".data", "punchpay.db");
  return path.join(path.dirname(dbPath), ".vault", "credential-master.key");
}

function getMasterKey(): Buffer {
  const envKey = (
    process.env.PUNCHPAY_CREDENTIAL_ENCRYPTION_KEY ||
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    ""
  ).trim();
  if (envKey) {
    if (envKey.length < 16) {
      throw new HttpError(
        500,
        "PUNCHPAY_CREDENTIAL_ENCRYPTION_KEY must be at least 16 characters long."
      );
    }
    return crypto.createHash("sha256").update(`punchpay-vault:${envKey}`, "utf8").digest();
  }

  if (isHostedEnvironment()) {
    throw new HttpError(
      500,
      "PUNCHPAY_CREDENTIAL_ENCRYPTION_KEY must be configured on hosted deployments to store encrypted API credentials."
    );
  }

  const keyFile = resolveKeyFilePath();
  const cached = cachedKeysByPath.get(keyFile);
  if (cached) return cached;

  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  try {
    const existingHex = fs.readFileSync(keyFile, "utf8").trim();
    if (/^[0-9a-f]{64}$/i.test(existingHex)) {
      const buf = Buffer.from(existingHex, "hex");
      cachedKeysByPath.set(keyFile, buf);
      return buf;
    }
  } catch {
    // Generate separate local keyfile on first encrypted write/read
  }

  const fresh = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, fresh.toString("hex"), { mode: 0o600 });
  cachedKeysByPath.set(keyFile, fresh);
  return fresh;
}

export interface EncryptedSecretEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encryptCredential(plaintext: string): string {
  const clean = plaintext.trim();
  if (!clean) {
    throw new HttpError(400, "API key value cannot be empty.");
  }
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(clean, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: EncryptedSecretEnvelope = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptCredential(serialized: string): string {
  let parsed: Partial<EncryptedSecretEnvelope>;
  try {
    parsed = JSON.parse(serialized) as Partial<EncryptedSecretEnvelope>;
  } catch {
    throw new HttpError(500, "Stored credential payload is malformed.");
  }
  if (
    parsed.v !== 1 ||
    parsed.alg !== "aes-256-gcm" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new HttpError(500, "Unsupported encrypted credential format.");
  }
  const key = getMasterKey();
  try {
    const iv = Buffer.from(parsed.iv, "base64");
    const tag = Buffer.from(parsed.tag, "base64");
    const ciphertext = Buffer.from(parsed.ciphertext, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new HttpError(
      500,
      "Unable to decrypt stored AI credential with the active encryption key."
    );
  }
}

export function clearVaultCacheForTests(): void {
  cachedKeysByPath.clear();
}
