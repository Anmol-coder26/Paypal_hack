import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { z } from "zod";
import { HttpError } from "../errors";
import { formatMinorUnits } from "../payments/state-machine";
import type {
  AIAnalysisSource,
  AIProviderType,
  AIReviewRecord,
  AIStructuredFindings,
  EvidenceRecord,
  TaskBundle,
} from "../types";
import {
  clearGeminiCooldown,
  GEMINI_EVIDENCE_RESPONSE_SCHEMA,
  generateGeminiStructuredContent,
  getGeminiCooldownState,
  resolveGeminiCredential,
  setGeminiCooldown,
  type GeminiErrorCode,
  type GeminiFactory,
  GeminiClassifiedError,
} from "./gemini";
import {
  formatKnowledgeForPrompt,
  getGuidedChecklistTemplate,
  retrieveRepairKnowledge,
} from "./knowledge";

export const ScopeSuggestionSchema = z.object({
  improved_description: z.string().min(5),
  suggested_criteria: z.array(z.string().min(3)).min(2).max(6),
  evidence_photo_guidance: z.string().min(5),
});

export const EvidenceFindingsSchema = z.object({
  overall_assessment: z.enum([
    "appears_satisfied",
    "concerns_identified",
    "insufficient_evidence",
  ]),
  summary: z.string().min(10),
  views_comparable: z.enum(["yes", "partly", "no"]),
  visible_observations: z.array(z.string()).min(1),
  criteria_checks: z
    .array(
      z.object({
        criterion: z.string(),
        status: z.enum(["satisfied", "unmet", "unverifiable"]),
        observation: z.string(),
      })
    )
    .min(1),
  criteria_satisfied: z.array(z.string()),
  criteria_unmet: z.array(z.string()),
  criteria_unverifiable: z.array(z.string()),
  missing_evidence: z.array(z.string()),
  recommended_next_steps: z.array(z.string()).min(1),
  suggested_outcome: z.enum([
    "accept",
    "request_more_evidence",
    "review_concerns",
  ]),
  limitations_and_uncertainty: z.array(z.string()).min(1),
});

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_DEFAULT_MODEL = "qwen2.5vl:3b";
const OLLAMA_TIMEOUT_MS = 45_000;
const MAX_OLLAMA_IMAGE_BYTES = 4 * 1024 * 1024;
const AI_INFERENCE_MAX_EDGE = 1600;

export function sanitizeOllamaBaseUrl(raw?: string): string {
  const candidate = (raw || OLLAMA_DEFAULT_BASE_URL).trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new HttpError(500, "Invalid OLLAMA_BASE_URL server configuration.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(500, "OLLAMA_BASE_URL must use http or https.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new HttpError(
      500,
      "OLLAMA_BASE_URL is restricted to localhost / 127.0.0.1 on the server."
    );
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

export function getOllamaConfig() {
  const explicitlySelected =
    (process.env.AI_PROVIDER || "").trim().toLowerCase() === "ollama";
  const baseUrl = sanitizeOllamaBaseUrl(process.env.OLLAMA_BASE_URL);
  const model = (process.env.OLLAMA_MODEL || OLLAMA_DEFAULT_MODEL).trim();
  return {
    explicitlySelected,
    configured: explicitlySelected || Boolean(process.env.OLLAMA_MODEL || process.env.OLLAMA_BASE_URL),
    baseUrl,
    model,
  };
}

export async function probeOllamaHealth(
  fetchImpl: typeof fetch = fetch
): Promise<{
  configured: boolean;
  reachable: boolean;
  modelAvailable: boolean;
  model: string;
  baseUrl: string;
  error?: string;
}> {
  const cfg = getOllamaConfig();
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(600),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ...cfg,
        reachable: false,
        modelAvailable: false,
        error: `Ollama returned HTTP ${res.status}`,
      };
    }
    const data = (await res.json().catch(() => null)) as {
      models?: Array<{ name?: string; model?: string }>;
    } | null;
    const names = (data?.models ?? []).map((m) => String(m.name || m.model || ""));
    const baseModelName = cfg.model.split(":")[0];
    const modelAvailable = names.some(
      (n) => n === cfg.model || n.startsWith(`${baseModelName}:`) || n === baseModelName
    );
    return {
      configured: cfg.configured || modelAvailable,
      reachable: true,
      modelAvailable,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      ...(modelAvailable
        ? {}
        : { error: `Ollama running, but model '${cfg.model}' is not pulled yet.` }),
    };
  } catch {
    return {
      ...cfg,
      reachable: false,
      modelAvailable: false,
      error: `Local Ollama server not reachable at ${cfg.baseUrl}`,
    };
  }
}

export type ActiveAIProviderConfig =
  | { provider: "ollama"; baseUrl: string; model: string }
  | { provider: "gemini"; apiKey: string; model: string }
  | { provider: "anthropic"; apiKey: string; model: string };

export async function resolveActiveAIProvider(
  override?: ActiveAIProviderConfig
): Promise<ActiveAIProviderConfig> {
  if (override) return override;
  const preferred = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  const geminiCred = await resolveGeminiCredential();

  if (preferred === "ollama") {
    const ol = getOllamaConfig();
    return { provider: "ollama", baseUrl: ol.baseUrl, model: ol.model };
  }
  if (preferred === "gemini" && geminiCred.configured && geminiCred.apiKey) {
    return {
      provider: "gemini",
      apiKey: geminiCred.apiKey,
      model: geminiCred.model,
    };
  }
  if (preferred === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    };
  }

  if (geminiCred.configured && geminiCred.apiKey) {
    return {
      provider: "gemini",
      apiKey: geminiCred.apiKey,
      model: geminiCred.model,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    };
  }
  if (process.env.OLLAMA_MODEL || process.env.OLLAMA_BASE_URL) {
    const ol = getOllamaConfig();
    return { provider: "ollama", baseUrl: ol.baseUrl, model: ol.model };
  }

  throw new HttpError(
    503,
    "No AI Vision provider is configured. Add a Gemini API key in Settings (or start local Ollama)."
  );
}

