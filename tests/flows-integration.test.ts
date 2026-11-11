import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeImage } from "../lib/image";
import { DEMO_ACCOUNTS, SqliteRepository } from "../lib/db/sqlite";
import { PayPalSandboxClient, PAYPAL_SANDBOX_BASE } from "../lib/payments/paypal-client";
import {
  authorizeOrderForTask,
  createOrderForTask,
  executeHomeownerDecision,
  processPayPalWebhook,
  reconcileTaskPayment,
} from "../lib/payments/service";

import { getRepo } from "../lib/db";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "punchpay-v2-test-"));
const testDbPath = path.join(tmpDir, "test.db");
process.env.PUNCHPAY_DB_PATH = testDbPath;

let harnessSeq = 0;

function makeSandboxHarness() {
  const orders = new Map<string, Record<string, unknown>>();
  const auths = new Map<string, Record<string, unknown>>();
  const captures = new Map<string, Record<string, unknown>>();
  const merchantId = "SANDBOX-MERCHANT";
  const nextId = (prefix: string) => `${prefix}-${++harnessSeq}`;
  let dropNextCaptureResponse = false;

  const fetchImpl: typeof fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || "GET";
    if (u.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "SIM", expires_in: 3600 }), {
        status: 200,
      });
    }
    if (u.endsWith("/v1/notifications/verify-webhook-signature")) {
      return new Response(JSON.stringify({ verification_status: "SUCCESS" }), {
        status: 200,
      });
    }
    const p = u.slice(PAYPAL_SANDBOX_BASE.length);
    const body = opts.body ? JSON.parse(String(opts.body)) : {};

    if (method === "POST" && p === "/v2/checkout/orders") {
      const id = nextId("ORD");
      const order = {
        id,
        status: "CREATED",
        purchase_units: body.purchase_units,
        links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkout?token=${id}` }],
      };
      orders.set(id, order);
      return new Response(JSON.stringify(order), { status: 201 });
    }
    let m = p.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (method === "GET" && m) {
      const order = orders.get(m[1]);
      return new Response(JSON.stringify(order || {}), { status: order ? 200 : 404 });
    }
    m = p.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/);
    if (method === "POST" && m) {
      const order = orders.get(m[1]) as {
        id: string;
        status: string;
        purchase_units: Array<{ amount: unknown; payee: unknown; reference_id: string }>;
      };
      const auth = {
        id: nextId("AUTH"),
        status: "CREATED",
        amount: order.purchase_units[0].amount,
        payee: order.purchase_units[0].payee,
        expiration_time: new Date(Date.now() + 29 * 86400_000).toISOString(),
        supplementary_data: { related_ids: { order_id: order.id } },
      };
      auths.set(auth.id, auth);
      order.status = "COMPLETED";
      (order.purchase_units[0] as Record<string, unknown>).payments = {
        authorizations: [auth],
      };
      return new Response(JSON.stringify(order), { status: 201 });
    }
    m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)$/);
    if (method === "GET" && m) {
      const a = auths.get(m[1]);
      return new Response(JSON.stringify(a || {}), { status: a ? 200 : 404 });
    }
    m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/);
    if (method === "POST" && m) {
      const a = auths.get(m[1]) as {
        id: string;
        status: string;
        amount: unknown;
        supplementary_data: { related_ids: { order_id: string } };
      };
      const order = orders.get(a.supplementary_data.related_ids.order_id) as {
        purchase_units: Array<{ payments: Record<string, unknown> }>;
      };
      const cap = {
        id: nextId("CAP"),
        status: "COMPLETED",
        amount: a.amount,
        supplementary_data: {
          related_ids: { authorization_id: a.id, order_id: a.supplementary_data.related_ids.order_id },
        },
      };
      a.status = "CAPTURED";
      captures.set(cap.id, cap);
      order.purchase_units[0].payments.captures = [cap];
      if (dropNextCaptureResponse) {
        dropNextCaptureResponse = false;
        const err = new Error("Simulated timeout");
        err.name = "TimeoutError";
        throw err;
      }
      return new Response(JSON.stringify(cap), { status: 201 });
    }
    m = p.match(/^\/v2\/payments\/captures\/([^/]+)$/);
    if (method === "GET" && m) {
      const c = captures.get(m[1]);
      return new Response(JSON.stringify(c || {}), { status: c ? 200 : 404 });
    }
    m = p.match(/^\/v2\/payments\/authorizations\/([^/]+)\/void$/);
    if (method === "POST" && m) {
      const a = auths.get(m[1]) as { status: string };
      a.status = "VOIDED";
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unhandled ${method} ${p}`);
  };

  return {
    approveOrder(orderId: string) {
      const o = orders.get(orderId);
      if (o) o.status = "APPROVED";
    },
    dropNextCapture() {
      dropNextCaptureResponse = true;
    },
    client: new PayPalSandboxClient({
      clientId: "CID",
      secret: "SEC",
      merchantId,
      fetchImpl,
    }),
  };
}

