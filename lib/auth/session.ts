import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { getOllamaConfig, probeOllamaHealth } from "../ai/provider";
import { getRepo, isSupabaseConfigured } from "../db";
import { DEMO_ACCOUNTS, hashPassword, verifyPassword } from "../db/sqlite";
import { HttpError } from "../errors";
import { getPayPalClientConfig } from "../payments/paypal-client";
import { getConfiguredPaymentMode } from "../payments/simulator";
import type { AIProviderType, Profile, SystemConfigStatus, UserRole } from "../types";

export const SESSION_COOKIE_NAME = "punchpay_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

let cachedLocalSecret: string | null = null;

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16) {
    return process.env.SESSION_SECRET;
  }
  if (
    process.env.VERCEL === "1" ||
    isSupabaseConfigured() ||
    process.env.PUNCHPAY_REQUIRE_SESSION_SECRET === "1"
  ) {
    throw new HttpError(
      500,
      "SESSION_SECRET environment variable must be configured (min 16 characters) in hosted environments."
    );
  }
  if (cachedLocalSecret) return cachedLocalSecret;
  const dbPath =
    process.env.PUNCHPAY_DB_PATH || path.join(process.cwd(), ".data", "punchpay.db");
  const secretPath = path.join(path.dirname(dbPath), ".session-secret");
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing.length >= 32) {
      cachedLocalSecret = existing;
      return existing;
    }
  } catch {
    // Generate on first run
  }
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  cachedLocalSecret = generated;
  return generated;
}

function hashSessionToken(rawToken: string): string {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(rawToken)
    .digest("hex");
}

export async function getCurrentUser(): Promise<Profile | null> {
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);
  return getRepo().getSessionUser(tokenHash);
}

export async function requireCurrentUser(role?: UserRole): Promise<Profile> {
  const user = await getCurrentUser();
  if (!user) {
    throw new HttpError(401, "Authentication required. Please sign in to continue.");
  }
  if (role && user.role !== role) {
    throw new HttpError(
      403,
      `Only a ${role} account can perform this action (signed in as ${user.role}).`
    );
  }
  return user;
}

export async function issueSessionCookie(userId: string): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await getRepo().createSession({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https://"),
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
  if (rawToken) {
    await getRepo().deleteSession(hashSessionToken(rawToken));
  }
  store.delete(SESSION_COOKIE_NAME);
}

export async function authenticateWithPassword(
  email: string,
  password: string
): Promise<Profile> {
  const user = await getRepo().getProfileByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, "Invalid email or password.");
  }
  await issueSessionCookie(user.id);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  };
}

export async function authenticateDemoAccount(role: UserRole): Promise<Profile> {
  const demo = DEMO_ACCOUNTS[role];
  const repo = getRepo();
  await repo.ensureSeedProfiles();
  const user = await repo.getProfileByEmail(demo.email);
  if (!user) {
    throw new HttpError(500, "Demo profile missing");
  }
  await issueSessionCookie(user.id);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  };
}

export async function registerUserAccount(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}): Promise<Profile> {
  if (input.password.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters long.");
  }
  const profile = await getRepo().createProfile({
    name: input.name,
    email: input.email,
    role: input.role,
    password_hash: hashPassword(input.password),
  });
  await issueSessionCookie(profile.id);
  return profile;
}

export function getSystemConfigStatus(): SystemConfigStatus {
  const paypal = getPayPalClientConfig();
  const mode = getConfiguredPaymentMode();
  const preferred = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
  const ollamaCfg = getOllamaConfig();

  let aiProvider: AIProviderType | null = null;
  let aiModel: string | null = null;
  if (preferred === "ollama") {
    aiProvider = "ollama";
    aiModel = ollamaCfg.model;
  } else if (preferred === "gemini" && geminiKey) {
    aiProvider = "gemini";
    aiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  } else if (preferred === "anthropic" && anthropicKey) {
    aiProvider = "anthropic";
    aiModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  } else if (geminiKey) {
    aiProvider = "gemini";
    aiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  } else if (anthropicKey) {
    aiProvider = "anthropic";
    aiModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  } else if (ollamaCfg.configured) {
    aiProvider = "ollama";
    aiModel = ollamaCfg.model;
  }

  return {
    payment: {
      mode,
      label:
        mode === "simulation"
          ? "Simulation · No money moved"
          : "PayPal Sandbox · Test transactions",
    },
    paypal: {
      configured: paypal.configured,
      environment: "sandbox",
      clientId: paypal.clientId,
      merchantConfigured: Boolean(paypal.merchantId),
      webhookConfigured: Boolean(paypal.webhookId),
    },
    ai: {
      configured: Boolean(aiProvider && (aiProvider !== "ollama" || ollamaCfg.explicitlySelected)),
      provider: aiProvider,
      model: aiModel,
    },
    database: {
      driver: isSupabaseConfigured() ? "supabase" : "sqlite",
      configured: true,
    },
  };
}

export async function getLiveSystemConfigStatus(): Promise<SystemConfigStatus> {
  const base = getSystemConfigStatus();
  if (base.ai.provider === "gemini" || base.ai.provider === "anthropic") {
    return base;
  }
  const ollama = await probeOllamaHealth();
  return {
    ...base,
    ai: {
      configured: ollama.reachable && ollama.modelAvailable,
      provider: ollama.reachable || ollama.configured ? "ollama" : base.ai.provider,
      model: ollama.reachable || ollama.configured ? ollama.model : base.ai.model,
      ollama,
    },
  };
}