/** Synchronous compatibility helper for callers without vault lookups. */
export function getActiveAIProvider(override?: ActiveAIProviderConfig): ActiveAIProviderConfig {
  if (override) return override;
  const preferred = (process.env.AI_PROVIDER || "").trim().toLowerCase();

  if (preferred === "ollama") {
    const ol = getOllamaConfig();
    return { provider: "ollama", baseUrl: ol.baseUrl, model: ol.model };
  }
  if (preferred === "gemini" && process.env.GEMINI_API_KEY) {
    return {
      provider: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    };
  }
  if (preferred === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    };
  }

  if (process.env.GEMINI_API_KEY) {
    return {
      provider: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    };
  }
  if (process.env.OLLAMA_MODEL || process.env.OLLAMA_BASE_URL) {
    const ol = getOllamaConfig();
    return { provider: "ollama", baseUrl: ol.baseUrl, model: ol.model };
  }

  throw new HttpError(
    503,
    "No AI Vision provider is configured. Add a Gemini API key in Settings or start local Ollama."
  );
}

export async function assessEvidenceQuality(
  beforeImages: Array<{ record: EvidenceRecord; bytes: Buffer }>,
  afterImages: Array<{ record: EvidenceRecord; bytes: Buffer }>
): Promise<{
  warnings: string[];
  beforeHashes: string[];
  afterHashes: string[];
  allHashes: string[];
  evidenceIds: string[];
}> {
  const warnings: string[] = [];
  const beforeHashes: string[] = [];
  const afterHashes: string[] = [];
  const evidenceIds: string[] = [];

  if (!beforeImages.length) {
    warnings.push("No BEFORE photograph attached for baseline comparison.");
  }
  if (!afterImages.length) {
    warnings.push("No AFTER photograph attached showing completed repair work.");
  }

  const checkOne = async (
    item: { record: EvidenceRecord; bytes: Buffer },
    stage: "before" | "after"
  ) => {
    const hash = crypto.createHash("sha256").update(item.bytes).digest("hex");
    if (stage === "before") beforeHashes.push(hash);
    else afterHashes.push(hash);
    evidenceIds.push(item.record.id);

    try {
      const meta = await sharp(item.bytes).metadata();
      const width = meta.width ?? item.record.width ?? 0;
      const height = meta.height ?? item.record.height ?? 0;
      if (width > 0 && height > 0 && (width < 240 || height < 180)) {
        warnings.push(
          `${stage.toUpperCase()} image resolution (${width}x${height}) is low; small defects may not be clear.`
        );
      }
      const stats = await sharp(item.bytes).greyscale().stats();
      const stdev = stats.channels[0]?.stdev ?? 25;
      if (stdev < 4.5) {
        warnings.push(
          `${stage.toUpperCase()} image has very low visual contrast or uniform blur; a sharper framing may be needed.`
        );
      }
    } catch {
      warnings.push(`${stage.toUpperCase()} image metadata could not be inspected locally.`);
    }
  };

  for (const b of beforeImages) await checkOne(b, "before");
  for (const a of afterImages) await checkOne(a, "after");

  const overlap = beforeHashes.some((h) => afterHashes.includes(h));
  if (overlap) {
    warnings.push(
      "Before and After uploads have identical SHA-256 image hashes; verify both stages show distinct photographs."
    );
  }

  return {
    warnings: Array.from(new Set(warnings)),
    beforeHashes,
    afterHashes,
    allHashes: [...beforeHashes, ...afterHashes],
    evidenceIds,
  };
}

async function prepareImageForAI(bytes: Buffer, mimeType: string): Promise<{ bytes: Buffer; mimeType: string }> {
  try {
    const meta = await sharp(bytes).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (Math.max(w, h) <= AI_INFERENCE_MAX_EDGE && bytes.byteLength <= 1_800_000) {
      return { bytes, mimeType };
    }
    const pipeline = sharp(bytes).rotate().resize({
      width: AI_INFERENCE_MAX_EDGE,
      height: AI_INFERENCE_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
    const out =
      mimeType === "image/png"
        ? await pipeline.png().toBuffer()
        : mimeType === "image/webp"
        ? await pipeline.webp({ quality: 86 }).toBuffer()
        : await pipeline.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    return { bytes: out, mimeType };
  } catch {
    return { bytes, mimeType };
  }
}

export function computeInspectionFingerprint(opts: {
  task: Pick<TaskBundle, "title" | "description" | "acceptance_criteria" | "contractor_notes">;
  beforeHashes: string[];
  afterHashes: string[];
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        title: opts.task.title,
        description: opts.task.description,
        criteria: opts.task.acceptance_criteria,
        notes: opts.task.contractor_notes || "",
        beforeHashes: opts.beforeHashes,
        afterHashes: opts.afterHashes,
      })
    )
    .digest("hex");
}

