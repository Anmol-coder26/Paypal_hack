import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { HttpError } from "../errors";
import { formatMinorUnits } from "../payments/state-machine";
import type {
  AIProviderType,
  AIReviewRecord,
  AIStructuredFindings,
  EvidenceRecord,
  TaskBundle,
} from "../types";
import { formatKnowledgeForPrompt, retrieveRepairKnowledge } from "./knowledge";

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
    "No AI Vision provider is configured. Start local Ollama (AI_PROVIDER=ollama with qwen2.5vl:3b) or add GEMINI_API_KEY / ANTHROPIC_API_KEY in .env.local."
  );
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
  };
  if (opts.formatSchema) {
    bodyPayload.format = opts.formatSchema;
  } else {
    bodyPayload.format = "json";
  }

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
            `Ollama model '${opts.model}' is not installed locally. Run 'ollama pull ${opts.model}' or review evidence manually.`
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
          `Local Ollama model '${opts.model}' timed out after 45s on available hardware. Consider a lighter model or Manual Checklist Review.`
        );
      }
      throw new HttpError(
        503,
        `Local Ollama server is not reachable at ${baseUrl}. Start Ollama ('ollama serve') or use Manual Checklist Review.`
      );
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new HttpError(503, "Local Ollama request failed.");
}

