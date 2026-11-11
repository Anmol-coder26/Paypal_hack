import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { HttpError } from "../errors";
import type { AIReviewRecord, AIStructuredFindings, EvidenceRecord, TaskBundle } from "../types";

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

function getActiveAIProvider():
  | { provider: "gemini"; apiKey: string; model: string }
  | { provider: "anthropic"; apiKey: string; model: string } {
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
  throw new HttpError(
    503,
    "No AI Vision provider key is configured. Add GEMINI_API_KEY or ANTHROPIC_API_KEY in .env.local to enable live AI calls."
  );
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

export async function generateScopeSuggestions(input: {
  title: string;
  description: string;
}): Promise<z.infer<typeof ScopeSuggestionSchema>> {
  const cfg = getActiveAIProvider();
  const systemPrompt = `You help homeowners write clear, visually verifiable acceptance criteria for small home repair tasks.
Return ONLY valid JSON matching:
{
  "improved_description": "concise 1-2 sentence scope",
  "suggested_criteria": ["3 to 5 specific visual acceptance criteria"],
  "evidence_photo_guidance": "short instruction on how before/after photos should be framed"
}`;
  const userPrompt = `Task title: ${input.title}\nRough description: ${input.description}`;

  const raw =
    cfg.provider === "gemini"
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
}): Promise<{
  provider: "gemini" | "anthropic";
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

  const cfg = getActiveAIProvider();
  const systemPrompt = `You are PunchPay's advisory repair evidence inspector for homeowners.
You NEVER approve, capture, or void payments; you only describe what is visible in the submitted BEFORE and AFTER photographs relative to the agreed acceptance criteria.

Strict Rules:
1. Ground every observation strictly in what is visible in the BEFORE and AFTER images.
2. Do NOT fabricate defects or claim to verify hidden workmanship, structural integrity, code compliance, or material thickness.
3. Evaluate each acceptance criterion individually as "satisfied", "unmet", or "unverifiable".
4. If angle, distance, glare, blur, or lighting prevents confident verification, mark criteria "unverifiable", set views_comparable appropriately, and explain why in limitations_and_uncertainty.
5. "overall_assessment":
   - "appears_satisfied" ONLY if ALL criteria are "satisfied" and views are comparable.
   - "concerns_identified" if ANY criterion is "unmet".
   - Otherwise "insufficient_evidence".
6. Return ONLY valid JSON with exact keys:
{
  "overall_assessment": "appears_satisfied" | "concerns_identified" | "insufficient_evidence",
  "summary": "2-3 clear sentences",
  "views_comparable": "yes" | "partly" | "no",
  "visible_observations": ["..."],
  "criteria_checks": [{"criterion": "...", "status": "satisfied" | "unmet" | "unverifiable", "observation": "..."}],
  "criteria_satisfied": ["..."],
  "criteria_unmet": ["..."],
  "criteria_unverifiable": ["..."],
  "missing_evidence": ["..."],
  "recommended_next_steps": ["..."],
  "suggested_outcome": "accept" | "request_more_evidence" | "review_concerns",
  "limitations_and_uncertainty": ["..."]
}`;

  const taskText = [
    `Repair Task: ${opts.task.title}`,
    `Scope: ${opts.task.description}`,
    `Contractor Notes: ${opts.task.contractor_notes || "None"}`,
    `Acceptance Criteria:`,
    ...opts.task.acceptance_criteria.map((c, idx) => `${idx + 1}. ${c}`),
  ].join("\n");

  let rawResponse: { text: string; model: string };

  if (cfg.provider === "gemini") {
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

  const parsed = EvidenceFindingsSchema.safeParse(parseJsonFromModel(rawResponse.text));
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
