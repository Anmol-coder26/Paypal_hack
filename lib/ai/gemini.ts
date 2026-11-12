import { GoogleGenAI, Type } from "@google/genai";
import sharp from "sharp";
import { getRepo } from "../db";
import { HttpError } from "../errors";
import { decryptCredential } from "../security/secrets-vault";
import type { GeminiConfigMetadata } from "../types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const SUPPORTED_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

const BLOCKED_IMAGE_GEN_PATTERN = /(imagen|image-generation|veo)/i;

export function assertValidGeminiModelName(model: string): string {
  const clean = model.trim() || DEFAULT_GEMINI_MODEL;
  if (BLOCKED_IMAGE_GEN_PATTERN.test(clean)) {
    throw new HttpError(
      400,
      `Model '${clean}' is an image-generation model and is not permitted for structured visual inspection.`
    );
  }
  return clean;
}

export type GeminiErrorCode =
  | "rate_limited"
  | "daily_quota_exhausted"
  | "invalid_api_key"
  | "permission_denied"
  | "unsupported_model"
  | "invalid_image"
  | "malformed_response"
  | "network_timeout"
  | "connection_error"
  | "provider_unavailable";

export class GeminiClassifiedError extends HttpError {
  code: GeminiErrorCode;
  retryAfterMs: number | null;
  retryable: boolean;

  constructor(opts: {
    status: number;
    code: GeminiErrorCode;
    message: string;
    retryAfterMs?: number | null;
    retryable?: boolean;
  }) {
    super(opts.status, opts.message);
    this.name = "GeminiClassifiedError";
    this.code = opts.code;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.retryable = Boolean(opts.retryable);
  }
}

interface CooldownState {
  active: boolean;
  reason: string | null;
  code: GeminiErrorCode | null;
  triggeredAt: number | null;
  retryAfterMs: number | null;
}

let geminiCooldown: CooldownState = {
  active: false,
  reason: null,
  code: null,
  triggeredAt: null,
  retryAfterMs: null,
};

export function getGeminiCooldownState(): {
  active: boolean;
  reason: string | null;
  code: GeminiErrorCode | null;
} {
  if (!geminiCooldown.active) {
    return { active: false, reason: null, code: null };
  }
  // If an explicit Retry-After window elapsed cleanly, lift transient cooldown.
  if (
    geminiCooldown.retryAfterMs &&
    geminiCooldown.triggeredAt &&
    Date.now() - geminiCooldown.triggeredAt >= geminiCooldown.retryAfterMs
  ) {
    geminiCooldown = { active: false, reason: null, code: null, triggeredAt: null, retryAfterMs: null };
    return { active: false, reason: null, code: null };
  }
  return {
    active: true,
    reason: geminiCooldown.reason,
    code: geminiCooldown.code,
  };
}

export function setGeminiCooldown(code: GeminiErrorCode, reason: string, retryAfterMs?: number | null) {
  geminiCooldown = {
    active: true,
    code,
    reason,
    triggeredAt: Date.now(),
    retryAfterMs: retryAfterMs ?? null,
  };
}

export function clearGeminiCooldown() {
  geminiCooldown = {
    active: false,
    reason: null,
    code: null,
    triggeredAt: null,
    retryAfterMs: null,
  };
}

export async function resolveGeminiCredential(): Promise<{
  configured: boolean;
  apiKey: string | null;
  source: "admin_vault" | "environment" | "none";
  model: string;
  updatedAt: string | null;
}> {
  const repo = getRepo();
  const stored = await repo.getServerCredential("gemini");
  const envKey = (process.env.GEMINI_API_KEY || "").trim();
  const envModel = (process.env.GEMINI_MODEL || "").trim();

  if (stored?.encrypted_payload) {
    const decrypted = decryptCredential(stored.encrypted_payload);
    return {
      configured: Boolean(decrypted),
      apiKey: decrypted,
      source: "admin_vault",
      model: assertValidGeminiModelName(stored.model || envModel || DEFAULT_GEMINI_MODEL),
      updatedAt: stored.updated_at,
    };
  }

  if (envKey) {
    return {
      configured: true,
      apiKey: envKey,
      source: "environment",
      model: assertValidGeminiModelName(envModel || DEFAULT_GEMINI_MODEL),
      updatedAt: null,
    };
  }

  return {
    configured: false,
    apiKey: null,
    source: "none",
    model: assertValidGeminiModelName(envModel || DEFAULT_GEMINI_MODEL),
    updatedAt: null,
  };
}