async function callGeminiJSON(opts: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  >;
}): Promise<{ text: string; model: string }> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    opts.model
  )}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemInstruction }] },
      contents: [{ role: "user", parts: opts.parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const payload = (await res.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string; status?: string };
  } | null;

  if (!res.ok) {
    const msg = payload?.error?.message || `Gemini API returned ${res.status}`;
    if (res.status === 429) throw new HttpError(429, `Gemini rate limit: ${msg}`);
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(503, `Gemini authentication failed: ${msg}`);
    }
    throw new HttpError(502, `Gemini API error: ${msg}`);
  }

  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new HttpError(502, "Gemini returned an empty response");
  }
  return { text, model: opts.model };
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
  opts?: { aiOverride?: ActiveAIProviderConfig; fetchImpl?: typeof fetch }
): Promise<z.infer<typeof ScopeSuggestionSchema>> {
  const cfg = getActiveAIProvider(opts?.aiOverride);
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
      ? await callGeminiJSON({
          apiKey: cfg.apiKey,
          model: cfg.model,
          systemInstruction: systemPrompt,
          parts: [{ text: userPrompt }],
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

export async function inspectTaskEvidence(opts: {
  task: TaskBundle;
  beforeImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  afterImages: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  aiOverride?: ActiveAIProviderConfig;
  fetchImpl?: typeof fetch;
}): Promise<{
  provider: AIProviderType;
  model: string;
  findings: AIStructuredFindings;
  recommendation: AIReviewRecord["recommendation"];
}> {
  if (!opts.beforeImages.length || !opts.afterImages.length) {
    throw new HttpError(
      409,
      "Both before and after photographs must be uploaded before running AI inspection."
    );
  }

  const cfg = getActiveAIProvider(opts.aiOverride);
  const knowledgeText = formatKnowledgeForPrompt(
    retrieveRepairKnowledge(opts.task.title, opts.task.description)
  );

  const systemPrompt = `You are PunchPay's cautious visual repair inspection assistant for homeowners.
You NEVER approve, capture, or void payments; you only describe what is visible in the submitted BEFORE and AFTER photographs relative to the agreed acceptance criteria.

Tone & Evidence Rules:
1. Write plain, neutral, concise English (no promotional adjectives, no "100% verified", no "perfect").
2. Specify whether each observation comes from the BEFORE or AFTER photo and distinguish direct observation from inference.
3. NEVER invent physical measurements (millimeters/inches) or uncalibrated confidence percentages.
4. Use the category inspection guidelines ONLY as a checklist of things to look for — never assume a category passes or fails until you check the actual pixels.
5. Evaluate every agreed acceptance criterion individually as "satisfied", "unmet", or "unverifiable".
6. If framing, distance, darkness, blur, glare, or cropping prevents confident comparison, set views_comparable to "partly" or "no", mark uncertain criteria "unverifiable", and explain what photos cannot confirm in limitations_and_uncertainty.
7. "overall_assessment":
   - "appears_satisfied" ONLY if ALL criteria are "satisfied" and views are comparable.
   - "concerns_identified" if ANY criterion is "unmet".
   - Otherwise "insufficient_evidence".
8. Return ONLY valid JSON matching the exact schema.`;

  const taskText = [
    `Repair Task: ${opts.task.title}`,
    `Scope: ${opts.task.description}`,
    `Contractor Notes: ${opts.task.contractor_notes || "None"}`,
    `Acceptance Criteria:`,
    ...opts.task.acceptance_criteria.map((c, idx) => `${idx + 1}. ${c}`),
    "",
    knowledgeText,
    "",
    `Images supplied below in order: ${opts.beforeImages.length} BEFORE image(s), followed by ${opts.afterImages.length} AFTER image(s).`,
  ].join("\n");

  let rawResponse: { text: string; model: string };

  if (cfg.provider === "ollama") {
    const orderedImages = [
      ...opts.beforeImages.map((img) => img.bytes),
      ...opts.afterImages.map((img) => img.bytes),
    ];
    rawResponse = await callOllamaChatJSON({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      system: systemPrompt,
      userText: taskText,
      images: orderedImages,
      formatSchema: EVIDENCE_JSON_SCHEMA,
      fetchImpl: opts.fetchImpl,
    });
  } else if (cfg.provider === "gemini") {
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: taskText }];
    opts.beforeImages.forEach((img, idx) => {
      parts.push({ text: `BEFORE PHOTO #${idx + 1}:` });
      parts.push({
        inlineData: {
          mimeType: img.record.mime_type,
          data: img.bytes.toString("base64"),
        },
      });
    });
    opts.afterImages.forEach((img, idx) => {
      parts.push({ text: `AFTER PHOTO #${idx + 1}:` });
      parts.push({
        inlineData: {
          mimeType: img.record.mime_type,
          data: img.bytes.toString("base64"),
        },
      });
    });
    rawResponse = await callGeminiJSON({
      apiKey: cfg.apiKey,
      model: cfg.model,
      systemInstruction: systemPrompt,
      parts,
    });
  } else {
    const content: Anthropic.ContentBlockParam[] = [{ type: "text", text: taskText }];
    opts.beforeImages.forEach((img, idx) => {
      content.push({ type: "text", text: `BEFORE PHOTO #${idx + 1}:` });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.record.mime_type as "image/jpeg" | "image/png" | "image/webp",
          data: img.bytes.toString("base64"),
        },
      });
    });
    opts.afterImages.forEach((img, idx) => {
      content.push({ type: "text", text: `AFTER PHOTO #${idx + 1}:` });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.record.mime_type as "image/jpeg" | "image/png" | "image/webp",
          data: img.bytes.toString("base64"),
        },
      });
    });
    rawResponse = await callAnthropicJSON({
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: systemPrompt,
      content,
    });
  }

  let jsonParsed: unknown;
  try {
    jsonParsed = parseJsonFromModel(rawResponse.text);
  } catch {
    throw new HttpError(502, "AI inspection returned non-JSON output; please retry.");
  }
  const parsed = EvidenceFindingsSchema.safeParse(jsonParsed);
  if (!parsed.success) {
    throw new HttpError(502, "AI inspection output failed schema validation; please retry.");
  }

  const out = parsed.data;
  // Server-side evidence consistency guard: never overstate support.
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
  };

  return {
    provider: cfg.provider,
    model: rawResponse.model,
    findings,
    recommendation: suggested,
  };
}