async function callOllamaChatJSON(opts: {
  baseUrl: string;
  model: string;
  system: string;
  userText: string;
  images?: Buffer[];
  formatSchema?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; model: string }> {
  const baseUrl = sanitizeOllamaBaseUrl(opts.baseUrl);
  const fetchImpl = opts.fetchImpl || fetch;
  const encodedImages = (opts.images ?? []).map((buf) => {
    if (buf.byteLength > MAX_OLLAMA_IMAGE_BYTES) {
      throw new HttpError(413, "Evidence photograph exceeds local Ollama input size limit (4 MB).");
    }
    return buf.toString("base64");
  });

  const bodyPayload: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    options: { temperature: 0.15 },
    messages: [
      { role: "system", content: opts.system },
      {
        role: "user",
        content: opts.userText,
        ...(encodedImages.length ? { images: encodedImages } : {}),
      },
    ],
    format: opts.formatSchema ?? "json",
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      });
      const payload = (await res.json().catch(() => null)) as {
        message?: { content?: string };
        error?: string;
        model?: string;
      } | null;

      if (!res.ok) {
        const msg = payload?.error || `Ollama returned HTTP ${res.status}`;
        if (res.status === 404 || msg.toLowerCase().includes("not found")) {
          throw new HttpError(
            503,
            `Ollama model '${opts.model}' is not installed locally. Run 'ollama pull ${opts.model}' or use Guided Review.`
          );
        }
        if (res.status >= 500 && attempt === 0) {
          lastErr = new HttpError(502, `Ollama server error: ${msg}`);
          continue;
        }
        throw new HttpError(502, `Ollama inference error: ${msg}`);
      }

      const content = payload?.message?.content;
      if (!content) {
        throw new HttpError(502, "Ollama returned an empty response.");
      }
      return { text: content, model: payload?.model || opts.model };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastErr = err;
      const name = err instanceof Error ? err.name : "";
      if ((name === "TimeoutError" || name === "AbortError") && attempt === 0) {
        continue;
      }
      if (name === "TimeoutError" || name === "AbortError") {
        throw new HttpError(
          504,
          `Local Ollama model '${opts.model}' timed out after 45s on available hardware. Switch to Guided Review.`
        );
      }
      throw new HttpError(
        503,
        `Local Ollama server is not reachable at ${baseUrl}. Use Guided Review or verify Ollama is running.`
      );
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new HttpError(503, "Local Ollama request failed.");
}

async function callAnthropicJSON(opts: {
  apiKey: string;
  model: string;
  system: string;
  content: Anthropic.ContentBlockParam[];
}): Promise<{ text: string; model: string }> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  try {
    const msg = await client.messages.create({
      model: opts.model,
      max_tokens: 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
    });
    const textBlock = msg.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new HttpError(502, "Anthropic returned no text block");
    }
    return { text: textBlock.text, model: msg.model };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, "Anthropic rate limit exceeded; retry shortly.");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new HttpError(503, "ANTHROPIC_API_KEY was rejected by Anthropic.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new HttpError(502, `Anthropic API error (${err.status ?? "network"})`);
    }
    throw err;
  }
}

function parseJsonFromModel(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

const EVIDENCE_JSON_SCHEMA = {
  type: "object",
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
      type: "string",
      enum: ["appears_satisfied", "concerns_identified", "insufficient_evidence"],
    },
    summary: { type: "string" },
    views_comparable: { type: "string", enum: ["yes", "partly", "no"] },
    visible_observations: { type: "array", items: { type: "string" } },
    criteria_checks: {
      type: "array",
      items: {
        type: "object",
        required: ["criterion", "status", "observation"],
        properties: {
          criterion: { type: "string" },
          status: { type: "string", enum: ["satisfied", "unmet", "unverifiable"] },
          observation: { type: "string" },
        },
      },
    },
    criteria_satisfied: { type: "array", items: { type: "string" } },
    criteria_unmet: { type: "array", items: { type: "string" } },
    criteria_unverifiable: { type: "array", items: { type: "string" } },
    missing_evidence: { type: "array", items: { type: "string" } },
    recommended_next_steps: { type: "array", items: { type: "string" } },
    suggested_outcome: {
      type: "string",
      enum: ["accept", "request_more_evidence", "review_concerns"],
    },
    limitations_and_uncertainty: { type: "array", items: { type: "string" } },
  },
};

export async function generateScopeSuggestions(
  input: { title: string; description: string },
  opts?: { aiOverride?: ActiveAIProviderConfig; fetchImpl?: typeof fetch; geminiFactory?: GeminiFactory }
): Promise<z.infer<typeof ScopeSuggestionSchema>> {
  const cfg = await resolveActiveAIProvider(opts?.aiOverride);
  const guidelines = formatKnowledgeForPrompt(
    retrieveRepairKnowledge(input.title, input.description)
  );
  const systemPrompt = `You help homeowners write concise, visually verifiable acceptance criteria for repair tasks.
Avoid promotional adjectives. Keep criteria observable in before-and-after photographs.
Category guidance:
${guidelines}
Return ONLY valid JSON matching:
{
  "improved_description": "concise 1-2 sentence scope",
  "suggested_criteria": ["3 to 5 specific visual acceptance criteria"],
  "evidence_photo_guidance": "short instruction on how before/after photos should be framed"
}`;
  const userPrompt = `Task title: ${input.title}\nRough description: ${input.description}`;

  const raw =
    cfg.provider === "ollama"
      ? await callOllamaChatJSON({
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          system: systemPrompt,
          userText: userPrompt,
          fetchImpl: opts?.fetchImpl,
        })
      : cfg.provider === "gemini"
      ? await generateGeminiStructuredContent({
          apiKey: cfg.apiKey,
          model: cfg.model,
          systemInstruction: systemPrompt,
          parts: [{ text: userPrompt }],
          clientFactory: opts?.geminiFactory,
        })
      : await callAnthropicJSON({
          apiKey: cfg.apiKey,
          model: cfg.model,
          system: systemPrompt,
          content: [{ type: "text", text: userPrompt }],
        });

  const parsed = ScopeSuggestionSchema.safeParse(parseJsonFromModel(raw.text));
  if (!parsed.success) {
    throw new HttpError(502, "AI scope assistant returned malformed JSON; please retry.");
  }
  return parsed.data;
}

