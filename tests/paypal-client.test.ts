import { describe, expect, it } from "vitest";
import {
  PAYPAL_SANDBOX_BASE,
  PayPalSandboxClient,
  assertOrderMatchesTask,
  formatPayPalAmount,
} from "../lib/payments/paypal-client";

const MERCHANT = "CONTRACTOR_MERCHANT_123";

function mockPayPal(
  routes: Array<
    [
      string,
      RegExp,
      unknown | ((path: string, opts: RequestInit) => unknown),
    ]
  >
) {
  const calls: Array<{ method: string; url: string; requestId?: string; body?: unknown }> =
    [];
  const fetchImpl: typeof fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || "GET";
    const headers = opts.headers as Record<string, string> | undefined;
    const isToken = u.endsWith("/v1/oauth2/token");
    calls.push({
      method,
      url: u,
      requestId: headers?.["PayPal-Request-Id"],
      body: opts.body && !isToken ? JSON.parse(String(opts.body)) : undefined,
    });
    if (isToken) {
      return new Response(JSON.stringify({ access_token: "TOK", expires_in: 3600 }), {
        status: 200,
      });
    }
    const path = u.slice(PAYPAL_SANDBOX_BASE.length);
    const match = routes.find(([m, re]) => m === method && re.test(path));
    if (!match) throw new Error(`Unexpected ${method} ${path}`);
    const out = typeof match[2] === "function" ? match[2](path, opts) : match[2];
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return {
    calls,
    client: new PayPalSandboxClient({
      clientId: "CID",
      secret: "SEC",
      merchantId: MERCHANT,
      fetchImpl,
    }),
  };
}

describe("PayPalSandboxClient", () => {
  it("formats minor units accurately and rejects invalid amounts", () => {
    expect(formatPayPalAmount(3000)).toBe("30.00");
    expect(formatPayPalAmount(2000)).toBe("20.00");
    expect(() => formatPayPalAmount(0)).toThrow();
    expect(() => formatPayPalAmount(-500)).toThrow();
  });

  it("creates AUTHORIZE orders pinned to contractor payee and sandbox host", async () => {
    const { calls, client } = mockPayPal([
      [
        "POST",
        /^\/v2\/checkout\/orders$/,
        (_p: string, o: RequestInit) => {
          const b = JSON.parse(String(o.body));
          return {
            id: "ORD-30",
            status: "CREATED",
            purchase_units: b.purchase_units,
            links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkout" }],
          };
        },
      ],
    ]);

    const res = await client.createOrder({
      referenceId: "task-paint",
      description: "Painting",
      minorUnits: 3000,
      requestId: "req-paint-1",
    });

    expect(res.order.id).toBe("ORD-30");
    expect(res.payee).toBe(MERCHANT);
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/v2/"));
    expect(post?.requestId).toBe("req-paint-1");
    expect(calls.every((c) => c.url.startsWith(PAYPAL_SANDBOX_BASE))).toBe(true);
  });

  it("rejects mismatched payee merchant or order amount", () => {
    expect(() =>
      assertOrderMatchesTask(
        {
          id: "ORD",
          status: "CREATED",
          purchase_units: [
            {
              reference_id: "task-1",
              amount: { currency_code: "USD", value: "30.00" },
              payee: { merchant_id: "WRONG" },
            },
          ],
        },
        { referenceId: "task-1", minorUnits: 3000, merchantId: MERCHANT }
      )
    ).toThrow(/mismatch/);
  });

  it("captures $30 authorization and voids $20 authorization with independent GET checks", async () => {
    const { client } = mockPayPal([
      [
        "GET",
        /^\/v2\/payments\/authorizations\/AUTH-PAINT$/,
        {
          id: "AUTH-PAINT",
          status: "CREATED",
          amount: { currency_code: "USD", value: "30.00" },
          payee: { merchant_id: MERCHANT },
        },
      ],
      [
        "POST",
        /^\/v2\/payments\/authorizations\/AUTH-PAINT\/capture$/,
        {
          id: "CAP-30",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "30.00" },
        },
      ],
      [
        "GET",
        /^\/v2\/payments\/captures\/CAP-30$/,
        {
          id: "CAP-30",
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "30.00" },
        },
      ],
      [
        "GET",
        /^\/v2\/payments\/authorizations\/AUTH-TILE$/,
        () => {
          voidCallCount += 1;
          return {
            id: "AUTH-TILE",
            status: voidCallCount > 1 ? "VOIDED" : "CREATED",
            amount: { currency_code: "USD", value: "20.00" },
            payee: { merchant_id: MERCHANT },
          };
        },
      ],
      ["POST", /^\/v2\/payments\/authorizations\/AUTH-TILE\/void$/, {}],
    ]);

    let voidCallCount = 0;

    const cap = await client.captureAuthorization("AUTH-PAINT", {
      minorUnits: 3000,
      requestId: "cap-req-1",
    });
    expect(cap).toEqual({ captureId: "CAP-30", status: "COMPLETED" });

    const voidRes = await client.voidAuthorization("AUTH-TILE", {
      minorUnits: 2000,
      requestId: "void-req-1",
    });
    expect(voidRes).toEqual({ authorizationId: "AUTH-TILE", status: "VOIDED" });
  });

  it("verifies PayPal webhook signatures via official verification endpoint", async () => {
    const { client } = mockPayPal([
      ["POST", /^\/v1\/notifications\/verify-webhook-signature$/, { verification_status: "SUCCESS" }],
    ]);
    const headers = new Headers({
      "paypal-transmission-id": "tx-1",
      "paypal-transmission-time": "2026-11-11T12:00:00Z",
      "paypal-transmission-sig": "sig",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
      "paypal-auth-algo": "SHA256withRSA",
    });
    const valid = await client.verifyWebhookSignature({
      webhookId: "WH-123",
      headers,
      event: { id: "EV-1", event_type: "PAYMENT.CAPTURE.COMPLETED" },
    });
    expect(valid).toBe(true);
  });
});