export async function answerInspectionQuestion(opts: {
  task: TaskBundle;
  question: string;
  images?: Array<{ record: EvidenceRecord; bytes: Buffer }>;
  aiOverride?: ActiveAIProviderConfig;
  fetchImpl?: typeof fetch;
}): Promise<{
  answer: string;
  source: "deterministic_payment_rule" | "stored_inspection_record" | AIProviderType;
  model: string | null;
}> {
  const q = opts.question.trim();
  if (!q) throw new HttpError(400, "Enter a question about this repair inspection.");
  const lower = q.toLowerCase();

  // 1. Deterministic payment workflow answers directly from stored record (never let LLM invent tx rules/IDs)
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

    return {
      answer: `Payment state for "${opts.task.title}" (${amt}) is currently ${p.payment_status} (reference: ${refId}). ${modeNote}`,
      source: "deterministic_payment_rule",
      model: null,
    };
  }

  // 2. Scope check: must relate to repair, photos, criteria, notes, inspection, defects, next steps
  const inScope =
    /\b(photo|image|before|after|issue|concern|defect|paint|tile|grout|patch|wall|floor|gap|align|criteri|unmet|satisfied|evidence|note|inspect|review|recommend|upload|uncertain|limit|notice|show|missing|next)\b/i.test(
      lower
    );
  if (!inScope) {
    return {
      answer:
        "I can only answer questions about this repair task's submitted photos, acceptance criteria, AI inspection findings, contractor notes, and PunchPay payment rules.",
      source: "deterministic_payment_rule",
      model: null,
    };
  }

  // 3. Try active AI model with task context + photos if configured
  let cfg: ActiveAIProviderConfig | null;
  try {
    cfg = getActiveAIProvider(opts.aiOverride);
  } catch {
    cfg = null;
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
        ? `Latest AI assessment: ${f.overall_assessment} — ${f.summary} | Unmet: ${
            f.criteria_unmet.join("; ") || "None"
          } | Missing: ${f.missing_evidence.join("; ") || "None"} | Limits: ${
            f.limitations_and_uncertainty.join("; ")
          }`
        : "No AI vision report has been generated yet.",
      `Question: ${q}`,
      `Return ONLY valid JSON: {"answer": "2-3 sentence grounded reply"}`,
    ].join("\n");

    try {
      const raw =
        cfg.provider === "ollama"
          ? await callOllamaChatJSON({
              baseUrl: cfg.baseUrl,
              model: cfg.model,
              system,
              userText: contextText,
              images: (opts.images ?? []).map((i) => i.bytes),
              fetchImpl: opts.fetchImpl,
            })
          : cfg.provider === "gemini"
          ? await callGeminiJSON({
              apiKey: cfg.apiKey,
              model: cfg.model,
              systemInstruction: system,
              parts: [
                { text: contextText },
                ...(opts.images ?? []).map((img) => ({
                  inlineData: { mimeType: img.record.mime_type, data: img.bytes.toString("base64") },
                })),
              ],
            })
          : await callAnthropicJSON({
              apiKey: cfg.apiKey,
              model: cfg.model,
              system,
              content: [
                { type: "text", text: contextText },
                ...(opts.images ?? []).map((img) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: img.record.mime_type as "image/jpeg" | "image/png" | "image/webp",
                    data: img.bytes.toString("base64"),
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
      // Fall through cleanly to stored inspection record summary if model unreachable
    }
  }

  // 4. Honest fallback strictly from stored task & AI record (never inventing visual claims)
  if (f) {
    if (lower.includes("unmet") || lower.includes("issue") || lower.includes("concern") || lower.includes("notice")) {
      const unmet = f.criteria_unmet.length
        ? f.criteria_unmet.join("; ")
        : "No criteria were marked unmet.";
      return {
        answer: `From the stored inspection (${f.overall_assessment.replaceAll("_", " ")}): ${f.summary} Unmet criteria: ${unmet}`,
        source: "stored_inspection_record",
        model: opts.task.latest_review?.model || null,
      };
    }
    if (lower.includes("next") || lower.includes("more evidence") || lower.includes("photograph")) {
      const next = [...f.missing_evidence, ...f.recommended_next_steps].slice(0, 2).join(" ");
      return {
        answer: `Stored inspection recommends: ${next || "Verify surfaces directly in person before releasing funds."} Limitation: ${f.limitations_and_uncertainty[0] || "Photos show visible surfaces only."}`,
        source: "stored_inspection_record",
        model: opts.task.latest_review?.model || null,
      };
    }
    return {
      answer: `${f.summary} Satisfied criteria: ${f.criteria_satisfied.length}; unmet: ${f.criteria_unmet.length}; unverifiable: ${f.criteria_unverifiable.length}.`,
      source: "stored_inspection_record",
      model: opts.task.latest_review?.model || null,
    };
  }

  return {
    answer: `No live AI inspection report is stored yet for "${opts.task.title}" (${opts.task.evidence.length} uploaded photo(s)). Criteria to verify manually: ${opts.task.acceptance_criteria.join("; ")}.`,
    source: "stored_inspection_record",
    model: null,
  };
}
