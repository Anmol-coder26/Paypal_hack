import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRepo } from "../lib/db";
import { DEMO_ACCOUNTS, SqliteRepository } from "../lib/db/sqlite";
import {
  authorizeOrderForTask,
  createOrderForTask,
  executeHomeownerDecision,
  reconcileTaskPayment,
} from "../lib/payments/service";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "punchpay-sim-test-"));
const simDbPath = path.join(tmpDir, "sim.db");

describe("Offline Simulation Payment Mode Lifecycle & Isolation", () => {
  let repo: SqliteRepository;
  let prevPaymentMode: string | undefined;
  let prevDbPath: string | undefined;

  beforeAll(async () => {
    prevPaymentMode = process.env.PAYMENT_MODE;
    prevDbPath = process.env.PUNCHPAY_DB_PATH;
    process.env.PAYMENT_MODE = "simulation";
    process.env.PUNCHPAY_DB_PATH = simDbPath;
    repo = new SqliteRepository(simDbPath);
    await repo.ensureSeedProfiles();
  });

  afterAll(() => {
    process.env.PAYMENT_MODE = prevPaymentMode;
    process.env.PUNCHPAY_DB_PATH = prevDbPath;
    try {
      repo.close();
    } catch {
      /* ignore close error */
    }
    try {
      const singleton = getRepo();
      if ("close" in singleton && typeof singleton.close === "function") singleton.close();
    } catch {
      /* ignore singleton close error */
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore temp cleanup */
    }
  });

  it("executes $30 simulated capture and $20 simulated void with timeout recovery, idempotency, and zero PayPal ID contamination", async () => {
    const homeowner = (await repo.getProfileById(DEMO_ACCOUNTS.homeowner.id))!;
    const contractor = (await repo.getProfileById(DEMO_ACCOUNTS.contractor.id))!;

    const project = await repo.createProject({
      homeowner_id: homeowner.id,
      contractor_id: contractor.id,
      title: "Kitchen Renovation Closeout",
      description: "Simulation test",
      location: "Austin, TX",
      due_date: null,
      is_guided_demo: true,
      payment_mode: "simulation",
      tasks: [
        {
          title: "Painting",
          description: "Repaint north wall",
          acceptance_criteria: ["Uniform coat"],
          amount_minor_units: 3000,
        },
        {
          title: "Tile Repair",
          description: "Replace kitchen backsplash tile",
          acceptance_criteria: ["No visible gaps"],
          amount_minor_units: 2000,
        },
      ],
    });
    const [paint, tile] = project.tasks;
    expect(paint.payment.payment_mode).toBe("simulation");

    // 1. Create simulated intents & authorize holds (test timeout + GET reconcile recovery on Paint)
    const intent1 = await createOrderForTask(paint.id, homeowner);
    expect(intent1.mode).toBe("simulation");
    expect(intent1.orderId).toMatch(/^DEMO-ORD-/);

    await expect(
      authorizeOrderForTask(paint.id, homeowner, undefined, { simulateTimeout: true })
    ).rejects.toThrow(/RECONCILIATION_REQUIRED/);

    const recoveredAuth = await reconcileTaskPayment(paint.id, homeowner);
    expect(recoveredAuth.paymentStatus).toBe("AUTHORIZED");

    // Duplicate authorize call returns idempotently
    const repeatAuth = await authorizeOrderForTask(paint.id, homeowner);
    expect(repeatAuth.already).toBe(true);

    // Contractor cannot be reassigned once payment authorization has started
    await expect(
      repo.updateProjectDetails(project.id, { contractor_id: homeowner.id })
    ).rejects.toThrow(/Cannot reassign contractor/);

    const intent2 = await createOrderForTask(tile.id, homeowner);
    expect(intent2.orderId).toMatch(/^DEMO-ORD-/);
    const auth2 = await authorizeOrderForTask(tile.id, homeowner);
    expect(auth2.authorizationId).toMatch(/^DEMO-AUTH-/);

    // 2. Upload before & after images
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 240, g: 240, b: 240 } },
    })
      .png()
      .toBuffer();

    for (const t of [paint, tile]) {
      for (const stage of ["before", "after"] as const) {
        await repo.saveEvidence({
          task_id: t.id,
          uploaded_by: contractor.id,
          evidence_type: stage,
          mime_type: "image/png",
          byte_size: png.length,
          width: 16,
          height: 16,
          notes: "",
          bytes: png,
          ext: "png",
        });
      }
      await repo.updateTaskWorkStatus(t.id, "BEFORE_SUBMITTED");
      await repo.updateTaskWorkStatus(t.id, "EVIDENCE_SUBMITTED");
    }

    // 3. Contractor blocked from settling
    await expect(
      executeHomeownerDecision(paint.id, contractor, { decision: "accept", reason: "No auth" })
    ).rejects.toThrow(/Only the homeowner/);

    // 4. Homeowner accepts $30 Painting (Capture) and rejects $20 Tile (Void)
    const capRes = await executeHomeownerDecision(paint.id, homeowner, {
      decision: "accept",
      reason: "Clean finish",
    });
    expect(capRes.paymentStatus).toBe("CAPTURED");
    expect("captureId" in capRes ? capRes.captureId : "").toMatch(/^DEMO-CAP-/);

    const voidRes = await executeHomeownerDecision(tile.id, homeowner, {
      decision: "reject",
      reason: "Visible grout gap",
    });
    expect(voidRes.paymentStatus).toBe("VOIDED");
    expect("voidId" in voidRes ? voidRes.voidId : "").toMatch(/^DEMO-VOID-/);

    // 5. Invalid transitions blocked & zero PayPal IDs fabricated
    await expect(
      executeHomeownerDecision(paint.id, homeowner, { decision: "reject", reason: "Late reject" })
    ).rejects.toThrow(/cannot execute reject|CAPTURED/i);
    await expect(
      executeHomeownerDecision(tile.id, homeowner, { decision: "accept", reason: "Late accept" })
    ).rejects.toThrow(/cannot execute accept|VOIDED/i);

    const finalProject = (await repo.getProjectBundle(project.id))!;
    expect(finalProject.status).toBe("COMPLETED");
    for (const t of finalProject.tasks) {
      expect(t.payment.payment_mode).toBe("simulation");
      expect(t.payment.paypal_order_id).toBeNull();
      expect(t.payment.paypal_authorization_id).toBeNull();
      expect(t.payment.paypal_capture_id).toBeNull();
    }
    expect(finalProject.tasks[1].payment.sim_void_id).toMatch(/^DEMO-VOID-/);

    // 6. Verify resetGuidedDemo preserves unrelated non-demo projects cleanly
    const unrelated = await repo.createProject({
      homeowner_id: homeowner.id,
      contractor_id: contractor.id,
      title: "Custom Backyard Patio",
      description: "Unrelated real project",
      location: "Austin, TX",
      due_date: null,
      is_guided_demo: false,
      payment_mode: "simulation",
      tasks: [
        {
          title: "Patio Sealant",
          description: "Reseal patio pavers",
          acceptance_criteria: ["Joints sealed"],
          amount_minor_units: 4500,
        },
      ],
    });
    await repo.updateProjectDetails(unrelated.id, { location: "Austin, TX · Patio" });
    const resetDemo = await repo.resetGuidedDemo(homeowner.id, contractor.id, "simulation");
    expect(resetDemo.id).not.toBe(project.id);
    expect(resetDemo.tasks[0].payment_status).toBe("DRAFT");
    const survivingUnrelated = await repo.getProjectBundle(unrelated.id);
    expect(survivingUnrelated?.title).toBe("Custom Backyard Patio");
    expect(survivingUnrelated?.location).toBe("Austin, TX · Patio");
  });
});
