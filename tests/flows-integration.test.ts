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
} from "../lib/payments/service";

import { getRepo } from "../lib/db";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "punchpay-v2-test-"));
const testDbPath = path.join(tmpDir, "test.db");
process.env.PUNCHPAY_DB_PATH = testDbPath;

function makeSandboxHarness() {
  const orders = new Map<string, Record<string, unknown>>();
  const auths = new Map<string, Record<string, unknown>>();
  const captures = new Map<string, Record<string, unknown>>();
  const merchantId = "SANDBOX-MERCHANT";
  let seq = 0;

  const fetchImpl: typeof fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || "GET";
    if (u.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "SIM", expires_in: 3600 }), {
        status: 200,
      });
    }
    const p = u.slice(PAYPAL_SANDBOX_BASE.length);
    const body = opts.body ? JSON.parse(String(opts.body)) : {};

    if (method === "POST" && p === "/v2/checkout/orders") {
      seq += 1;
      const id = `ORD-${seq}`;
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
      seq += 1;
      const auth = {
        id: `AUTH-${seq}`,
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
      seq += 1;
      const cap = {
        id: `CAP-${seq}`,
        status: "COMPLETED",
        amount: a.amount,
        supplementary_data: {
          related_ids: { authorization_id: a.id, order_id: a.supplementary_data.related_ids.order_id },
        },
      };
      a.status = "CAPTURED";
      captures.set(cap.id, cap);
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
    try { repo.close(); } catch {}
    try {
      const singleton = getRepo();
      if ("close" in singleton && typeof singleton.close === "function") singleton.close();
    } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
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

    // Pin annotations persist on task bundle
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
    const hydrated = await repo.getTaskBundle(tile.id);
    expect(hydrated!.annotations.some((a) => a.id === pin.id)).toBe(true);
    await repo.deleteAnnotation(pin.id, tile.id);
    const afterDel = await repo.getTaskBundle(tile.id);
    expect(afterDel!.annotations.length).toBe(0);
  });
});
