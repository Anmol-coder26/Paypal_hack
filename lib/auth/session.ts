import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { DEFAULT_GEMINI_MODEL, getGeminiPublicMetadata } from "../ai/gemini";
import { getOllamaConfig, probeOllamaHealth } from "../ai/provider";
import { getRepo, isSupabaseConfigured } from "../db";
import { DEMO_ACCOUNTS, hashPassword, verifyPassword } from "../db/sqlite";
import { HttpError } from "../errors";
import { getPayPalClientConfig } from "../payments/paypal-client";
import { getConfiguredPaymentMode, isDemoModeEnabled } from "../payments/simulator";
import type { AIAnalysisSource, AIProviderType, Profile, SystemConfigStatus, UserRole } from "../types";

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
  const demoMode = isDemoModeEnabled();
  const preferred = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  const demoAIActive = preferred === "demo" || (demoMode && !preferred);
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
  const ollamaCfg = getOllamaConfig();

  let aiProvider: AIProviderType | null = null;
  let aiModel: string | null = null;
  if (demoAIActive) {
    aiProvider = "demo";
    aiModel = "prepared-demo-v1";
  } else if (preferred === "ollama") {
    aiProvider = "ollama";
    aiModel = ollamaCfg.model;
  } else if (preferred === "gemini" && geminiKey) {
    aiProvider = "gemini";
    aiModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  } else if (preferred === "anthropic" && anthropicKey) {
    aiProvider = "anthropic";
    aiModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  } else if (geminiKey) {
    aiProvider = "gemini";
    aiModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  } else if (anthropicKey) {
    aiProvider = "anthropic";
    aiModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  } else if (ollamaCfg.configured) {
    aiProvider = "ollama";
    aiModel = ollamaCfg.model;
  }

  return {
    demoMode,
    payment: {
      mode,
      label:
        mode === "simulation"
          ? demoMode
            ? "Demo environment · Payments simulated"
            : "Simulation · No money moved"
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
      configured:
        Boolean(aiProvider && (aiProvider !== "ollama" || ollamaCfg.explicitlySelected)),
      provider: aiProvider,
      model: aiModel,
      ...(demoAIActive ? { activeTier: "prepared_demo" as const } : {}),
    },
    database: {
      driver: isSupabaseConfigured() ? "supabase" : "sqlite",
      configured: true,
    },
  };
}

export async function getLiveSystemConfigStatus(): Promise<SystemConfigStatus> {
  const base = getSystemConfigStatus();
  const [geminiMeta, ollama] = await Promise.all([
    getGeminiPublicMetadata(),
    probeOllamaHealth(),
  ]);
  const demoMode = isDemoModeEnabled();
  const aiProviderEnv = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  const demoAIActive = aiProviderEnv === "demo" || (demoMode && !aiProviderEnv);

  let configured = false;
  let provider: AIProviderType | null = null;
  let model: string | null = null;
  let activeTier: AIAnalysisSource | "guided_fallback" = "guided_fallback";

  if (demoAIActive) {
    configured = true;
    provider = "demo";
    model = "prepared-demo-v1";
    activeTier = "prepared_demo";
  } else if (geminiMeta.configured && !geminiMeta.cooldownActive) {
    configured = true;
    provider = "gemini";
    model = geminiMeta.model;
    activeTier = "gemini_live";
  } else if (ollama.reachable && ollama.modelAvailable) {
    configured = true;
    provider = "ollama";
    model = ollama.model;
    activeTier = "ollama_local";
  } else if (process.env.ANTHROPIC_API_KEY?.trim()) {
    configured = true;
    provider = "anthropic";
    model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
    activeTier = "anthropic_live";
  } else if (geminiMeta.configured) {
    // Key exists, but currently in quota cooldown
    configured = false;
    provider = "gemini";
    model = geminiMeta.model;
    activeTier = "guided_fallback";
  }

  return {
    ...base,
    demoMode,
    payment: {
      ...base.payment,
      label:
        base.payment.mode === "simulation"
          ? demoMode
            ? "Demo environment · Payments simulated"
            : "Simulation · No money moved"
          : "PayPal Sandbox · Test transactions",
    },
    ai: {
      configured,
      provider,
      model,
      activeTier,
      gemini: geminiMeta,
      ollama,
    },
  };
}