export async function getGeminiPublicMetadata(): Promise<GeminiConfigMetadata> {
  let resolved;
  try {
    resolved = await resolveGeminiCredential();
  } catch (err) {
    return {
      configured: false,
      source: "none",
      model: DEFAULT_GEMINI_MODEL,
      updatedAt: null,
      cooldownActive: true,
      cooldownReason:
        err instanceof Error ? err.message : "Stored credential could not be unlocked.",
      supportedModels: SUPPORTED_GEMINI_MODELS,
    };
  }

  const cd = getGeminiCooldownState();
  return {
    configured: resolved.configured,
    source: resolved.source,
    model: resolved.model,
    updatedAt: resolved.updatedAt,
    cooldownActive: cd.active,
    cooldownReason: cd.reason,
    supportedModels: SUPPORTED_GEMINI_MODELS,
  };
}

function parseRetryAfterMs(message: string, headers?: Headers | null): number | null {
  const headerVal = headers?.get("retry-after");
  if (headerVal) {
    const secs = Number(headerVal);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 15_000);
  }
  const match = message.match(/retry in\s+([\d.]+)\s*s/i);
  if (match) {
    const secs = Number(match[1]);
    if (Number.isFinite(secs) && secs > 0) return Math.min(Math.ceil(secs * 1000), 15_000);
  }
  return null;
}

export function classifyGeminiError(err: unknown): GeminiClassifiedError {
  if (err instanceof GeminiClassifiedError) return err;

  const anyErr = err as {
    status?: number;
    code?: number | string;
    message?: string;
    name?: string;
    cause?: { code?: string };
    response?: { headers?: Headers };
  };
  const msg = String(anyErr?.message || "Gemini request failed");
  const lower = msg.toLowerCase();
  const status = typeof anyErr?.status === "number" ? anyErr.status : 0;

  if (anyErr?.name === "AbortError" || anyErr?.name === "TimeoutError" || lower.includes("timeout")) {
    return new GeminiClassifiedError({
      status: 504,
      code: "network_timeout",
      message: "Gemini API timed out before completing visual inspection.",
      retryable: true,
    });
  }

  if (
    anyErr?.cause?.code === "ECONNREFUSED" ||
    anyErr?.cause?.code === "ENOTFOUND" ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  ) {
    return new GeminiClassifiedError({
      status: 503,
      code: "connection_error",
      message: "Could not reach Gemini API endpoint over the network.",
      retryable: true,
    });
  }

  if (
    status === 429 ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("rate limit")
  ) {
    const retryAfterMs = parseRetryAfterMs(msg, anyErr?.response?.headers);
    const isDaily =
      lower.includes("per day") ||
      lower.includes("daily") ||
      lower.includes("limit: 0") ||
      lower.includes("quota exceeded");
    if (isDaily) {
      return new GeminiClassifiedError({
        status: 429,
        code: "daily_quota_exhausted",
        message: "Gemini API free-tier quota is temporarily exhausted. Switched to fallback mode.",
        retryAfterMs,
        retryable: false,
      });
    }
    return new GeminiClassifiedError({
      status: 429,
      code: "rate_limited",
      message: "Gemini API rate limit reached briefly.",
      retryAfterMs: retryAfterMs ?? 1500,
      retryable: true,
    });
  }

  if (
    status === 401 ||
    lower.includes("api_key_invalid") ||
    lower.includes("api key not valid") ||
    lower.includes("invalid api key")
  ) {
    return new GeminiClassifiedError({
      status: 401,
      code: "invalid_api_key",
      message: "Gemini rejected the configured API key. Verify or replace the key in Settings.",
      retryable: false,
    });
  }

  if (status === 403 || lower.includes("permission denied")) {
    return new GeminiClassifiedError({
      status: 403,
      code: "permission_denied",
      message: "Gemini denied permission for this API key or project.",
      retryable: false,
    });
  }

  if (status === 404 || lower.includes("not found") || lower.includes("unsupported")) {
    return new GeminiClassifiedError({
      status: 400,
      code: "unsupported_model",
      message: "Selected Gemini model is unavailable or unsupported for multimodal generateContent.",
      retryable: false,
    });
  }

  if (status === 400 && (lower.includes("image") || lower.includes("unable to process input"))) {
    return new GeminiClassifiedError({
      status: 400,
      code: "invalid_image",
      message: "Gemini could not decode one of the submitted images. Upload a fresh PNG/JPEG/WebP.",
      retryable: false,
    });
  }

  return new GeminiClassifiedError({
    status: status >= 400 && status < 600 ? status : 502,
    code: "provider_unavailable",
    message: "Gemini AI inspection is temporarily unavailable.",
    retryable: status >= 500,
  });
}