function buildInspectionPrompts(opts: {
  task: TaskBundle;
  beforeCount: number;
  afterCount: number;
  qualityWarnings: string[];
}) {
  const knowledgeText = formatKnowledgeForPrompt(
    retrieveRepairKnowledge(opts.task.title, opts.task.description)
  );

  const systemPrompt = `You are PunchPay's cautious visual repair inspection assistant for homeowners.
You NEVER approve, capture, or void payments; you only evaluate visible evidence in the submitted BEFORE and AFTER photographs relative to the agreed acceptance criteria.

Writing & Evidence Rules:
1. Write crisp, plain, neutral English (no marketing claims, no "100% complete", no "perfect", no "excellent").
2. Limit summary to ~20 words and each observation to ~25 words.
3. For each observation in visible_observations, state which image (BEFORE or AFTER) supports it, what is visibly present, and which acceptance criterion it relates to.
4. NEVER invent physical measurements (millimeters/inches) or calibrated confidence percentages.
5. Evaluate EVERY agreed acceptance criterion in criteria_checks as "satisfied", "unmet", or "unverifiable". Never omit a criterion.
6. If blur, cropping, glare, missing views, or identical photos prevent verification, set views_comparable to "partly" or "no", mark uncertain criteria "unverifiable", and explain why in limitations_and_uncertainty.
7. "overall_assessment":
   - "appears_satisfied" ONLY if ALL criteria are "satisfied" and views are comparable.
   - "concerns_identified" if ANY criterion is "unmet".
   - Otherwise "insufficient_evidence".
8. "recommended_next_steps": Give 1 concrete next step such as "Proceed to homeowner review", "Request a closer photograph", "Inspect visible concern", or "Request a correction".
9. Return ONLY valid JSON matching the exact schema.`;

  const taskText = [
    `Repair Task: ${opts.task.title}`,
    `Scope: ${opts.task.description}`,
    `Contractor Notes: ${opts.task.contractor_notes || "None"}`,
    `Acceptance Criteria:`,
    ...opts.task.acceptance_criteria.map((c, idx) => `${idx + 1}. ${c}`),
    ...(opts.qualityWarnings.length
      ? ["", `Pre-analysis Image Quality Warnings: ${opts.qualityWarnings.join(" ")}`]
      : []),
    "",
    knowledgeText,
    "",
    `Images supplied below in order: ${opts.beforeCount} BEFORE image(s), followed by ${opts.afterCount} AFTER image(s).`,
  ].join("\n");

  return { systemPrompt, taskText };
}

function normalizeValidatedFindings(
  rawText: string,
  meta: {
    source: AIAnalysisSource;
    qualityWarnings: string[];
    evidenceIds: string[];
    imageHashes: string[];
    inputFingerprint: string;
  }
): { findings: AIStructuredFindings; recommendation: AIReviewRecord["recommendation"] } {
  let jsonParsed: unknown;
  try {
    jsonParsed = parseJsonFromModel(rawText);
  } catch {
    throw new HttpError(502, "AI inspection returned non-JSON output; please retry.");
  }
  const parsed = EvidenceFindingsSchema.safeParse(jsonParsed);
  if (!parsed.success) {
    throw new HttpError(502, "AI inspection output failed schema validation; please retry.");
  }

  const out = parsed.data;
  let overall = out.overall_assessment;
  let suggested = out.suggested_outcome;
  const statuses = out.criteria_checks.map((c) => c.status);
  if (statuses.includes("unmet")) {
    overall = "concerns_identified";
    suggested = "review_concerns";
  } else if (
    overall === "appears_satisfied" &&
    (out.views_comparable === "no" || statuses.some((s) => s !== "satisfied"))
  ) {
    overall = "insufficient_evidence";
    suggested = "request_more_evidence";
  }

  const findings: AIStructuredFindings = {
    ...out,
    overall_assessment: overall,
    suggested_outcome: suggested,
    criteria_satisfied: out.criteria_checks
      .filter((c) => c.status === "satisfied")
      .map((c) => c.criterion),
    criteria_unmet: out.criteria_checks
      .filter((c) => c.status === "unmet")
      .map((c) => c.criterion),
    criteria_unverifiable: out.criteria_checks
      .filter((c) => c.status === "unverifiable")
      .map((c) => c.criterion),
    is_genuine_ai: true,
    analysis_source: meta.source,
    analyzed_evidence_ids: meta.evidenceIds,
    image_hashes: meta.imageHashes,
    input_fingerprint: meta.inputFingerprint,
    quality_warnings: meta.qualityWarnings,
  };

  return { findings, recommendation: suggested };
}

