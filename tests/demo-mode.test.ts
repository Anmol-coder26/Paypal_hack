import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PREPARED_DEMO_SCENARIOS, clearPreparedDemoSignatureCache } from "../lib/ai/prepared-demo";
import {
  answerInspectionQuestion,
  inspectTaskEvidenceWithFallback,
} from "../lib/ai/provider";
import { sanitizeImage } from "../lib/image";
import type { EvidenceRecord, TaskBundle } from "../lib/types";

const KIT_DIR = path.resolve(process.cwd(), "public", "demo-kit");

function makeTask(title: string, description: string, criteria: string[]): TaskBundle {
  const now = new Date().toISOString();
  return {
    id: `demo-task-${title.toLowerCase().replace(/\s+/g, "-")}`,
    project_id: "demo-project-1",
    title,
    description,
    acceptance_criteria: criteria,
    amount_minor_units: 3000,
    currency: "USD",
    work_status: "EVIDENCE_SUBMITTED",
    payment_status: "AUTHORIZED",
    contractor_notes: "",
    homeowner_feedback: "",
    created_at: now,
    updated_at: now,
    payment: {
      id: "pay-demo-1",
      task_id: "demo-task-1",
      payment_mode: "simulation",
      paypal_order_id: null,
      paypal_authorization_id: null,
      paypal_capture_id: null,
      paypal_status: null,
      sim_intent_id: "DEMO-ORD-11111",
      sim_authorization_id: "DEMO-AUTH-22222",
      sim_capture_id: null,
      sim_void_id: null,
      sim_status: "CREATED",
      payee_merchant_id: "DEMO-MERCHANT",
      amount_minor_units: 3000,
      currency: "USD",
      payment_status: "AUTHORIZED",
      order_attempt: 1,
      request_nonce: "nonce-demo",
      authorization_created_at: now,
      authorization_expires_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    },
    evidence: [],
    annotations: [],
    latest_review: null,
    reviews: [],
    decisions: [],
    events: [],
  };
}

function makeEv(id: string, type: "before" | "after", bytes: Buffer): EvidenceRecord {
  return {
    id,
    task_id: "demo-task-1",
    uploaded_by: "contractor-1",
    image_storage_path: `${id}.png`,
    evidence_type: type,
    mime_type: "image/png",
    byte_size: bytes.byteLength,
    width: 800,
    height: 600,
    notes: "",
    created_at: new Date().toISOString(),
  };
}