describe("PunchPay 2.0 End-to-End Integration Flows", () => {
  let repo: SqliteRepository;

  beforeAll(async () => {
    repo = new SqliteRepository(testDbPath);
    await repo.ensureSeedProfiles();
  });

  afterAll(() => {
    try {
      repo.close();
    } catch {
      /* ignore test db close error */
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
      /* ignore temp dir cleanup error */
    }
  });

  it("sanitizes real images and rejects non-image payloads", async () => {
    const pngBytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 240, g: 240, b: 235 } },
    })
      .png()
      .toBuffer();

    const sanitized = await sanitizeImage(new Uint8Array(pngBytes), "image/png");
    expect(sanitized.type).toBe("image/png");
    expect(sanitized.width).toBe(64);

    await expect(
      sanitizeImage(new Uint8Array(Buffer.from("not-an-image")), "image/png")
    ).rejects.toThrow();
  });

  it("completes $30 capture and $20 void independently, blocks contractor settlement & double capture", async () => {
    const homeowner = (await repo.getProfileById(DEMO_ACCOUNTS.homeowner.id))!;
    const contractor = (await repo.getProfileById(DEMO_ACCOUNTS.contractor.id))!;

    const project = await repo.createProject({
      homeowner_id: homeowner.id,
      contractor_id: contractor.id,
      title: "Test Closeout",
      description: "Two repairs",
      location: "Austin, TX",
      due_date: null,
      tasks: [
        {
          title: "Painting",
          description: "Repaint living room wall",
          acceptance_criteria: ["Coverage uniform", "Edges clean"],
          amount_minor_units: 3000,
        },
        {
          title: "Tile Repair",
          description: "Replace kitchen tile",
          acceptance_criteria: ["Tile aligned", "Grout continuous"],
          amount_minor_units: 2000,
        },
      ],
    });

    const [paint, tile] = project.tasks;
    const pp = makeSandboxHarness();

    // Contractor cannot create order
    await expect(createOrderForTask(paint.id, contractor, pp.client)).rejects.toThrow(
      /Only the homeowner/
    );

    // Homeowner creates & authorizes both orders
    const pOrder = await createOrderForTask(paint.id, homeowner, pp.client);
    pp.approveOrder(pOrder.orderId);
    await authorizeOrderForTask(paint.id, homeowner, pp.client);

    const tOrder = await createOrderForTask(tile.id, homeowner, pp.client);
    pp.approveOrder(tOrder.orderId);
    await authorizeOrderForTask(tile.id, homeowner, pp.client);

    // Evidence submitted on both
    const dummyPng = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 220, g: 220, b: 220 } },
    })
      .png()
      .toBuffer();

    for (const task of [paint, tile]) {
      await repo.saveEvidence({
        task_id: task.id,
        uploaded_by: contractor.id,
        evidence_type: "before",
        mime_type: "image/png",
        byte_size: dummyPng.length,
        width: 32,
        height: 32,
        notes: "",
        bytes: dummyPng,
        ext: "png",
      });
      await repo.saveEvidence({
        task_id: task.id,
        uploaded_by: contractor.id,
        evidence_type: "after",
        mime_type: "image/png",
        byte_size: dummyPng.length,
        width: 32,
        height: 32,
        notes: "",
        bytes: dummyPng,
        ext: "png",
      });
      await repo.updateTaskWorkStatus(task.id, "BEFORE_SUBMITTED");
      await repo.updateTaskWorkStatus(task.id, "EVIDENCE_SUBMITTED");
    }

    // Contractor cannot settle payment
    await expect(
      executeHomeownerDecision(
        paint.id,
        contractor,
        { decision: "accept", reason: "" },
        pp.client
      )
    ).rejects.toThrow(/Only the homeowner/);

    // Homeowner accepts $30 painting -> CAPTURED
    const capRes = await executeHomeownerDecision(
      paint.id,
      homeowner,
      { decision: "accept", reason: "Looks great" },
      pp.client
    );
    expect(capRes.paymentStatus).toBe("CAPTURED");

    // Duplicate accept is idempotent (already: true)
    const dupRes = await executeHomeownerDecision(
      paint.id,
      homeowner,
      { decision: "accept", reason: "Double click" },
      pp.client
    );
    expect(dupRes.already).toBe(true);

    // Cannot void an already captured item
    await expect(
      executeHomeownerDecision(
        paint.id,
        homeowner,
        { decision: "reject", reason: "Too late" },
        pp.client
      )
    ).rejects.toThrow(/CAPTURED/);

    // Homeowner rejects $20 tile -> VOIDED
    const voidRes = await executeHomeownerDecision(
      tile.id,
      homeowner,
      { decision: "reject", reason: "Misaligned" },
      pp.client
    );
    expect(voidRes.paymentStatus).toBe("VOIDED");

    const ledger = await repo.listLedgerForUser(homeowner);
    const totalCaptured = ledger
      .filter((e) => e.payment.payment_status === "CAPTURED")
      .reduce((s, e) => s + e.payment.amount_minor_units, 0);
    const totalVoided = ledger
      .filter((e) => e.payment.payment_status === "VOIDED")
      .reduce((s, e) => s + e.payment.amount_minor_units, 0);
    expect(totalCaptured).toBe(3000);
    expect(totalVoided).toBe(2000);

    // Pin annotations persist on task bundle and lookup by task works
    const tileAfter = await repo.getTaskBundle(tile.id);
    const evId = tileAfter!.evidence[0].id;
    const pin = await repo.addAnnotation({
      task_id: tile.id,
      evidence_id: evId,
      author_id: homeowner.id,
      author_name: homeowner.name,
      author_role: "homeowner",
      x_pct: 42.5,
      y_pct: 61.0,
      label: "Wide dark gap along right joint",
      severity: "concern",
    });
    expect((await repo.getAnnotationById(pin.id, tile.id))?.id).toBe(pin.id);
    const hydrated = await repo.getTaskBundle(tile.id);
    expect(hydrated!.annotations.some((a) => a.id === pin.id)).toBe(true);
    await repo.deleteAnnotation(pin.id, tile.id);
    expect(await repo.getAnnotationById(pin.id, tile.id)).toBeNull();
  });

  it("recovers dropped capture via GET reconcile, finalizes idempotency lock, rejects concurrent IN_PROGRESS authorize, and handles webhooks", async () => {
    const homeowner = (await repo.getProfileById(DEMO_ACCOUNTS.homeowner.id))!;
    const contractor = (await repo.getProfileById(DEMO_ACCOUNTS.contractor.id))!;
    const pp = makeSandboxHarness();

    const project = await repo.createProject({
      homeowner_id: homeowner.id,
      contractor_id: contractor.id,
      title: "Fault Recovery Test",
      description: "Verify reconcile + webhooks",
      location: "Austin, TX",
      due_date: null,
      tasks: [
        {
          title: "Paint Timeout Task",
          description: "Wall coat",
          acceptance_criteria: ["Clean edge"],
          amount_minor_units: 3000,
        },
        {
          title: "Webhook Expiry Task",
          description: "Cabinet trim",
          acceptance_criteria: ["Flush hinge"],
          amount_minor_units: 2000,
        },
      ],
    });
    const [timeoutTask, webhookTask] = project.tasks;

    const order1 = await createOrderForTask(timeoutTask.id, homeowner, pp.client);
    // Simulate concurrent IN_PROGRESS authorization lock
    await repo.beginIdempotency({
      operation_key: `authorize:${order1.orderId}`,
      payment_record_id: timeoutTask.payment.id,
      operation_type: "authorize",
    });
    await expect(authorizeOrderForTask(timeoutTask.id, homeowner, pp.client)).rejects.toThrow(
      /already in flight/
    );
    await repo.finishIdempotency(`authorize:${order1.orderId}`, "FAILED");

    pp.approveOrder(order1.orderId);
    const auth1 = await authorizeOrderForTask(timeoutTask.id, homeowner, pp.client);

    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .png()
      .toBuffer();
    await repo.saveEvidence({
      task_id: timeoutTask.id,
      uploaded_by: contractor.id,
      evidence_type: "before",
      mime_type: "image/png",
      byte_size: png.length,
      width: 16,
      height: 16,
      notes: "",
      bytes: png,
      ext: "png",
    });
    await repo.saveEvidence({
      task_id: timeoutTask.id,
      uploaded_by: contractor.id,
      evidence_type: "after",
      mime_type: "image/png",
      byte_size: png.length,
      width: 16,
      height: 16,
      notes: "",
      bytes: png,
      ext: "png",
    });
    await repo.updateTaskWorkStatus(timeoutTask.id, "BEFORE_SUBMITTED");
    await repo.updateTaskWorkStatus(timeoutTask.id, "EVIDENCE_SUBMITTED");

    // Simulate response lost after PayPal processed capture
    pp.dropNextCapture();
    await expect(
      executeHomeownerDecision(
        timeoutTask.id,
        homeowner,
        { decision: "accept", reason: "Clean" },
        pp.client
      )
    ).rejects.toThrow(/Reconcile Status/);

    const parked = (await repo.getTaskBundle(timeoutTask.id))!;
    expect(parked.payment_status).toBe("RECONCILIATION_REQUIRED");

    // Read-only GET reconcile recovers capture & finalizes IN_PROGRESS idempotency lock
    const rec = await reconcileTaskPayment(timeoutTask.id, homeowner, pp.client);
    expect(rec.paymentStatus).toBe("CAPTURED");

    // Re-trying accept hits SUCCEEDED idempotency record cleanly (already: true)
    const repeatAfterReconcile = await executeHomeownerDecision(
      timeoutTask.id,
      homeowner,
      { decision: "accept", reason: "Retry check" },
      pp.client
    );
    expect(repeatAfterReconcile.already).toBe(true);
    expect(auth1.authorizationId).toBeTruthy();

    // Test malformed webhook body -> 400 and authorization expiry webhook -> AUTHORIZATION_EXPIRED
    const whHeaders = new Headers({
      "paypal-transmission-id": "tx-wh-1",
      "paypal-transmission-time": "2026-11-11T12:00:00Z",
      "paypal-transmission-sig": "sig",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
      "paypal-auth-algo": "SHA256withRSA",
    });
    await expect(
      processPayPalWebhook(whHeaders, "{not-json", pp.client)
    ).rejects.toThrow(/Invalid JSON/);

    const order2 = await createOrderForTask(webhookTask.id, homeowner, pp.client);
    pp.approveOrder(order2.orderId);
    const auth2 = await authorizeOrderForTask(webhookTask.id, homeowner, pp.client);

    const whRes = await processPayPalWebhook(
      whHeaders,
      JSON.stringify({
        id: "EV-EXPIRE-1",
        event_type: "PAYMENT.AUTHORIZATION.EXPIRED",
        resource: { id: auth2.authorizationId, status: "EXPIRED" },
      }),
      pp.client
    );
    expect(whRes).toEqual({ received: true, matched: true, duplicate: false });
    const expiredTask = (await repo.getTaskBundle(webhookTask.id))!;
    expect(expiredTask.payment_status).toBe("AUTHORIZATION_EXPIRED");

    // Duplicate webhook is ignored cleanly
    const whDup = await processPayPalWebhook(
      whHeaders,
      JSON.stringify({
        id: "EV-EXPIRE-1",
        event_type: "PAYMENT.AUTHORIZATION.EXPIRED",
        resource: { id: auth2.authorizationId, status: "EXPIRED" },
      }),
      pp.client
    );
    expect(whDup).toEqual({ received: true, matched: true, duplicate: true });
  });
});