async function runSingleProviderInference(opts: {
  cfg: ActiveAIProviderConfig;
  task: TaskBundle;
  beforeImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  afterImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  qualityWarnings: string[];
  evidenceIds: string[];
  imageHashes: string[];
  inputFingerprint: string;
  fetchImpl?: typeof fetch;
  geminiFactory?: GeminiFactory;
}): Promise<{
  provider: AIProviderType;
  model: string;
  analysisSource: AIAnalysisSource;
  findings: AIStructuredFindings;
  recommendation: AIReviewRecord["recommendation"];
}> {
  const { systemPrompt, taskText } = buildInspectionPrompts({
    task: opts.task,
    beforeCount: opts.beforeImages.length,
    afterCount: opts.afterImages.length,
    qualityWarnings: opts.qualityWarnings,
  });

  const preppedBefore = await Promise.all(
    opts.beforeImages.map(async (b) => ({
      record: b.record,
      prepped: await prepareImageForAI(b.bytes, b.record.mime_type),
    }))
  );
  const preppedAfter = await Promise.all(
    opts.afterImages.map(async (a) => ({
      record: a.record,
      prepped: await prepareImageForAI(a.bytes, a.record.mime_type),
    }))
  );

  if (opts.cfg.provider === "ollama") {
    const orderedImages = [
      ...preppedBefore.map((img) => img.prepped.bytes),
      ...preppedAfter.map((img) => img.prepped.bytes),
    ];
    const rawResponse = await callOllamaChatJSON({
      baseUrl: opts.cfg.baseUrl,
      model: opts.cfg.model,
      system: systemPrompt,
      userText: taskText,
      images: orderedImages,
      formatSchema: EVIDENCE_JSON_SCHEMA,
      fetchImpl: opts.fetchImpl,
    });
    const norm = normalizeValidatedFindings(rawResponse.text, {
      source: "ollama_local",
      qualityWarnings: opts.qualityWarnings,
      evidenceIds: opts.evidenceIds,
      imageHashes: opts.imageHashes,
      inputFingerprint: opts.inputFingerprint,
    });
    return {
      provider: "ollama",
      model: rawResponse.model,
      analysisSource: "ollama_local",
      ...norm,
    };
  }

  if (opts.cfg.provider === "gemini") {
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: taskText }];
    preppedBefore.forEach((img, idx) => {
      parts.push({ text: `BEFORE PHOTO #${idx + 1}:` });
      parts.push({
        inlineData: {
          mimeType: img.prepped.mimeType,
          data: img.prepped.bytes.toString("base64"),
        },
      });
    });
    preppedAfter.forEach((img, idx) => {
      parts.push({ text: `AFTER PHOTO #${idx + 1}:` });
      parts.push({
        inlineData: {
          mimeType: img.prepped.mimeType,
          data: img.prepped.bytes.toString("base64"),
        },
      });
    });

    const rawResponse = await generateGeminiStructuredContent({
      apiKey: opts.cfg.apiKey,
      model: opts.cfg.model,
      systemInstruction: systemPrompt,
      parts,
      responseSchema: GEMINI_EVIDENCE_RESPONSE_SCHEMA,
      clientFactory: opts.geminiFactory,
    });
    const norm = normalizeValidatedFindings(rawResponse.text, {
      source: "gemini_live",
      qualityWarnings: opts.qualityWarnings,
      evidenceIds: opts.evidenceIds,
      imageHashes: opts.imageHashes,
      inputFingerprint: opts.inputFingerprint,
    });
    return {
      provider: "gemini",
      model: rawResponse.model,
      analysisSource: "gemini_live",
      ...norm,
    };
  }

  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: taskText }];
  preppedBefore.forEach((img, idx) => {
    content.push({ type: "text", text: `BEFORE PHOTO #${idx + 1}:` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.prepped.mimeType as "image/jpeg" | "image/png" | "image/webp",
        data: img.prepped.bytes.toString("base64"),
      },
    });
  });
  preppedAfter.forEach((img, idx) => {
    content.push({ type: "text", text: `AFTER PHOTO #${idx + 1}:` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.prepped.mimeType as "image/jpeg" | "image/png" | "image/webp",
        data: img.prepped.bytes.toString("base64"),
      },
    });
  });
  const rawResponse = await callAnthropicJSON({
    apiKey: opts.cfg.apiKey,
    model: opts.cfg.model,
    system: systemPrompt,
    content,
  });
  const norm = normalizeValidatedFindings(rawResponse.text, {
    source: "anthropic_live",
    qualityWarnings: opts.qualityWarnings,
    evidenceIds: opts.evidenceIds,
    imageHashes: opts.imageHashes,
    inputFingerprint: opts.inputFingerprint,
  });
  return {
    provider: "anthropic",
    model: rawResponse.model,
    analysisSource: "anthropic_live",
    ...norm,
  };
}

/**
 * Direct provider helper (preserved cleanly for explicit single-provider tests like ai-eval.test.ts).
 */
export async function inspectTaskEvidence(opts: {
  task: TaskBundle;
  beforeImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  afterImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  aiOverride?: ActiveAIProviderConfig;
  fetchImpl?: typeof fetch;
  geminiFactory?: GeminiFactory;
}): Promise<{
  provider: AIProviderType;
  model: string;
  analysisSource: AIAnalysisSource;
  findings: AIStructuredFindings;
  recommendation: AIReviewRecord["recommendation"];
  evidenceIds: string[];
  imageHashes: string[];
  inputFingerprint: string;
  qualityWarnings: string[];
}> {
  if (!opts.beforeImages.length || !opts.afterImages.length) {
    throw new HttpError(
      409,
      "Both before and after photographs must be uploaded before running AI inspection."
    );
  }
  const quality = await assessEvidenceQuality(opts.beforeImages, opts.afterImages);
  const inputFingerprint = computeInspectionFingerprint({
    task: opts.task,
    beforeHashes: quality.beforeHashes,
    afterHashes: quality.afterHashes,
  });
  const cfg = await resolveActiveAIProvider(opts.aiOverride);
  const out = await runSingleProviderInference({
    cfg,
    task: opts.task,
    beforeImages: opts.beforeImages,
    afterImages: opts.afterImages,
    qualityWarnings: quality.warnings,
    evidenceIds: quality.evidenceIds,
    imageHashes: quality.allHashes,
    inputFingerprint,
    fetchImpl: opts.fetchImpl,
    geminiFactory: opts.geminiFactory,
  });
  return {
    ...out,
    evidenceIds: quality.evidenceIds,
    imageHashes: quality.allHashes,
    inputFingerprint,
    qualityWarnings: quality.warnings,
  };
}

export type OrchestratedInspectionOutcome =
  | {
      outcome: "cached";
      cachedReview: AIReviewRecord;
      qualityWarnings: string[];
      notice: string;
    }
  | {
      outcome: "ai_completed";
      provider: AIProviderType;
      model: string;
      analysisSource: AIAnalysisSource;
      findings: AIStructuredFindings;
      recommendation: AIReviewRecord["recommendation"];
      evidenceIds: string[];
      imageHashes: string[];
      inputFingerprint: string;
      qualityWarnings: string[];
      fallbackNotice?: string;
    }
  | {
      outcome: "guided_fallback";
      activeTier: "guided_checklist";
      reasonCode: GeminiErrorCode | "not_configured";
      message: string;
      qualityWarnings: string[];
      evidenceIds: string[];
      imageHashes: string[];
      inputFingerprint: string;
      template: ReturnType<typeof getGuidedChecklistTemplate>;
    };

