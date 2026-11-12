import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearGeminiCooldown,
  getGeminiCooldownState,
  getGeminiPublicMetadata,
  testGeminiConnection,
  type GeminiFactory,
} from "../lib/ai/gemini";
import { buildGuidedChecklistFindings } from "../lib/ai/knowledge";
import {
  assessEvidenceQuality,
  inspectTaskEvidence,
  inspectTaskEvidenceWithFallback,
} from "../lib/ai/provider";
import { getRepo, resetRepoForTests } from "../lib/db";
import { SqliteRepository } from "../lib/db/sqlite";
import {
  clearVaultCacheForTests,
  decryptCredential,
  encryptCredential,
} from "../lib/security/secrets-vault";
import type { EvidenceRecord, TaskBundle } from "../lib/types";

let tmpDir: string;
let prevDbPath: string | undefined;
let prevVaultPath: string | undefined;
let prevGeminiEnv: string | undefined;

async function makePng(r: number, g: number, b: number, width = 320, height = 240): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r, g, b },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect x="20" y="20" width="80" height="60" fill="rgb(${255 - r},30,40)"/></svg>`
        ),
      },
    ])
    .png()
    .toBuffer();
}

function makeEvidence(id: string, type: "before" | "after", bytes: Buffer): EvidenceRecord {
  return {
    id,
    task_id: "task-test-1",
    uploaded_by: "22222222-2222-4222-8222-222222222202",
    image_storage_path: `${id}.png`,
    evidence_type: type,
    mime_type: "image/png",
    byte_size: bytes.byteLength,
    width: 320,
    height: 240,
    notes: "",
    created_at: new Date().toISOString(),
  };
}

function makeTask(reviews: TaskBundle["reviews"] = []): TaskBundle {
  const now = new Date().toISOString();
  return {
    id: "task-test-1",
    project_id: "proj-test-1",
    title: "Tile Repair",
    description: "Replace cracked backsplash tile near sink",
    acceptance_criteria: ["Damaged tile replaced", "Grout edges filled cleanly"],
    amount_minor_units: 2000,
    currency: "USD",
    work_status: "EVIDENCE_SUBMITTED",
    payment_status: "AUTHORIZED",
    contractor_notes: "Replaced center tile and applied unsanded grout.",
    homeowner_feedback: "",
    created_at: now,
    updated_at: now,
    payment: {
      id: "pay-1",
      task_id: "task-test-1",
      payment_mode: "simulation",
      paypal_order_id: null,
      paypal_authorization_id: null,
      paypal_capture_id: null,
      paypal_status: null,
      sim_intent_id: "SIM-INT-1",
      sim_authorization_id: "SIM-AUTH-1",
      sim_capture_id: null,
      sim_status: "CREATED",
      payee_merchant_id: "SIM-MERCHANT",
      amount_minor_units: 2000,
      currency: "USD",
      payment_status: "AUTHORIZED",
      order_attempt: 1,
      request_nonce: "nonce-1",
      authorization_created_at: now,
      authorization_expires_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    },
    evidence: [],
    annotations: [],
    latest_review: reviews[0] ?? null,
    reviews,
    decisions: [],
    events: [],
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "punchpay-ai-vault-"));
  prevDbPath = process.env.PUNCHPAY_DB_PATH;
  prevVaultPath = process.env.PUNCHPAY_VAULT_KEY_PATH;
  prevGeminiEnv = process.env.GEMINI_API_KEY;
});

beforeEach(() => {
  resetRepoForTests();
  clearVaultCacheForTests();
  clearGeminiCooldown();
  delete process.env.GEMINI_API_KEY;
  process.env.PUNCHPAY_DB_PATH = path.join(tmpDir, `test-${Math.random().toString(16).slice(2)}.db`);
  process.env.PUNCHPAY_VAULT_KEY_PATH = path.join(tmpDir, "vault-master.key");
});

afterAll(() => {
  resetRepoForTests();
  if (prevDbPath === undefined) delete process.env.PUNCHPAY_DB_PATH;
  else process.env.PUNCHPAY_DB_PATH = prevDbPath;
  if (prevVaultPath === undefined) delete process.env.PUNCHPAY_VAULT_KEY_PATH;
  else process.env.PUNCHPAY_VAULT_KEY_PATH = prevVaultPath;
  if (prevGeminiEnv === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = prevGeminiEnv;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore Windows lock cleanup warnings in tmpdir
  }
});

describe("Encrypted credential vault & Gemini configuration", () => {
  it("encrypts API keys separately with AES-256-GCM and falls back cleanly to environment keys", async () => {
    const repo = getRepo();
    const sampleKey = "AIzaSyTestFakeVaultSecret123456";
    const encrypted = encryptCredential(sampleKey);

    expect(encrypted).not.toContain(sampleKey);
    expect(decryptCredential(encrypted)).toBe(sampleKey);

    const saved = await repo.saveServerCredential({
      provider: "gemini",
      encrypted_payload: encrypted,
      model: "gemini-3.6-flash",
      updated_by: "admin-1",
    });
    expect(saved.encrypted_payload).not.toContain(sampleKey);
    expect(fs.existsSync(process.env.PUNCHPAY_VAULT_KEY_PATH!)).toBe(true);

    const publicMeta = await getGeminiPublicMetadata();
    expect(publicMeta.configured).toBe(true);
    expect(publicMeta.source).toBe("admin_vault");
    expect(JSON.stringify(publicMeta)).not.toContain(sampleKey);

    // Tampered key must fail decryption
    process.env.PUNCHPAY_VAULT_KEY_PATH = path.join(tmpDir, "other-wrong.key");
    clearVaultCacheForTests();
    expect(() => decryptCredential(encrypted)).toThrow();

    // Verify environment alternative is respected after removing DB vault key
    process.env.PUNCHPAY_VAULT_KEY_PATH = path.join(tmpDir, "vault-master.key");
    clearVaultCacheForTests();
    process.env.GEMINI_API_KEY = "AIzaSyEnvFallbackKey7890";
    await repo.deleteServerCredential("gemini");

    const rowAfterDelete = await repo.getServerCredential("gemini");
    expect(rowAfterDelete).toBeNull();
    const envMeta = await getGeminiPublicMetadata();
    expect(envMeta.configured).toBe(true);
    expect(envMeta.source).toBe("environment");
    expect(JSON.stringify(envMeta)).not.toContain("AIzaSyEnvFallbackKey7890");
    expect(process.env.GEMINI_API_KEY).toBe("AIzaSyEnvFallbackKey7890");
    if (repo instanceof SqliteRepository) resetRepoForTests();
  });

  it("classifies connection test responses accurately without exposing secrets", async () => {
    const validFactory: GeminiFactory = () => ({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ ok: true, received_image: true }),
        }),
      },
    });
    const okRes = await testGeminiConnection({
      apiKey: "AIzaValidKeyMock123",
      model: "gemini-3.6-flash",
      clientFactory: validFactory,
    });
    expect(okRes.ok).toBe(true);
    expect(JSON.stringify(okRes)).not.toContain("AIzaValidKeyMock123");

    const invalidKeyFactory: GeminiFactory = () => ({
      models: {
        generateContent: async () => {
          const err = new Error("API_KEY_INVALID: API key not valid.") as Error & { status: number };
          err.status = 400;
          throw err;
        },
      },
    });
    const badRes = await testGeminiConnection({
      apiKey: "bad-key-1234",
      model: "gemini-3.6-flash",
      clientFactory: invalidKeyFactory,
    });
    expect(badRes.ok).toBe(false);
    expect(badRes.code).toBe("invalid_api_key");
  });
});

describe("Gemini AI inspection, image quality checks & 3-tier fallback", () => {
  it("runs structured inspection on real images, deduplicates identical runs, and runs fresh review when images change", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyUnitTestKey00001";
    const before1 = await makePng(230, 220, 210);
    const after1 = await makePng(210, 230, 225);
    const after2 = await makePng(120, 140, 180);

    let callCount = 0;
    const mockFactory: GeminiFactory = () => ({
      models: {
        generateContent: async ({ contents }) => {
          callCount += 1;
          // Ensure binary image inlineData parts were genuinely attached
          const serialized = JSON.stringify(contents);
          expect(serialized).toContain("inlineData");
          return {
            text: JSON.stringify({
              overall_assessment: "concerns_identified",
              summary: `Review #${callCount}: Replacement tile shows a visible grout gap.`,
              views_comparable: "yes",
              visible_observations: [
                "AFTER photo shows a dark gap along the right perimeter edge relative to BEFORE.",
              ],
              criteria_checks: [
                {
                  criterion: "Damaged tile replaced",
                  status: "satisfied",
                  observation: "Cracked tile from BEFORE photo is replaced in AFTER.",
                },
                {
                  criterion: "Grout edges filled cleanly",
                  status: "unmet",
                  observation: "Right perimeter grout seam shows an unfilled dark void in AFTER.",
                },
              ],
              criteria_satisfied: ["Damaged tile replaced"],
              criteria_unmet: ["Grout edges filled cleanly"],
              criteria_unverifiable: [],
              missing_evidence: [],
              recommended_next_steps: ["Request grout fill and updated close-up photo."],
              suggested_outcome: "review_concerns",
              limitations_and_uncertainty: ["Photographs cannot verify thin-set bond beneath the tile."],
            }),
          };
        },
      },
    });

    const task = makeTask();
    const bRec = makeEvidence("ev-b1", "before", before1);
    const aRec1 = makeEvidence("ev-a1", "after", after1);

    // Concurrency deduplication: two simultaneous calls trigger only ONE Gemini request
    const [r1, r2] = await Promise.all([
      inspectTaskEvidenceWithFallback({
        task,
        beforeImages: [{ record: bRec, bytes: before1 }],
        afterImages: [{ record: aRec1, bytes: after1 }],
        geminiFactory: mockFactory,
      }),
      inspectTaskEvidenceWithFallback({
        task,
        beforeImages: [{ record: bRec, bytes: before1 }],
        afterImages: [{ record: aRec1, bytes: after1 }],
        geminiFactory: mockFactory,
      }),
    ]);
    expect(callCount).toBe(1);
    expect(r1.outcome).toBe("ai_completed");
    expect(r2.outcome).toBe("ai_completed");
    if (r1.outcome !== "ai_completed") throw new Error("Expected ai_completed");
    expect(r1.analysisSource).toBe("gemini_live");
    expect(r1.imageHashes).toHaveLength(2);

    // Re-running with SAME saved review & SAME images reuses cache (0 extra Gemini calls)
    const savedV1 = {
      id: "rev-1",
      task_id: task.id,
      model: r1.model,
      provider: r1.provider,
      analysis_source: r1.analysisSource,
      is_genuine_ai: true,
      analyzed_evidence_ids: r1.evidenceIds,
      image_hashes: r1.imageHashes,
      input_fingerprint: r1.inputFingerprint,
      structured_findings: r1.findings,
      recommendation: r1.recommendation,
      review_version: 1,
      created_at: new Date().toISOString(),
    };
    const taskWithV1 = makeTask([savedV1]);
    const cachedOut = await inspectTaskEvidenceWithFallback({
      task: taskWithV1,
      beforeImages: [{ record: bRec, bytes: before1 }],
      afterImages: [{ record: aRec1, bytes: after1 }],
      geminiFactory: mockFactory,
    });
    expect(cachedOut.outcome).toBe("cached");
    expect(callCount).toBe(1);

    // Changing AFTER image invalidates fingerprint & runs a NEW Gemini call cleanly
    const aRec2 = makeEvidence("ev-a2", "after", after2);
    const r3 = await inspectTaskEvidenceWithFallback({
      task: taskWithV1,
      beforeImages: [{ record: bRec, bytes: before1 }],
      afterImages: [{ record: aRec2, bytes: after2 }],
      geminiFactory: mockFactory,
    });
    expect(r3.outcome).toBe("ai_completed");
    expect(callCount).toBe(2);
  });

  it("warns on identical before/after files and rejects malformed model JSON cleanly", async () => {
    const img = await makePng(200, 200, 200);
    const quality = await assessEvidenceQuality(
      [{ record: makeEvidence("b1", "before", img), bytes: img }],
      [{ record: makeEvidence("a1", "after", img), bytes: img }]
    );
    expect(quality.warnings.some((w) => /identical sha-256/i.test(w))).toBe(true);

    const malformedFactory: GeminiFactory = () => ({
      models: { generateContent: async () => ({ text: "{not valid json" }) },
    });
    await expect(
      inspectTaskEvidence({
        task: makeTask(),
        beforeImages: [{ record: makeEvidence("b1", "before", img), bytes: img }],
        afterImages: [{ record: makeEvidence("a1", "after", await makePng(120, 120, 120)), bytes: img }],
        aiOverride: { provider: "gemini", apiKey: "AIzaMock", model: "gemini-3.6-flash" },
        geminiFactory: malformedFactory,
      })
    ).rejects.toThrow(/non-JSON/i);
  });

  it("handles HTTP 429 daily quota by activating cooldown -> Local AI Ollama -> Guided Checklist fallback -> retry recovery", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyQuotaTestKey999";
    const before = await makePng(220, 220, 220);
    const after = await makePng(190, 210, 230);
    const bRec = makeEvidence("b-429", "before", before);
    const aRec = makeEvidence("a-429", "after", after);
    const task = makeTask();

    let geminiCalls = 0;
    const quota429Factory: GeminiFactory = () => ({
      models: {
        generateContent: async () => {
          geminiCalls += 1;
          const err = new Error("RESOURCE_EXHAUSTED: Free tier quota exceeded per day.") as Error & {
            status: number;
          };
          err.status = 429;
          throw err;
        },
      },
    });

    // 1. Mock reachable local Ollama server -> Level 2 succeeds cleanly
    const mockOllama = http.createServer((req, res) => {
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "qwen2.5vl:3b" }] }));
        return;
      }
      if (req.url === "/api/chat") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: "qwen2.5vl:3b",
            message: {
              content: JSON.stringify({
                overall_assessment: "appears_satisfied",
                summary: "Local Ollama review found criteria supported.",
                views_comparable: "yes",
                visible_observations: ["AFTER shows repaired tile surface."],
                criteria_checks: [
                  { criterion: "Damaged tile replaced", status: "satisfied", observation: "Replaced in AFTER." },
                  { criterion: "Grout edges filled cleanly", status: "satisfied", observation: "Joint filled." },
                ],
                criteria_satisfied: ["Damaged tile replaced", "Grout edges filled cleanly"],
                criteria_unmet: [],
                criteria_unverifiable: [],
                missing_evidence: [],
                recommended_next_steps: ["Proceed to homeowner review"],
                suggested_outcome: "accept",
                limitations_and_uncertainty: ["2D surface photo only."],
              }),
            },
          })
        );
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => mockOllama.listen(0, "127.0.0.1", () => r()));
    const addr = mockOllama.address() as { port: number };
    const prevOllamaUrl = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${addr.port}`;

    try {
      const level2 = await inspectTaskEvidenceWithFallback({
        task,
        beforeImages: [{ record: bRec, bytes: before }],
        afterImages: [{ record: aRec, bytes: after }],
        geminiFactory: quota429Factory,
      });
      expect(level2.outcome).toBe("ai_completed");
      if (level2.outcome !== "ai_completed") throw new Error("Expected Level 2 Ollama");
      expect(level2.provider).toBe("ollama");
      expect(level2.analysisSource).toBe("ollama_local");
      expect(getGeminiCooldownState().active).toBe(true);
      expect(geminiCalls).toBe(1);

      // 2. While Ollama is unreachable & cooldown is active -> skips redundant Gemini calls -> Level 3 Guided Fallback
      process.env.OLLAMA_BASE_URL = "http://127.0.0.1:59999";
      const level3 = await inspectTaskEvidenceWithFallback({
        task,
        beforeImages: [{ record: bRec, bytes: before }],
        afterImages: [{ record: aRec, bytes: after }],
        geminiFactory: quota429Factory,
      });
      expect(geminiCalls).toBe(1); // Cooldown respected: zero wasted 429 retries!
      expect(level3.outcome).toBe("guided_fallback");
      if (level3.outcome !== "guided_fallback") throw new Error("Expected guided_fallback");
      expect(level3.activeTier).toBe("guided_checklist");

      const guidedFindings = buildGuidedChecklistFindings({
        task,
        criteriaResponses: [
          { criterion: "Damaged tile replaced", status: "satisfied" },
          { criterion: "Grout edges filled cleanly", status: "unmet", note: "Open right seam visible." },
        ],
        needsCloserPhoto: true,
      });
      expect(guidedFindings.is_genuine_ai).toBe(false);
      expect(guidedFindings.analysis_source).toBe("guided_checklist");
      expect(guidedFindings.overall_assessment).toBe("concerns_identified");
      expect(guidedFindings.summary).toMatch(/User-reported/i);

      // 3. Recovery: retryLiveAI restores Level 1 Gemini when succeeding
      const recoveredFactory: GeminiFactory = () => ({
        models: {
          generateContent: async () => ({
            text: JSON.stringify({
              overall_assessment: "appears_satisfied",
              summary: "Gemini recovered cleanly after retry.",
              views_comparable: "yes",
              visible_observations: ["AFTER photo shows intact surface."],
              criteria_checks: [
                { criterion: "Damaged tile replaced", status: "satisfied", observation: "Visible in AFTER." },
                { criterion: "Grout edges filled cleanly", status: "satisfied", observation: "Edges filled." },
              ],
              criteria_satisfied: ["Damaged tile replaced", "Grout edges filled cleanly"],
              criteria_unmet: [],
              criteria_unverifiable: [],
              missing_evidence: [],
              recommended_next_steps: ["Proceed to homeowner review"],
              suggested_outcome: "accept",
              limitations_and_uncertainty: ["Surface visibility only."],
            }),
          }),
        },
      });
      const recovered = await inspectTaskEvidenceWithFallback({
        task,
        beforeImages: [{ record: bRec, bytes: before }],
        afterImages: [{ record: aRec, bytes: after }],
        retryLiveAI: true,
        geminiFactory: recoveredFactory,
      });
      expect(recovered.outcome).toBe("ai_completed");
      if (recovered.outcome === "ai_completed") {
        expect(recovered.provider).toBe("gemini");
        expect(recovered.analysisSource).toBe("gemini_live");
      }
      expect(getGeminiCooldownState().active).toBe(false);
    } finally {
      if (prevOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
      else process.env.OLLAMA_BASE_URL = prevOllamaUrl;
      await new Promise<void>((r) => mockOllama.close(() => r()));
    }
  });
});
