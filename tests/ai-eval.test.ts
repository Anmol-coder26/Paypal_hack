import http from "node:http";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatKnowledgeForPrompt, retrieveRepairKnowledge } from "../lib/ai/knowledge";
import {
  answerInspectionQuestion,
  inspectTaskEvidence,
  sanitizeOllamaBaseUrl,
} from "../lib/ai/provider";
import type { EvidenceRecord, TaskBundle } from "../lib/types";

interface LabeledEvalCase {
  id: string;
  taskTitle: string;
  taskDescription: string;
  criteria: string[];
  /** Ground-truth label kept strictly separate from model inputs */
  expectedAssessment: "appears_satisfied" | "concerns_identified" | "insufficient_evidence";
  modelOutput: {
    overall_assessment: "appears_satisfied" | "concerns_identified" | "insufficient_evidence";
    views_comparable: "yes" | "partly" | "no";
    criteria_checks: Array<{
      criterion: string;
      status: "satisfied" | "unmet" | "unverifiable";
      observation: string;
    }>;
  };
}

const EVAL_DATASET: LabeledEvalCase[] = [
  {
    id: "painting-pass",
    taskTitle: "Painting",
    taskDescription: "Repaint scuffed drywall beside north window",
    criteria: ["Coverage looks uniform", "Edges appear clean"],
    expectedAssessment: "appears_satisfied",
    modelOutput: {
      overall_assessment: "appears_satisfied",
      views_comparable: "yes",
      criteria_checks: [
        {
          criterion: "Coverage looks uniform",
          status: "satisfied",
          observation: "After photo shows even satin finish over area scuffed in before photo.",
        },
        {
          criterion: "Edges appear clean",
          status: "satisfied",
          observation: "Trim cut-in along window frame appears clean without paint bleed.",
        },
      ],
    },
  },
  {
    id: "tile-concern",
    taskTitle: "Tile Repair",
    taskDescription: "Replace cracked kitchen backsplash tile and seal grout line",
    criteria: ["Damaged tile replaced", "No obvious visible gaps"],
    expectedAssessment: "concerns_identified",
    modelOutput: {
      overall_assessment: "concerns_identified",
      views_comparable: "yes",
      criteria_checks: [
        {
          criterion: "Damaged tile replaced",
          status: "satisfied",
          observation: "Cracked center tile from before photo is replaced in after photo.",
        },
        {
          criterion: "No obvious visible gaps",
          status: "unmet",
          observation: "After photo shows a dark open void along the right grout joint.",
        },
      ],
    },
  },
  {
    id: "insufficient-blur",
    taskTitle: "Wall Patching",
    taskDescription: "Patch and sand hallway drywall hole",
    criteria: ["Hole closed", "Texture flush"],
    expectedAssessment: "insufficient_evidence",
    modelOutput: {
      overall_assessment: "insufficient_evidence",
      views_comparable: "partly",
      criteria_checks: [
        {
          criterion: "Hole closed",
          status: "unverifiable",
          observation: "After photo is heavily underexposed and blurry around patch area.",
        },
        {
          criterion: "Texture flush",
          status: "unverifiable",
          observation: "Dark blur obscures surface flushness in the after photo.",
        },
      ],
    },
  },
  {
    id: "non-comparable-crop",
    taskTitle: "Flooring Repair",
    taskDescription: "Fix scratched oak plank seam in living room",
    criteria: ["Seam tight"],
    expectedAssessment: "insufficient_evidence",
    modelOutput: {
      // Simulate an over-confident model saying appears_satisfied despite non-comparable views!
      overall_assessment: "appears_satisfied",
      views_comparable: "no",
      criteria_checks: [
        {
          criterion: "Seam tight",
          status: "satisfied",
          observation: "Close-up crop does not establish location relative to before view.",
        },
      ],
    },
  },
];