const inFlightInspections = new Map<string, Promise<OrchestratedInspectionOutcome>>();

/**
 * 3-Tier Orchestrator:
 * Level 1: Gemini Live Vision -> Level 2: Local Ollama Vision -> Level 3: Guided Checklist Fallback.
 * Conserves free-tier quota with fingerprint caching & in-flight deduplication.
 */
export async function inspectTaskEvidenceWithFallback(opts: {
  task: TaskBundle;
  beforeImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  afterImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  retryLiveAI?: boolean;
  fetchImpl?: typeof fetch;
  geminiFactory?: GeminiFactory;
}): Promise<OrchestratedInspectionOutcome> {
  if (!opts.beforeImages.length || !opts.afterImages.length) {
    throw new HttpError(
      409,
      "Upload at least one BEFORE and one AFTER photograph before running AI inspection."
    );
  }

  const quality = await assessEvidenceQuality(opts.beforeImages, opts.afterImages);
  const inputFingerprint = computeInspectionFingerprint({
    task: opts.task,
    beforeHashes: quality.beforeHashes,
    afterHashes: quality.afterHashes,
  });

  if (opts.retryLiveAI) {
    clearGeminiCooldown();
  }

  // Free-tier conservation: reuse a verified genuine AI report when images, criteria, and notes are identical.
  if (!opts.retryLiveAI) {
    const cached = opts.task.reviews.find(
      (r) => r.is_genuine_ai && r.input_fingerprint === inputFingerprint
    );
    if (cached) {
      return {
        outcome: "cached",
        cachedReview: cached,
        qualityWarnings: quality.warnings,
        notice: `Reused verified ${cached.provider} inspection (${cached.model}) for unchanged photographs and criteria.`,
      };
    }
  }

  const dedupKey = `${opts.task.id}:${inputFingerprint}:${opts.retryLiveAI ? "retry" : "normal"}`;
  const existingFlight = inFlightInspections.get(dedupKey);
  if (existingFlight) {
    return existingFlight;
  }

  const work = (async (): Promise<OrchestratedInspectionOutcome> => {
    const geminiCred = await resolveGeminiCredential();
    const cooldown = getGeminiCooldownState();
    let fallbackReasonCode: GeminiErrorCode | "not_configured" = "not_configured";
    let fallbackReasonMessage =
      "Live AI inspection is temporarily unavailable. Guided review is available.";

    // Level 1: Gemini Live Vision
    if (geminiCred.configured && geminiCred.apiKey && !cooldown.active) {
      try {
        const res = await runSingleProviderInference({
          cfg: { provider: "gemini", apiKey: geminiCred.apiKey, model: geminiCred.model },
          task: opts.task,
          beforeImages: opts.beforeImages,
          afterImages: opts.afterImages,
          qualityWarnings: quality.warnings,
          evidenceIds: quality.evidenceIds,
          imageHashes: quality.allHashes,
          inputFingerprint,
          geminiFactory: opts.geminiFactory,
        });
        return {
          outcome: "ai_completed",
          ...res,
          evidenceIds: quality.evidenceIds,
          imageHashes: quality.allHashes,
          inputFingerprint,
          qualityWarnings: quality.warnings,
        };
      } catch (err) {
        if (err instanceof GeminiClassifiedError) {
          // Malformed output or corrupt image MUST fail visibly rather than faking fallback success.
          if (err.code === "malformed_response" || err.code === "invalid_image") {
            throw err;
          }
          fallbackReasonCode = err.code;
          fallbackReasonMessage = err.message;
        } else if (err instanceof HttpError && err.status === 502) {
          throw err;
        } else {
          fallbackReasonCode = "provider_unavailable";
          fallbackReasonMessage =
            err instanceof Error ? err.message : "Gemini inspection unavailable.";
        }
      }
    } else if (cooldown.active) {
      fallbackReasonCode = cooldown.code || "daily_quota_exhausted";
      fallbackReasonMessage =
        cooldown.reason || "Gemini quota cooldown active. Guided or local review is available.";
    }

    // Level 2: Local Ollama Multimodal Vision (only if running and model installed)
    const ollamaHealth = await probeOllamaHealth(opts.fetchImpl);
    if (ollamaHealth.reachable && ollamaHealth.modelAvailable) {
      try {
        const res = await runSingleProviderInference({
          cfg: { provider: "ollama", baseUrl: ollamaHealth.baseUrl, model: ollamaHealth.model },
          task: opts.task,
          beforeImages: opts.beforeImages,
          afterImages: opts.afterImages,
          qualityWarnings: quality.warnings,
          evidenceIds: quality.evidenceIds,
          imageHashes: quality.allHashes,
          inputFingerprint,
          fetchImpl: opts.fetchImpl,
        });
        return {
          outcome: "ai_completed",
          ...res,
          evidenceIds: quality.evidenceIds,
          imageHashes: quality.allHashes,
          inputFingerprint,
          qualityWarnings: quality.warnings,
          ...(geminiCred.configured
            ? {
                fallbackNotice: `Gemini unavailable (${fallbackReasonCode}); completed local vision inspection via Ollama (${ollamaHealth.model}).`,
              }
            : {}),
        };
      } catch (err) {
        if (err instanceof HttpError && err.status === 502) throw err;
        fallbackReasonMessage = `${fallbackReasonMessage} Local Ollama also failed (${
          err instanceof Error ? err.message : "error"
        }).`;
      }
    }

    // Optional Anthropic backup if explicitly configured and Level 1 failed due to unavailability
    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      try {
        const res = await runSingleProviderInference({
          cfg: {
            provider: "anthropic",
            apiKey: process.env.ANTHROPIC_API_KEY.trim(),
            model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
          },
          task: opts.task,
          beforeImages: opts.beforeImages,
          afterImages: opts.afterImages,
          qualityWarnings: quality.warnings,
          evidenceIds: quality.evidenceIds,
          imageHashes: quality.allHashes,
          inputFingerprint,
        });
        return {
          outcome: "ai_completed",
          ...res,
          evidenceIds: quality.evidenceIds,
          imageHashes: quality.allHashes,
          inputFingerprint,
          qualityWarnings: quality.warnings,
          ...(geminiCred.configured
            ? { fallbackNotice: `Switched from Gemini (${fallbackReasonCode}) to Anthropic.` }
            : {}),
        };
      } catch {
        // Proceed to Level 3 Guided Fallback cleanly
      }
    }

    // Level 3: Guided Inspection Fallback (never claims AI saw images)
    return {
      outcome: "guided_fallback",
      activeTier: "guided_checklist",
      reasonCode: fallbackReasonCode,
      message: `${fallbackReasonMessage} Guided review is available.`,
      qualityWarnings: quality.warnings,
      evidenceIds: quality.evidenceIds,
      imageHashes: quality.allHashes,
      inputFingerprint,
      template: getGuidedChecklistTemplate(opts.task),
    };
  })();

  inFlightInspections.set(dedupKey, work);
  try {
    return await work;
  } finally {
    inFlightInspections.delete(dedupKey);
  }
}

