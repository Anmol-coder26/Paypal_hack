export const PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
export const PAYPAL_TIMEOUT_MS = 15_000;

export interface PayPalMoney {
  currency_code: string;
  value: string;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalAuthorization {
  id: string;
  status: string;
  amount?: PayPalMoney;
  create_time?: string;
  expiration_time?: string;
  payee?: { merchant_id?: string; email_address?: string };
  supplementary_data?: { related_ids?: { order_id?: string } };
  payeeVerifiedVia?: "authorization" | "parent_order";
}

export interface PayPalCapture {
  id: string;
  status: string;
  amount?: PayPalMoney;
  create_time?: string;
  supplementary_data?: { related_ids?: { authorization_id?: string; order_id?: string } };
}

export interface PayPalOrder {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    reference_id?: string;
    description?: string;
    amount?: PayPalMoney;
    payee?: { merchant_id?: string; email_address?: string };
    payments?: {
      authorizations?: PayPalAuthorization[];
      captures?: PayPalCapture[];
    };
  }>;
}

export class PayPalVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationError";
  }
}

export class PayPalApiError extends Error {
  status?: number;
  issue?: string;
  debugId?: string;
  afterSend?: boolean;
  constructor(
    message: string,
    opts: { status?: number; issue?: string; debugId?: string } = {}
  ) {
    super(message);
    this.name = "PayPalError";
    this.status = opts.status;
    this.issue = opts.issue;
    this.debugId = opts.debugId;
  }
}

export function formatPayPalAmount(minorUnits: number): string {
  if (!Number.isInteger(minorUnits) || minorUnits <= 0 || minorUnits > 1_000_000) {
    throw new PayPalVerificationError("Invalid USD minor-unit amount (must be $0.01 - $10,000.00)");
  }
  return (minorUnits / 100).toFixed(2);
}

export function assertPayPalPayee(
  resource: unknown,
  expectedMerchantId: string | undefined
): string {
  if (!expectedMerchantId) {
    throw new PayPalVerificationError("PAYPAL_MERCHANT_ID is mandatory for payee verification");
  }
  const r = resource as {
    purchase_units?: Array<{ payee?: { merchant_id?: string } }>;
    payee?: { merchant_id?: string };
  };
  const reportedId = r?.purchase_units?.[0]?.payee?.merchant_id ?? r?.payee?.merchant_id;
  if (!reportedId || reportedId !== expectedMerchantId) {
    throw new PayPalVerificationError(
      `Payee merchant mismatch: expected ${expectedMerchantId}, returned ${reportedId || "not reported"}`
    );
  }
  return reportedId;
}

export function assertPayPalAmount(
  money: PayPalMoney | undefined,
  minorUnits: number,
  label = "amount"
): void {
  const expected = formatPayPalAmount(minorUnits);
  if (!money || money.currency_code !== "USD" || money.value !== expected) {
    throw new PayPalVerificationError(
      `PayPal ${label} mismatch: expected USD ${expected}, returned ${
        money ? `${money.currency_code} ${money.value}` : "none"
      }`
    );
  }
}

export function assertOrderMatchesTask(
  order: PayPalOrder,
  expect: { referenceId?: string; minorUnits: number; merchantId: string }
): string {
  const unit = order?.purchase_units?.[0];
  if (!unit) throw new PayPalVerificationError("PayPal order has no purchase unit");
  if (order.purchase_units?.length !== 1) {
    throw new PayPalVerificationError("PayPal order must have exactly one purchase unit");
  }
  if (expect.referenceId && unit.reference_id !== expect.referenceId) {
    throw new PayPalVerificationError(
      `Order belongs to ${unit.reference_id || "unknown"}, not ${expect.referenceId}`
    );
  }
  assertPayPalAmount(unit.amount, expect.minorUnits, "order amount");
  return assertPayPalPayee(order, expect.merchantId);
}