describe("Prepared Demo Inspection Mode (AI_PROVIDER=demo)", () => {
  let prevDemoMode: string | undefined;
  let prevAiProvider: string | undefined;
  let prevGeminiKey: string | undefined;

  beforeAll(() => {
    prevDemoMode = process.env.PUNCHPAY_DEMO_MODE;
    prevAiProvider = process.env.AI_PROVIDER;
    prevGeminiKey = process.env.GEMINI_API_KEY;
    clearPreparedDemoSignatureCache();
  });

  beforeEach(() => {
    process.env.PUNCHPAY_DEMO_MODE = "true";
    process.env.AI_PROVIDER = "demo";
    process.env.GEMINI_API_KEY = "AIzaShouldNotBeCalledInDemoMode";
  });

  afterAll(() => {
    if (prevDemoMode === undefined) delete process.env.PUNCHPAY_DEMO_MODE;
    else process.env.PUNCHPAY_DEMO_MODE = prevDemoMode;
    if (prevAiProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = prevAiProvider;
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;
  });

  it("matches all 6 curated sample photo sets accurately after sharp sanitization with zero live AI calls", async () => {
    const taskTemplates: Record<string, { title: string; desc: string; criteria: string[] }> = {
      painting_satisfactory: {
        title: "Painting",
        desc: "Repaint scuffed drywall beside north window",
        criteria: ["Coverage looks uniform", "Edges appear clean"],
      },
      painting_uneven: {
        title: "Painting",
        desc: "Repaint scuffed drywall beside north window",
        criteria: ["Coverage looks uniform", "Edges appear clean"],
      },
      tile_aligned: {
        title: "Tile Repair",
        desc: "Replace cracked backsplash tile and finish grout",
        criteria: ["Damaged tile replaced", "Alignment consistent", "No obvious visible gaps"],
      },
      tile_gaps_misaligned: {
        title: "Tile Repair",
        desc: "Replace cracked backsplash tile and finish grout",
        criteria: ["Damaged tile replaced", "Alignment consistent", "No obvious visible gaps"],
      },
      wall_completed: {
        title: "Wall Patch",
        desc: "Repair drywall hole near light switch",
        criteria: ["Hole closed cleanly", "Surface feathered flush"],
      },
      wall_concern: {
        title: "Wall Patch",
        desc: "Repair drywall hole near light switch",
        criteria: ["Hole closed cleanly", "Surface feathered flush"],
      },
    };

    for (const scenario of PREPARED_DEMO_SCENARIOS) {
      const tpl = taskTemplates[scenario.id];
      const beforeSanitized = await sanitizeImage(
        fs.readFileSync(path.join(KIT_DIR, scenario.beforeFile)),
        "image/png"
      );
      const afterSanitized = await sanitizeImage(
        fs.readFileSync(path.join(KIT_DIR, scenario.afterFile)),
        "image/png"
      );
      const out = await inspectTaskEvidenceWithFallback({
        task: makeTask(tpl.title, tpl.desc, tpl.criteria),
        beforeImages: [{ record: makeEv(`b-${scenario.id}`, "before", beforeSanitized.bytes), bytes: beforeSanitized.bytes }],
        afterImages: [{ record: makeEv(`a-${scenario.id}`, "after", afterSanitized.bytes), bytes: afterSanitized.bytes }],
      });
      expect(out.outcome).toBe("prepared_demo_completed");
      if (out.outcome !== "prepared_demo_completed") throw new Error("Expected prepared_demo_completed");
      expect(out.analysisSource).toBe("prepared_demo");
      expect(out.findings.is_genuine_ai).toBe(false);
      expect(out.findings.overall_assessment).toBe(scenario.overall_assessment);
      expect(out.scenarioId).toBe(scenario.id);
    }
  });

  it("refuses to attach a tile report to a painting task and falls back to Guided Checklist for arbitrary uploads", async () => {
    const tileBefore = fs.readFileSync(path.join(KIT_DIR, "tile-before.png"));
    const tileAfter = fs.readFileSync(path.join(KIT_DIR, "tile-after-issue.png"));
    const paintingTask = makeTask("Painting", "Repaint north wall", [
      "Is the coverage visually uniform?",
      "Are edges clean?",
    ]);

    const mismatch = await inspectTaskEvidenceWithFallback({
      task: paintingTask,
      beforeImages: [{ record: makeEv("b-tile", "before", tileBefore), bytes: tileBefore }],
      afterImages: [{ record: makeEv("a-tile", "after", tileAfter), bytes: tileAfter }],
    });
    expect(mismatch.outcome).toBe("guided_fallback");
    if (mismatch.outcome === "guided_fallback") {
      expect(mismatch.reasonCode).toBe("demo_category_mismatch");
      expect(mismatch.template.questions.map((q) => q.question)).toContain(
        "Is the coverage visually uniform?"
      );
    }

    const customA = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 220, g: 180, b: 140 } },
    })
      .png()
      .toBuffer();
    const customB = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 120, g: 160, b: 200 } },
    })
      .png()
      .toBuffer();
    const arbitrary = await inspectTaskEvidenceWithFallback({
      task: paintingTask,
      beforeImages: [{ record: makeEv("b-arb", "before", customA), bytes: customA }],
      afterImages: [{ record: makeEv("a-arb", "after", customB), bytes: customB }],
    });
    expect(arbitrary.outcome).toBe("guided_fallback");
    if (arbitrary.outcome === "guided_fallback") {
      expect(arbitrary.reasonCode).toBe("demo_unmatched_images");
    }

    // Q&A in Demo Mode answers strictly from deterministic payment/record rules with zero Gemini call
    const qa = await answerInspectionQuestion({
      task: paintingTask,
      question: "What happens if I reject this repair?",
    });
    expect(qa.source).toBe("deterministic_payment_rule");
    expect(qa.answer).toMatch(/DEMO-AUTH-22222/);
  });
});