export async function answerInspectionQuestion(opts: {
  task: TaskBundle;
  question: string;
  images?: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  aiOverride?: ActiveAIProviderConfig;
  fetchImpl?: typeof fetch;
  geminiFactory?: GeminiFactory;
}): Promise<{
  answer: string;
  source: "deterministic_payment_rule" | "stored_inspection_record" | AIProviderType;
  model: string | null;
}> {
  const q = opts.question.trim();
  if (!q) throw new HttpError(400, "Enter a question about this repair inspection.");
  const lower = q.toLowerCase();

  // 1. Deterministic payment rules from live DB record (never let LLM guess payment IDs/statuses)
  if (
    /\b(reject|void|accept|capture|pay|payment|money|hold|paypal|simulat|status|how much|refund|authorized)\b/i.test(
      lower
    )
  ) {
    const p = opts.task.payment;
    const amt = `$${formatMinorUnits(p.amount_minor_units, p.currency)}`;
    const isSim = p.payment_mode === "simulation";
    const modeNote = isSim
      ? "This task is in Simulation mode (no real money moves)."
      : "This task uses PayPal Sandbox temporary authorizations (not escrow).";
    const refId = isSim
      ? p.sim_capture_id || p.sim_authorization_id || p.sim_intent_id || "none yet"
      : p.paypal_capture_id || p.paypal_authorization_id || p.paypal_order_id || "none yet";

    if (lower.includes("reject") || lower.includes("void")) {
      const stateRule =
        p.payment_status === "CAPTURED"
          ? `This ${amt} payment is already CAPTURED (${refId}), so voiding is no longer eligible.`
          : p.payment_status === "VOIDED"
          ? `This ${amt} hold is already VOIDED (${refId}); no funds were captured.`
          : p.payment_status === "AUTHORIZED"
          ? `Rejecting calls Void on authorization ${refId} (${amt}), releasing the uncaptured hold without charging the homeowner.`
          : `Current payment state is ${p.payment_status}; voiding applies once an authorization hold is active.`;
      return {
        answer: `${stateRule} Requesting corrections instead notifies the contractor while keeping any hold intact. ${modeNote}`,
        source: "deterministic_payment_rule",
        model: null,
      };
    }

    if (lower.includes("accept") || lower.includes("capture")) {
      const capRule =
        p.payment_status === "CAPTURED"
          ? `This ${amt} repair is already CAPTURED (${refId}).`
          : p.payment_status === "VOIDED"
          ? `This ${amt} authorization was VOIDED (${refId}) and cannot be captured.`
          : p.payment_status === "AUTHORIZED"
          ? `Accepting triggers settlement capture of ${amt} from hold ${refId} after explicit homeowner confirmation.`
          : `Current payment state is ${p.payment_status}; buyer authorization must succeed before capture is allowed.`;
      return {
        answer: `${capRule} AI findings are advisory only and never move funds automatically. ${modeNote}`,
        source: "deterministic_payment_rule",
        model: null,
      };
    }

    if (lower.includes("correct")) {
      return {
        answer: `Requesting corrections updates work status to CORRECTIONS_REQUESTED and leaves authorization ${refId} (${amt}) open while the contractor uploads revised photos. ${modeNote}`,
        source: "deterministic_payment_rule",
        model: null,
      };
    }

    return {
      answer: `Payment state for "${opts.task.title}" (${amt}) is currently ${p.payment_status} (reference: ${refId}). ${modeNote}`,
      source: "deterministic_payment_rule",
      model: null,
    };
  }

  // 2. Contextual scope guard
  const inScope =
    /\b(photo|image|before|after|issue|concern|defect|paint|tile|grout|patch|wall|floor|gap|align|criteri|unmet|satisfied|evidence|note|inspect|review|recommend|upload|uncertain|limit|notice|show|missing|next|inconclusive)\b/i.test(
      lower
    );
  if (!inScope) {
    return {
      answer:
        "I can only answer questions about this repair task's submitted photos, acceptance criteria, inspection findings, contractor notes, and PunchPay payment rules.",
      source: "deterministic_payment_rule",
      model: null,
    };
  }

  // 3. Try Level 1 (Gemini) or explicit override or Level 2 (Ollama) if reachable
  let cfg: ActiveAIProviderConfig | null = opts.aiOverride ?? null;
  if (!cfg) {
    const gem = await resolveGeminiCredential();
    if (gem.configured && gem.apiKey && !getGeminiCooldownState().active) {
      cfg = { provider: "gemini", apiKey: gem.apiKey, model: gem.model };
    } else {
      const ol = await probeOllamaHealth(opts.fetchImpl);
      if (ol.reachable && ol.modelAvailable) {
        cfg = { provider: "ollama", baseUrl: ol.baseUrl, model: ol.model };
      }
    }
  }

  const f = opts.task.latest_review?.structured_findings;
  if (cfg) {
    const system = `You answer homeowner follow-up questions about ONE repair inspection in 2-3 concise, neutral sentences.
Ground every claim strictly in the provided task details, acceptance criteria, stored findings, and submitted images. Never invent measurements or payment actions.`;
    const contextText = [
      `Task: ${opts.task.title} (${opts.task.description})`,
      `Acceptance criteria: ${opts.task.acceptance_criteria.join("; ")}`,
      `Contractor notes: ${opts.task.contractor_notes || "None"}`,
      `Work status: ${opts.task.work_status}`,
      f
        ? `Latest inspection (${opts.task.latest_review?.is_genuine_ai ? "AI" : "Guided checklist"}): ${
            f.overall_assessment
          } — ${f.summary} | Unmet: ${f.criteria_unmet.join("; ") || "None"} | Missing: ${
            f.missing_evidence.join("; ") || "None"
          } | Limits: ${f.limitations_and_uncertainty.join("; ")}`
        : "No inspection report has been generated yet.",
      `Question: ${q}`,
      `Return ONLY valid JSON: {"answer": "2-3 sentence grounded reply"}`,
    ].join("\n");

    try {
      const preppedImgs = await Promise.all(
        (opts.images ?? []).map(async (img) => ({
          record: img.record,
          prepped: await prepareImageForAI(img.bytes, img.record.mime_type),
        }))
      );
      const raw =
        cfg.provider === "ollama"
          ? await callOllamaChatJSON({
              baseUrl: cfg.baseUrl,
              model: cfg.model,
              system,
              userText: contextText,
              images: preppedImgs.map((i) => i.prepped.bytes),
              fetchImpl: opts.fetchImpl,
            })
          : cfg.provider === "gemini"
          ? await generateGeminiStructuredContent({
              apiKey: cfg.apiKey,
              model: cfg.model,
              systemInstruction: system,
              parts: [
                { text: contextText },
                ...preppedImgs.map((img) => ({
                  inlineData: {
                    mimeType: img.prepped.mimeType,
                    data: img.prepped.bytes.toString("base64"),
                  },
                })),
              ],
              clientFactory: opts.geminiFactory,
            })
          : await callAnthropicJSON({
              apiKey: cfg.apiKey,
              model: cfg.model,
              system,
              content: [
                { type: "text", text: contextText },
                ...preppedImgs.map((img) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: img.prepped.mimeType as "image/jpeg" | "image/png" | "image/webp",
                    data: img.prepped.bytes.toString("base64"),
                  },
                })),
              ],
            });
      const parsed = z
        .object({ answer: z.string().min(5) })
        .safeParse(parseJsonFromModel(raw.text));
      if (parsed.success) {
        return {
          answer: parsed.data.answer.trim(),
          source: cfg.provider,
          model: raw.model,
        };
      }
    } catch {
      // Fall through cleanly to deterministic stored/guided reply
    }
  }

  // 4. Deterministic reply grounded strictly in stored inspection or repair knowledge template
  if (f) {
    if (lower.includes("inconclusive") || lower.includes("uncertain") || lower.includes("why")) {
      return {
        answer: `Current inspection is marked "${f.overall_assessment.replaceAll("_", " ")}". ${
          f.limitations_and_uncertainty[0] || f.summary
        } ${f.missing_evidence[0] || ""}`.trim(),
        source: "stored_inspection_record",
        model: opts.task.latest_review?.model || null,
      };
    }
    if (lower.includes("unmet") || lower.includes("issue") || lower.includes("concern") || lower.includes("notice")) {
      const unmet = f.criteria_unmet.length
        ? f.criteria_unmet.join("; ")
        : "No criteria were marked unmet.";
      return {
        answer: `From stored inspection (${f.overall_assessment.replaceAll("_", " ")}): ${f.summary} Unmet criteria: ${unmet}`,
        source: "stored_inspection_record",
        model: opts.task.latest_review?.model || null,
      };
    }
    if (lower.includes("next") || lower.includes("more evidence") || lower.includes("photograph")) {
      const next = [...f.missing_evidence, ...f.recommended_next_steps].slice(0, 2).join(" ");
      return {
        answer: `Recommended next action: ${next || "Capture a clearer close-up photograph."} Limitation: ${
          f.limitations_and_uncertainty[0] || "Photographs show visible surfaces only."
        }`,
        source: "stored_inspection_record",
        model: opts.task.latest_review?.model || null,
      };
    }
    return {
      answer: `${f.summary} Satisfied: ${f.criteria_satisfied.length}; unmet: ${f.criteria_unmet.length}; unverifiable: ${f.criteria_unverifiable.length}.`,
      source: "stored_inspection_record",
      model: opts.task.latest_review?.model || null,
    };
  }

  const template = getGuidedChecklistTemplate(opts.task);
  if (lower.includes("next") || lower.includes("photograph")) {
    return {
      answer: `Recommended framing for ${opts.task.title}: ${template.recommendedPhotos.join(" ")}`,
      source: "stored_inspection_record",
      model: null,
    };
  }

  return {
    answer: `No inspection report is saved yet for "${opts.task.title}" (${opts.task.evidence.length} uploaded photo(s)). Check against agreed criteria: ${opts.task.acceptance_criteria.join("; ")}.`,
    source: "stored_inspection_record",
    model: null,
  };
}

export { setGeminiCooldown, clearGeminiCooldown, getGeminiCooldownState };