export const GEMINI_EVIDENCE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: [
    "overall_assessment",
    "summary",
    "views_comparable",
    "visible_observations",
    "criteria_checks",
    "criteria_satisfied",
    "criteria_unmet",
    "criteria_unverifiable",
    "missing_evidence",
    "recommended_next_steps",
    "suggested_outcome",
    "limitations_and_uncertainty",
  ],
  properties: {
    overall_assessment: {
      type: Type.STRING,
      enum: ["appears_satisfied", "concerns_identified", "insufficient_evidence"],
    },
    summary: { type: Type.STRING },
    views_comparable: { type: Type.STRING, enum: ["yes", "partly", "no"] },
    visible_observations: { type: Type.ARRAY, items: { type: Type.STRING } },
    criteria_checks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["criterion", "status", "observation"],
        properties: {
          criterion: { type: Type.STRING },
          status: { type: Type.STRING, enum: ["satisfied", "unmet", "unverifiable"] },
          observation: { type: Type.STRING },
        },
      },
    },
    criteria_satisfied: { type: Type.ARRAY, items: { type: Type.STRING } },
    criteria_unmet: { type: Type.ARRAY, items: { type: Type.STRING } },
    criteria_unverifiable: { type: Type.ARRAY, items: { type: Type.STRING } },
    missing_evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
    recommended_next_steps: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggested_outcome: {
      type: Type.STRING,
      enum: ["accept", "request_more_evidence", "review_concerns"],
    },
    limitations_and_uncertainty: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

export interface GeminiClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }): Promise<{ text?: string }>;
  };
}

export type GeminiFactory = (apiKey: string) => GeminiClientLike;

const defaultGeminiFactory: GeminiFactory = (apiKey: string) =>
  new GoogleGenAI({ apiKey }) as unknown as GeminiClientLike;