function makeFakeTask(evalCase: LabeledEvalCase): TaskBundle {
  const now = new Date().toISOString();
  return {
    id: `task-${evalCase.id}`,
    project_id: "proj-eval",
    title: evalCase.taskTitle,
    description: evalCase.taskDescription,
    acceptance_criteria: evalCase.criteria,
    amount_minor_units: 3000,
    currency: "USD",
    work_status: "EVIDENCE_SUBMITTED",
    payment_status: "AUTHORIZED",
    contractor_notes: "",
    homeowner_feedback: "",
    created_at: now,
    updated_at: now,
    payment: {
      id: "pay-eval",
      task_id: `task-${evalCase.id}`,
      payment_mode: "simulation",
      paypal_order_id: null,
      paypal_authorization_id: null,
      paypal_capture_id: null,
      paypal_status: null,
      sim_intent_id: "SIM-INT-EVAL",
      sim_authorization_id: "SIM-AUTH-EVAL",
      sim_capture_id: null,
      sim_status: "CREATED",
      payee_merchant_id: "SIM-MERCHANT",
      amount_minor_units: 3000,
      currency: "USD",
      payment_status: "AUTHORIZED",
      order_attempt: 1,
      request_nonce: "eval01",
      authorization_created_at: now,
      authorization_expires_at: now,
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

function makeFakeRecord(taskId: string, type: "before" | "after"): EvidenceRecord {
  return {
    id: `${taskId}-${type}`,
    task_id: taskId,
    uploaded_by: "contractor-1",
    image_storage_path: `${taskId}/${type}.png`,
    evidence_type: type,
    mime_type: "image/png",
    byte_size: 100,
    width: 32,
    height: 32,
    notes: "",
    created_at: new Date().toISOString(),
  };
}

describe("Curated Knowledge Base, Ollama Provider & Labeled Evaluation Harness", () => {
  let server: http.Server;
  let baseUrl = "";
  let failOnce = false;
  const capturedRequests: Array<{ model: string; imagesCount: number; prompt: string }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "qwen2.5vl:3b" }] }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/chat") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          if (failOnce) {
            failOnce = false;
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "transient model warmup" }));
            return;
          }
          const body = JSON.parse(raw) as {
            model: string;
            messages: Array<{ role: string; content: string; images?: string[] }>;
          };
          const userMsg = body.messages.find((m) => m.role === "user")!;
          capturedRequests.push({
            model: body.model,
            imagesCount: userMsg.images?.length ?? 0,
            prompt: userMsg.content,
          });

          if (userMsg.content.includes("Question:")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                model: body.model,
                message: {
                  content: JSON.stringify({
                    answer: "The after photo shows a dark open joint along the right tile edge.",
                  }),
                },
              })
            );
            return;
          }

          const matched = EVAL_DATASET.find((c) => userMsg.content.includes(`Repair Task: ${c.taskTitle}`))!;
          const m = matched.modelOutput;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              model: body.model,
              message: {
                content: JSON.stringify({
                  overall_assessment: m.overall_assessment,
                  summary: `Inspected ${matched.taskTitle} before and after images against agreed criteria.`,
                  views_comparable: m.views_comparable,
                  visible_observations: m.criteria_checks.map((c) => c.observation),
                  criteria_checks: m.criteria_checks,
                  criteria_satisfied: [],
                  criteria_unmet: [],
                  criteria_unverifiable: [],
                  missing_evidence: [],
                  recommended_next_steps: ["Review findings directly before deciding."],
                  suggested_outcome:
                    m.overall_assessment === "appears_satisfied"
                      ? "accept"
                      : m.overall_assessment === "concerns_identified"
                      ? "review_concerns"
                      : "request_more_evidence",
                  limitations_and_uncertainty: ["2D surface photographs do not establish subsurface bond."],
                }),
              },
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("retrieves relevant repair guidelines selectively without leaking assumed outcomes", () => {
    const paint = retrieveRepairKnowledge("Painting", "Repaint interior north wall");
    expect(paint.map((p) => p.id)).toEqual(["interior_painting"]);
    const prompt = formatKnowledgeForPrompt(paint);
    expect(prompt).toContain("Interior Painting");
    expect(prompt).toContain("NOT an assumed result");
    expect(prompt).not.toContain("Tile Repair");
  });

  it("rejects non-localhost OLLAMA_BASE_URL to prevent SSRF", () => {
    expect(() => sanitizeOllamaBaseUrl("https://evil.example.com")).toThrow(/restricted to localhost/);
    expect(sanitizeOllamaBaseUrl("http://127.0.0.1:11434/")).toBe("http://127.0.0.1:11434");
  });

  it("evaluates all 4 labeled photo pairs through Ollama /api/chat, sends real image bytes, retries transient 5xx, and enforces abstention", async () => {
    const paintBefore = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 160, g: 160, b: 165 } },
    })
      .png()
      .toBuffer();
    const paintAfter = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 245, g: 245, b: 240 } },
    })
      .png()
      .toBuffer();

    failOnce = true; // Verify read-only retry on first 503 response

    for (const c of EVAL_DATASET) {
      const task = makeFakeTask(c);
      const res = await inspectTaskEvidence({
        task,
        beforeImages: [{ record: makeFakeRecord(task.id, "before"), bytes: paintBefore }],
        afterImages: [{ record: makeFakeRecord(task.id, "after"), bytes: paintAfter }],
        aiOverride: { provider: "ollama", baseUrl, model: "qwen2.5vl:3b" },
      });
      expect(res.provider).toBe("ollama");
      expect(res.model).toBe("qwen2.5vl:3b");
      expect(res.findings.overall_assessment).toBe(c.expectedAssessment);
    }

    // Confirm ground-truth label field names were never embedded in outbound prompts & 2 images sent each call
    expect(capturedRequests.length).toBe(EVAL_DATASET.length);
    for (const req of capturedRequests) {
      expect(req.imagesCount).toBe(2);
      expect(req.prompt).not.toContain("expectedAssessment");
    }
  });

  it("answers payment workflow questions deterministically and blocks off-topic questions", async () => {
    const task = makeFakeTask(EVAL_DATASET[1]);
    const payReply = await answerInspectionQuestion({
      task,
      question: "What happens if I reject this repair?",
    });
    expect(payReply.source).toBe("deterministic_payment_rule");
    expect(payReply.answer).toContain("SIM-AUTH-EVAL");
    expect(payReply.answer).toContain("Simulation mode");

    const offTopic = await answerInspectionQuestion({
      task,
      question: "What is the weather in Tokyo tomorrow?",
    });
    expect(offTopic.source).toBe("deterministic_payment_rule");
    expect(offTopic.answer).toContain("only answer questions about this repair task");
  });
});