export function extractApprovalUrl(order: PayPalOrder): string | null {
  return (
    order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href ??
    null
  );
}

async function runAfterSend<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err && typeof err === "object") {
      (err as { afterSend?: boolean }).afterSend = true;
    }
    throw err;
  }
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(ms)
    : undefined;
}

export class PayPalSandboxClient {
  readonly clientId: string;
  readonly secret: string;
  readonly merchantId: string;
  readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(opts: {
    clientId?: string;
    secret?: string;
    merchantId?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (!opts.clientId || !opts.secret || !opts.merchantId) {
      throw new Error(
        "PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_MERCHANT_ID are required"
      );
    }
    this.clientId = opts.clientId;
    this.secret = opts.secret;
    this.merchantId = opts.merchantId;
    this.timeoutMs = opts.timeoutMs ?? PAYPAL_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  async token(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }
    const basic = Buffer.from(`${this.clientId}:${this.secret}`).toString("base64");
    const response = await this.fetchImpl(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
      signal: timeoutSignal(this.timeoutMs),
    });
    const json = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!response.ok || !json.access_token) {
      throw new PayPalApiError(
        `PayPal OAuth error ${response.status}: ${json.error || "no access token"}`,
        { status: response.status }
      );
    }
    this.cachedToken = json.access_token;
    this.tokenExpiresAt =
      Date.now() + Math.max(0, (Number(json.expires_in) || 0) - 120) * 1000;
    return this.cachedToken;
  }

  async request<T = unknown>(
    path: string,
    opts: { method?: "GET" | "POST"; body?: object; requestId?: string } = {}
  ): Promise<T> {
    const method = opts.method ?? "GET";
    if (!path.startsWith("/v2/")) {
      throw new Error("Only PayPal v2 sandbox API paths are permitted");
    }
    if (method === "POST" && !opts.requestId) {
      throw new Error("POST requires a stable PayPal-Request-Id for idempotency");
    }
    const bearer = await this.token();
    const res = await this.fetchImpl(`${PAYPAL_SANDBOX_BASE}${path}`, {
      method,
      cache: "no-store",
      signal: timeoutSignal(this.timeoutMs),
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(opts.requestId ? { "PayPal-Request-Id": opts.requestId } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const details = json?.details as Array<{ issue?: string }> | undefined;
      const issue = details?.[0]?.issue || (json?.name as string) || "unexpected response";
      const debugId = json?.debug_id as string | undefined;
      throw new PayPalApiError(
        `PayPal ${res.status}: ${issue}${debugId ? ` (debug ${debugId})` : ""}`,
        { status: res.status, issue, debugId }
      );
    }
    return json as T;
  }

  getOrder(orderId: string): Promise<PayPalOrder> {
    return this.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  getAuthorization(authId: string): Promise<PayPalAuthorization> {
    return this.request<PayPalAuthorization>(
      `/v2/payments/authorizations/${encodeURIComponent(authId)}`
    );
  }

  getCapture(captureId: string): Promise<PayPalCapture> {
    return this.request<PayPalCapture>(
      `/v2/payments/captures/${encodeURIComponent(captureId)}`
    );
  }

  async createOrder(opts: {
    referenceId: string;
    description: string;
    minorUnits: number;
    requestId: string;
    returnUrl?: string;
    cancelUrl?: string;
  }): Promise<{ order: PayPalOrder; payee: string }> {
    const unit = {
      reference_id: opts.referenceId,
      description: opts.description.slice(0, 127),
      amount: { currency_code: "USD", value: formatPayPalAmount(opts.minorUnits) },
      payee: { merchant_id: this.merchantId },
    };
    const body: Record<string, unknown> = { intent: "AUTHORIZE", purchase_units: [unit] };
    if (opts.returnUrl) {
      body.payment_source = {
        paypal: {
          experience_context: {
            user_action: "CONTINUE",
            shipping_preference: "NO_SHIPPING",
            return_url: opts.returnUrl,
            cancel_url: opts.cancelUrl || opts.returnUrl,
          },
        },
      };
    }
    const order = await this.request<PayPalOrder>("/v2/checkout/orders", {
      method: "POST",
      requestId: opts.requestId,
      body,
    });
    if (!order?.id) {
      throw new PayPalVerificationError("PayPal returned no order ID");
    }
    const verified = order.purchase_units?.[0]?.payee?.merchant_id
      ? order
      : { ...order, ...(await this.getOrder(order.id)), links: order.links };
    const payee = assertOrderMatchesTask(verified, {
      referenceId: opts.referenceId,
      minorUnits: opts.minorUnits,
      merchantId: this.merchantId,
    });
    return { order: verified, payee };
  }

  async authorizeApproved(
    orderId: string,
    opts: { referenceId: string; minorUnits: number; requestId: string }
  ): Promise<{ authorization: PayPalAuthorization; recovered: boolean; payee: string }> {
    const order = await this.getOrder(orderId);
    assertOrderMatchesTask(order, {
      referenceId: opts.referenceId,
      minorUnits: opts.minorUnits,
      merchantId: this.merchantId,
    });
    let auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) {
      if (order.status !== "APPROVED") {
        throw new PayPalVerificationError(
          `Order not approved by buyer yet (PayPal status: ${order.status})`
        );
      }
      const authorized = await this.request<PayPalOrder>(
        `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
        { method: "POST", body: {}, requestId: opts.requestId }
      );
      assertOrderMatchesTask(authorized, {
        referenceId: opts.referenceId,
        minorUnits: opts.minorUnits,
        merchantId: this.merchantId,
      });
      auth = authorized.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!auth?.id) {
        throw new PayPalVerificationError("PayPal returned no authorization ID");
      }
    }
    assertPayPalAmount(auth.amount, opts.minorUnits, "authorization amount");
    if (auth.status !== "CREATED") {
      throw new PayPalVerificationError(
        `PayPal authorization status is ${auth.status}, not an open hold`
      );
    }
    return {
      authorization: auth,
      recovered: order.status === "COMPLETED",
      payee: this.merchantId,
    };
  }

  async verifiedAuthorization(
    authId: string,
    minorUnits: number,
    orderId?: string | null
  ): Promise<PayPalAuthorization> {
    const auth = await this.getAuthorization(authId);
    if (auth?.id !== authId) {
      throw new PayPalVerificationError("PayPal returned a mismatched authorization ID");
    }
    assertPayPalAmount(auth.amount, minorUnits, "authorization amount");
    const related = auth.supplementary_data?.related_ids?.order_id;
    if (related && orderId && related !== orderId) {
      throw new PayPalVerificationError(
        `Authorization belongs to order ${related}, not ${orderId}`
      );
    }
    if (auth.payee?.merchant_id) {
      assertPayPalPayee(auth, this.merchantId);
      auth.payeeVerifiedVia = "authorization";
      return auth;
    }
    const parentOrderId = related || orderId;
    if (!parentOrderId) {
      throw new PayPalVerificationError(
        "Authorization reports no payee and no parent order; cannot verify contractor merchant"
      );
    }
    const parent = await this.getOrder(parentOrderId);
    assertPayPalPayee(parent, this.merchantId);
    const hasAuth = parent.purchase_units?.[0]?.payments?.authorizations?.some(
      (a) => a.id === authId
    );
    if (!hasAuth) {
      throw new PayPalVerificationError("Parent order does not contain this authorization");
    }
    auth.payeeVerifiedVia = "parent_order";
    return auth;
  }

  async captureAuthorization(
    authId: string,
    opts: { minorUnits: number; requestId: string; orderId?: string | null }
  ): Promise<{ captureId: string; status: string }> {
    const auth = await this.verifiedAuthorization(authId, opts.minorUnits, opts.orderId);
    if (!["CREATED", "PENDING", "CAPTURED"].includes(auth.status)) {
      throw new PayPalVerificationError(
        `Authorization cannot be captured (status: ${auth.status})`
      );
    }
    const capture = await this.request<PayPalCapture>(
      `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`,
      {
        method: "POST",
        requestId: opts.requestId,
        body: {
          amount: { currency_code: "USD", value: formatPayPalAmount(opts.minorUnits) },
          final_capture: true,
        },
      }
    );
    return runAfterSend(async () => {
      if (!capture?.id) {
        throw new PayPalVerificationError("Capture response has no capture ID");
      }
      const verified = await this.getCapture(capture.id);
      assertPayPalAmount(verified?.amount, opts.minorUnits, "capture amount");
      return { captureId: capture.id, status: verified?.status || capture.status };
    });
  }

  async voidAuthorization(
    authId: string,
    opts: { minorUnits: number; requestId: string; orderId?: string | null }
  ): Promise<{ authorizationId: string; status: string }> {
    const auth = await this.verifiedAuthorization(authId, opts.minorUnits, opts.orderId);
    if (auth.status === "CREATED" || auth.status === "PENDING") {
      await this.request(`/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, {
        method: "POST",
        body: {},
        requestId: opts.requestId,
      });
    } else if (auth.status !== "VOIDED") {
      throw new PayPalVerificationError(
        `Authorization cannot be voided (status: ${auth.status})`
      );
    }
    return runAfterSend(async () => {
      const verified = await this.getAuthorization(authId);
      if (verified?.status !== "VOIDED") {
        throw new PayPalVerificationError(
          `Void not verified (PayPal status: ${verified?.status || "missing"})`
        );
      }
      return { authorizationId: authId, status: verified.status };
    });
  }

  async verifyWebhookSignature(opts: {
    webhookId: string;
    headers: Headers;
    event: unknown;
  }): Promise<boolean> {
    const transmissionId = opts.headers.get("paypal-transmission-id");
    const transmissionTime = opts.headers.get("paypal-transmission-time");
    const transmissionSig = opts.headers.get("paypal-transmission-sig");
    const certUrl = opts.headers.get("paypal-cert-url");
    const authAlgo = opts.headers.get("paypal-auth-algo");
    if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
      throw new PayPalVerificationError("Missing PayPal webhook signature headers");
    }
    const bearer = await this.token();
    const res = await this.fetchImpl(
      `${PAYPAL_SANDBOX_BASE}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        cache: "no-store",
        signal: timeoutSignal(this.timeoutMs),
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: opts.webhookId,
          webhook_event: opts.event,
        }),
      }
    );
    const json = (await res.json().catch(() => null)) as {
      verification_status?: string;
    } | null;
    if (!res.ok) {
      throw new PayPalApiError(`PayPal webhook verification error ${res.status}`, {
        status: res.status,
      });
    }
    return json?.verification_status === "SUCCESS";
  }
}

export function getPayPalClientConfig() {
  const clientId = process.env.PAYPAL_CLIENT_ID || process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "";
  const secret = process.env.PAYPAL_CLIENT_SECRET || "";
  const merchantId = process.env.PAYPAL_MERCHANT_ID || "";
  const webhookId = process.env.PAYPAL_WEBHOOK_ID || "";
  return {
    configured: Boolean(clientId && secret && merchantId),
    clientId: clientId || null,
    secret: secret || null,
    merchantId: merchantId || null,
    webhookId: webhookId || null,
  };
}

export function createPayPalSandboxClient(): PayPalSandboxClient | null {
  const cfg = getPayPalClientConfig();
  if (!cfg.configured || !cfg.clientId || !cfg.secret || !cfg.merchantId) return null;
  return new PayPalSandboxClient({
    clientId: cfg.clientId,
    secret: cfg.secret,
    merchantId: cfg.merchantId,
  });
}