export async function generateGeminiStructuredContent(opts: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  responseSchema?: unknown;
  timeoutMs?: number;
  clientFactory?: GeminiFactory;
}): Promise<{ text: string; model: string }> {
  const model = assertValidGeminiModelName(opts.model);
  const client = (opts.clientFactory || defaultGeminiFactory)(opts.apiKey);

  let lastErr: GeminiClassifiedError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: opts.parts }],
        config: {
          systemInstruction: opts.systemInstruction,
          temperature: 0.15,
          responseMimeType: "application/json",
          ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
          httpOptions: { timeout: opts.timeoutMs ?? 30_000 },
        },
      });
      const text = response?.text;
      if (!text || !text.trim()) {
        throw new GeminiClassifiedError({
          status: 502,
          code: "malformed_response",
          message: "Gemini returned an empty response body.",
          retryable: false,
        });
      }
      clearGeminiCooldown();
      return { text, model };
    } catch (err) {
      const classified = classifyGeminiError(err);
      lastErr = classified;

      if (classified.code === "daily_quota_exhausted") {
        setGeminiCooldown(classified.code, classified.message, classified.retryAfterMs);
        throw classified;
      }

      if (classified.retryable && attempt === 0) {
        const waitMs = Math.min(classified.retryAfterMs ?? 1000, 3000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (classified.code === "rate_limited") {
        setGeminiCooldown(classified.code, classified.message, classified.retryAfterMs);
      }
      throw classified;
    }
  }

  throw lastErr ?? new GeminiClassifiedError({
    status: 502,
    code: "provider_unavailable",
    message: "Gemini API call failed.",
  });
}

/**
 * Validates the active (or supplied) Gemini API key + image-capable model with a tiny
 * synthetic PNG image & JSON schema test request. Never logs or echoes credentials.
 */
export async function testGeminiConnection(opts?: {
  apiKey?: string;
  model?: string;
  clientFactory?: GeminiFactory;
}): Promise<{
  ok: boolean;
  model: string;
  source: "admin_vault" | "environment" | "inline_input";
  latencyMs: number;
  code?: GeminiErrorCode;
  message: string;
}> {
  const started = Date.now();
  const resolved = await resolveGeminiCredential();
  const apiKey = (opts?.apiKey || "").trim() || resolved.apiKey;
  const model = assertValidGeminiModelName(opts?.model || resolved.model);
  const source: "admin_vault" | "environment" | "inline_input" = opts?.apiKey?.trim()
    ? "inline_input"
    : resolved.source === "none"
    ? "inline_input"
    : resolved.source;

  if (!apiKey) {
    return {
      ok: false,
      model,
      source: "inline_input",
      latencyMs: Date.now() - started,
      code: "invalid_api_key",
      message: "No Gemini API key is configured yet. Enter a key and save or test.",
    };
  }

  // Generate a tiny 64x64 solid PNG locally for real multimodal + JSON schema verification
  const probePng = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 245, g: 247, b: 250 },
    },
  })
    .png()
    .toBuffer();

  try {
    const res = await generateGeminiStructuredContent({
      apiKey,
      model,
      systemInstruction:
        "Return strict JSON confirming whether you received an image: {\"ok\": true, \"received_image\": true}.",
      parts: [
        { text: "Verify multimodal connection." },
        {
          inlineData: {
            mimeType: "image/png",
            data: probePng.toString("base64"),
          },
        },
      ],
      responseSchema: {
        type: Type.OBJECT,
        required: ["ok", "received_image"],
        properties: {
          ok: { type: Type.BOOLEAN },
          received_image: { type: Type.BOOLEAN },
        },
      },
      timeoutMs: 20_000,
      clientFactory: opts?.clientFactory,
    });
    const parsed = JSON.parse(res.text) as { ok?: boolean };
    if (!parsed?.ok) {
      return {
        ok: false,
        model,
        source,
        latencyMs: Date.now() - started,
        code: "malformed_response",
        message: "Gemini responded, but structured JSON verification was incomplete.",
      };
    }
    return {
      ok: true,
      model,
      source,
      latencyMs: Date.now() - started,
      message: `Connected to ${model} (${source === "environment" ? ".env.local" : source === "admin_vault" ? "Encrypted Vault" : "Key Input"}) with multimodal JSON output verified.`,
    };
  } catch (err) {
    const classified = classifyGeminiError(err);
    return {
      ok: false,
      model,
      source,
      latencyMs: Date.now() - started,
      code: classified.code,
      message: classified.message,
    };
  }
}
