import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const BASE = "https://api-m.sandbox.paypal.com";
const TIMEOUT = 15_000;

async function paypalFetch(clientId, secret, path, opts = {}) {
  const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const tokenRes = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(`PayPal OAuth failed: ${tokenRes.status}`);
  }
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.requestId ? { "PayPal-Request-Id": opts.requestId } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`PayPal ${res.status}: ${json?.details?.[0]?.issue || json?.name || text}`);
  }
  return json;
}

const ITEMS = {
  paint: { value: "30.00", description: "Painting · Living room north wall" },
  tile: { value: "20.00", description: "Tile Repair · Kitchen backsplash" },
};

async function main() {
  const cmd = process.argv[2];
  if (!["create", "settle", "verify"].includes(cmd)) {
    console.error("Usage: node scripts/paypal-smoke.mjs <create|settle|verify>");
    process.exit(1);
  }
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const merchantId = process.env.PAYPAL_MERCHANT_ID;
  if (!clientId || !secret || !merchantId) {
    console.error("SANDBOX GATE BLOCKED: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_MERCHANT_ID required in .env.local");
    process.exit(1);
  }

  const statePath = new URL("../.paypal-sandbox-state.json", import.meta.url);
  const load = async () => {
    try { return JSON.parse(await readFile(statePath, "utf8")); } catch { return {}; }
  };
  const save = async (data) => writeFile(statePath, JSON.stringify(data, null, 2));
  const s = await load();

  if (cmd === "create") {
    if (process.argv.includes("--fresh") || !s.run) {
      for (const k of Object.keys(s)) delete s[k];
      s.run = randomUUID().slice(0, 8);
    }
    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/payments`;
    for (const [slug, item] of Object.entries(ITEMS)) {
      if (!s[slug]?.orderId) {
        const order = await paypalFetch(clientId, secret, "/v2/checkout/orders", {
          method: "POST",
          requestId: `punchpay-smoke-${s.run}-${slug}-order`,
          body: {
            intent: "AUTHORIZE",
            purchase_units: [{
              reference_id: `smoke-${s.run}-${slug}`,
              description: item.description,
              amount: { currency_code: "USD", value: item.value },
              payee: { merchant_id: merchantId },
            }],
            payment_source: {
              paypal: {
                experience_context: {
                  user_action: "CONTINUE",
                  shipping_preference: "NO_SHIPPING",
                  return_url: returnUrl,
                  cancel_url: returnUrl,
                },
              },
            },
          },
        });
        const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
        s[slug] = { orderId: order.id, approveUrl, payee: order.purchase_units?.[0]?.payee?.merchant_id };
        await save(s);
      }
      console.log(`${slug.toUpperCase()} $${item.value} -> Order ${s[slug].orderId}\n  APPROVE: ${s[slug].approveUrl}`);
    }
    return;
  }

  if (cmd === "settle") {
    for (const slug of Object.keys(ITEMS)) {
      if (!s[slug]?.orderId) throw new Error("Run sandbox:create first");
      const order = await paypalFetch(clientId, secret, `/v2/checkout/orders/${s[slug].orderId}`);
      if (!s[slug].authId) {
        if (order.status !== "APPROVED" && order.status !== "COMPLETED") {
          throw new Error(`${slug} order is ${order.status}; approve in browser first.`);
        }
        let auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
        if (!auth) {
          const authOrder = await paypalFetch(clientId, secret, `/v2/checkout/orders/${s[slug].orderId}/authorize`, {
            method: "POST",
            requestId: `punchpay-smoke-${s.run}-${slug}-auth`,
            body: {},
          });
          auth = authOrder.purchase_units?.[0]?.payments?.authorizations?.[0];
        }
        s[slug].authId = auth.id;
        await save(s);
      }
    }
    if (!s.paint.captureId) {
      const cap = await paypalFetch(clientId, secret, `/v2/payments/authorizations/${s.paint.authId}/capture`, {
        method: "POST",
        requestId: `punchpay-smoke-cap-${s.paint.authId}`,
        body: { amount: { currency_code: "USD", value: ITEMS.paint.value }, final_capture: true },
      });
      s.paint.captureId = cap.id;
      await save(s);
    }
    if (!s.tile.voided) {
      await paypalFetch(clientId, secret, `/v2/payments/authorizations/${s.tile.authId}/void`, {
        method: "POST",
        requestId: `punchpay-smoke-void-${s.tile.authId}`,
        body: {},
      });
      s.tile.voided = true;
      await save(s);
    }
  }

  const cap = await paypalFetch(clientId, secret, `/v2/payments/captures/${s.paint.captureId}`);
  const paintAuth = await paypalFetch(clientId, secret, `/v2/payments/authorizations/${s.paint.authId}`);
  const tileAuth = await paypalFetch(clientId, secret, `/v2/payments/authorizations/${s.tile.authId}`);
  console.log(JSON.stringify({ paintCapture: cap.status, paintAuth: paintAuth.status, tileAuth: tileAuth.status }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
