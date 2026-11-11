import { getRepo } from "../db";
import { HttpError } from "../errors";
import type {
  DecisionAction,
  PaymentStatus,
  Profile,
  TaskBundle,
} from "../types";
import {
  PayPalApiError,
  PayPalSandboxClient,
  assertOrderMatchesTask,
  createPayPalSandboxClient,
  getPayPalClientConfig,
} from "./paypal-client";
import { mapCaptureStatusToPaymentStatus } from "./state-machine";

const REUSABLE_ORDER_STATUSES = ["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED", "SAVED"];
const HOLD_ENDED_STATUSES = ["EXPIRED", "DENIED", "VOIDED"];

function requirePayPalClient(overrideClient?: PayPalSandboxClient): PayPalSandboxClient {
  if (overrideClient) return overrideClient;
  const client = createPayPalSandboxClient();
  if (!client) {
    throw new HttpError(
      503,
      "PayPal Sandbox credentials are not configured (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MERCHANT_ID). Add them in .env.local to execute real PayPal API calls."
    );
  }
  return client;
}

function makeRequestIds(taskId: string, nonce: string, attempt: number, authId?: string | null) {
  return {
    createOrder: `punchpay-order-${taskId}-${nonce}-${attempt}`,
    authorize: (orderId: string) => `punchpay-authorize-${orderId}`,
    capture: `punchpay-capture-${authId || taskId}`,
    void: `punchpay-void-${authId || taskId}`,
  };
}

function isDefinitelyNotSent(error: unknown): boolean {
  const afterSend = (error as { afterSend?: boolean } | null)?.afterSend;
  if (afterSend) return false;
  if (
    error instanceof PayPalApiError &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 409
  ) {
    return true;
  }
  if (error instanceof Error && error.name === "VerificationError") {
    return true;
  }
  return false;
}

async function assertTaskOwner(taskId: string, user: Profile, requiredRole?: "homeowner" | "contractor") {
  const repo = getRepo();
  const project = await repo.getTaskProject(taskId);
  if (!project) throw new HttpError(404, "Task not found");
  const isHomeowner = project.homeowner_id === user.id;
  const isContractor = project.contractor_id === user.id;
  if (!isHomeowner && !isContractor) {
    throw new HttpError(403, "You do not have access to this repair project");
  }
  if (requiredRole === "homeowner" && !isHomeowner) {
    throw new HttpError(403, "Only the homeowner can authorize or settle payments.");
  }
  if (requiredRole === "contractor" && !isContractor) {
    throw new HttpError(403, "Only the assigned contractor can upload evidence or request AI review.");
  }
  const task = await repo.getTaskBundle(taskId);
  if (!task) throw new HttpError(404, "Task not found");
  return { project, task };
}

export async function createOrderForTask(
  taskId: string,
  user: Profile,
  paypalOverride?: PayPalSandboxClient
) {
  const repo = getRepo();
  const pp = requirePayPalClient(paypalOverride);
  const { project, task } = await assertTaskOwner(taskId, user, "homeowner");
  const payment = task.payment;

  if (
    (payment.payment_status === "ORDER_CREATED" ||
      payment.payment_status === "BUYER_APPROVAL_PENDING") &&
    payment.paypal_order_id
  ) {
    try {
      const existing = await pp.getOrder(payment.paypal_order_id);
      if (REUSABLE_ORDER_STATUSES.includes(existing.status)) {
        assertOrderMatchesTask(existing, {
          referenceId: task.id,
          minorUnits: task.amount_minor_units,
          merchantId: pp.merchantId,
        });
        return { orderId: existing.id, status: existing.status, reused: true };
      }
      if (existing.status === "COMPLETED") {
        const auth = existing.purchase_units?.[0]?.payments?.authorizations?.[0];
        if (!auth || !HOLD_ENDED_STATUSES.includes(auth.status)) {
          throw new HttpError(
            409,
            "This PayPal order is already completed/authorized. Use Reconcile to sync it."
          );
        }
      }
    } catch (err) {
      if (!(err instanceof PayPalApiError && err.status === 404)) throw err;
    }

    await repo.claimPaymentState(task.id, ["ORDER_CREATED", "BUYER_APPROVAL_PENDING"], "DRAFT", {
      paypal_order_id: null,
      paypal_status: null,
      payee_merchant_id: null,
      order_attempt: payment.order_attempt + 1,
    });
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "system",
      event_type: "order_abandoned",
      safe_metadata: { order_id: payment.paypal_order_id },
    });
  }

  const fresh = await repo.getTaskBundle(taskId);
  if (!fresh) throw new HttpError(404, "Task not found");
  if (!["DRAFT", "PAYMENT_FAILED"].includes(fresh.payment.payment_status)) {
    throw new HttpError(
      409,
      `Cannot create order when payment status is ${fresh.payment.payment_status}`
    );
  }

  const reqIds = makeRequestIds(
    fresh.id,
    fresh.payment.request_nonce,
    fresh.payment.order_attempt
  );
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const returnUrl = `${appUrl}/projects/${project.id}?paypalReturn=1&taskId=${fresh.id}`;

  const { order, payee } = await pp.createOrder({
    referenceId: fresh.id,
    description: `${fresh.title} - ${project.title}`,
    minorUnits: fresh.amount_minor_units,
    requestId: reqIds.createOrder,
    returnUrl,
    cancelUrl: returnUrl,
  });

  await repo.claimPaymentState(fresh.id, ["DRAFT", "PAYMENT_FAILED"], "BUYER_APPROVAL_PENDING", {
    paypal_order_id: order.id,
    paypal_status: order.status,
    payee_merchant_id: payee,
    last_error: null,
  });

  await repo.recordPaymentEvent({
    payment_record_id: fresh.payment.id,
    task_id: fresh.id,
    actor: "paypal",
    event_type: "order_created",
    safe_metadata: {
      order_id: order.id,
      status: order.status,
      amount_minor_units: fresh.amount_minor_units,
      payee_merchant_id: payee,
    },
  });

  return { orderId: order.id, status: order.status, reused: false };
}

export async function authorizeOrderForTask(
  taskId: string,
  user: Profile,
  paypalOverride?: PayPalSandboxClient
) {
  const repo = getRepo();
  const pp = requirePayPalClient(paypalOverride);
  const { task } = await assertTaskOwner(taskId, user, "homeowner");
  const payment = task.payment;

  if (payment.paypal_authorization_id && payment.payment_status !== "DRAFT") {
    return {
      authorizationId: payment.paypal_authorization_id,
      status: payment.paypal_status,
      already: true,
    };
  }
  if (
    !["ORDER_CREATED", "BUYER_APPROVAL_PENDING"].includes(payment.payment_status) ||
    !payment.paypal_order_id
  ) {
    throw new HttpError(409, "Create and approve a PayPal order first.");
  }

  const reqIds = makeRequestIds(task.id, payment.request_nonce, payment.order_attempt);
  const opKey = `authorize:${payment.paypal_order_id}`;
  const idem = await repo.beginIdempotency({
    operation_key: opKey,
    payment_record_id: payment.id,
    operation_type: "authorize",
  });
  if (!idem.acquired && idem.existing?.status === "SUCCEEDED") {
    return {
      authorizationId: payment.paypal_authorization_id,
      status: payment.paypal_status,
      already: true,
    };
  }

  try {
    const { authorization, recovered, payee } = await pp.authorizeApproved(
      payment.paypal_order_id,
      {
        referenceId: task.id,
        minorUnits: task.amount_minor_units,
        requestId: reqIds.authorize(payment.paypal_order_id),
      }
    );

    await repo.claimPaymentState(
      task.id,
      ["ORDER_CREATED", "BUYER_APPROVAL_PENDING"],
      "AUTHORIZED",
      {
        paypal_authorization_id: authorization.id,
        paypal_status: authorization.status,
        payee_merchant_id: payee,
        authorization_created_at: authorization.create_time ?? new Date().toISOString(),
        authorization_expires_at: authorization.expiration_time ?? null,
        last_error: null,
      }
    );

    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "paypal",
      event_type: recovered ? "authorization_recovered" : "authorization_created",
      safe_metadata: {
        order_id: payment.paypal_order_id,
        authorization_id: authorization.id,
        status: authorization.status,
        expiration_time: authorization.expiration_time,
        payee_merchant_id: payee,
      },
    });

    const result = {
      authorizationId: authorization.id,
      status: authorization.status,
      expiresAt: authorization.expiration_time ?? null,
      already: false,
    };
    await repo.finishIdempotency(opKey, "SUCCEEDED", result);
    return result;
  } catch (err) {
    await repo.finishIdempotency(opKey, "FAILED");
    throw err;
  }
}

export async function executeHomeownerDecision(
  taskId: string,
  user: Profile,
  input: { decision: DecisionAction; reason: string },
  paypalOverride?: PayPalSandboxClient
) {
  const repo = getRepo();
  const { project, task } = await assertTaskOwner(taskId, user, "homeowner");
  const payment = task.payment;

  if (input.decision === "request_corrections" || input.decision === "request_evidence") {
    if (!["EVIDENCE_SUBMITTED", "AI_REVIEWED", "CORRECTIONS_REQUESTED"].includes(task.work_status)) {
      throw new HttpError(409, "Evidence must be submitted before requesting corrections.");
    }
    await repo.updateTaskWorkStatus(task.id, "CORRECTIONS_REQUESTED", {
      homeowner_feedback: input.reason.trim(),
    });
    await repo.recordDecision({
      task_id: task.id,
      homeowner_id: user.id,
      decision: input.decision,
      reason: input.reason.trim(),
    });
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "homeowner",
      event_type: input.decision,
      safe_metadata: { reason: input.reason.trim() },
    });
    return {
      workStatus: "CORRECTIONS_REQUESTED",
      paymentStatus: payment.payment_status,
      message: "Feedback sent to contractor. PayPal authorization hold remains untouched.",
    };
  }

  // Settlement actions: accept (capture) or reject (void)
  const accepted = input.decision === "accept";
  if (accepted && payment.payment_status === "CAPTURED") {
    return {
      workStatus: task.work_status,
      paymentStatus: payment.payment_status,
      captureId: payment.paypal_capture_id,
      paypalStatus: payment.paypal_status,
      already: true,
    };
  }
  if (!accepted && payment.payment_status === "VOIDED") {
    return {
      workStatus: task.work_status,
      paymentStatus: payment.payment_status,
      authorizationId: payment.paypal_authorization_id,
      paypalStatus: payment.paypal_status,
      already: true,
    };
  }

  if (!payment.paypal_authorization_id) {
    throw new HttpError(409, "No PayPal authorization exists for this task yet.");
  }
  if (!["AUTHORIZED", "SETTLEMENT_PENDING", "PAYMENT_FAILED"].includes(payment.payment_status)) {
    throw new HttpError(
      409,
      `Payment is ${payment.payment_status} and cannot execute ${input.decision}. Refresh or reconcile.`
    );
  }
  if (!["EVIDENCE_SUBMITTED", "AI_REVIEWED", "CORRECTIONS_REQUESTED"].includes(task.work_status)) {
    throw new HttpError(409, "Contractor must submit evidence before settlement.");
  }

  const pp = requirePayPalClient(paypalOverride);
  const authId = payment.paypal_authorization_id;

  // Preflight PayPal GET check before claiming pending state
  const liveAuth = await pp.verifiedAuthorization(
    authId,
    task.amount_minor_units,
    payment.paypal_order_id
  );

  if (liveAuth.status === "EXPIRED") {
    await repo.claimPaymentState(
      task.id,
      ["AUTHORIZED", "SETTLEMENT_PENDING", "PAYMENT_FAILED"],
      "AUTHORIZATION_EXPIRED",
      { paypal_status: liveAuth.status, last_error: "PayPal authorization expired" }
    );
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "paypal",
      event_type: "authorization_expired",
      safe_metadata: { authorization_id: authId, status: liveAuth.status },
    });
    throw new HttpError(
      409,
      "PayPal reports this authorization has EXPIRED. No money was moved."
    );
  }

  if (HOLD_ENDED_STATUSES.includes(liveAuth.status)) {
    const target: PaymentStatus = liveAuth.status === "VOIDED" ? "VOIDED" : "PAYMENT_FAILED";
    await repo.claimPaymentState(
      task.id,
      ["AUTHORIZED", "SETTLEMENT_PENDING", "PAYMENT_FAILED"],
      target,
      {
        paypal_status: liveAuth.status,
        last_error: `PayPal reports authorization is ${liveAuth.status}`,
      }
    );
    throw new HttpError(
      409,
      `PayPal reports this authorization is ${liveAuth.status}. Reconciled without moving funds.`
    );
  }

  if (liveAuth.status !== "CREATED") {
    throw new HttpError(
      409,
      `PayPal authorization status is ${liveAuth.status}, not open for ${input.decision}. Run Reconcile.`
    );
  }

  const opType = accepted ? "capture" : "void";
  const opKey = `${opType}:${authId}`;
  const idem = await repo.beginIdempotency({
    operation_key: opKey,
    payment_record_id: payment.id,
    operation_type: opType,
  });
  if (!idem.acquired) {
    if (idem.existing?.status === "IN_PROGRESS") {
      throw new HttpError(
        409,
        "A settlement request for this authorization is already in flight. Wait a moment and reconcile."
      );
    }
    if (idem.existing?.status === "SUCCEEDED" && idem.existing.response_json) {
      return { ...idem.existing.response_json, already: true };
    }
  }

  const pendingStatus: PaymentStatus = accepted ? "CAPTURE_PENDING" : "VOID_PENDING";
  await repo.claimPaymentState(
    task.id,
    ["AUTHORIZED", "SETTLEMENT_PENDING", "PAYMENT_FAILED"],
    pendingStatus,
    { last_error: null }
  );

  await repo.recordDecision({
    task_id: task.id,
    homeowner_id: user.id,
    decision: input.decision,
    reason: input.reason.trim(),
  });

  await repo.recordPaymentEvent({
    payment_record_id: payment.id,
    task_id: task.id,
    actor: "homeowner",
    event_type: accepted ? "decision_accept" : "decision_reject",
    safe_metadata: {
      amount_minor_units: task.amount_minor_units,
      ai_recommendation: task.latest_review?.recommendation ?? "none",
      reason: input.reason.trim(),
    },
  });

  const reqIds = makeRequestIds(task.id, payment.request_nonce, payment.order_attempt, authId);

  try {
    if (accepted) {
      const cap = await pp.captureAuthorization(authId, {
        minorUnits: task.amount_minor_units,
        requestId: reqIds.capture,
        orderId: payment.paypal_order_id,
      });
      const mapped = mapCaptureStatusToPaymentStatus(cap.status);
      await repo.claimPaymentState(task.id, ["CAPTURE_PENDING"], mapped, {
        paypal_capture_id: cap.captureId,
        paypal_status: cap.status,
        last_error: mapped === "CAPTURED" ? null : `PayPal capture reported ${cap.status}`,
      });
      if (mapped === "CAPTURED") {
        await repo.updateTaskWorkStatus(task.id, "ACCEPTED", {
          homeowner_feedback: input.reason.trim(),
        });
      }
      await repo.recordPaymentEvent({
        payment_record_id: payment.id,
        task_id: task.id,
        actor: "paypal",
        event_type: mapped === "CAPTURED" ? "payment_captured" : "capture_status_updated",
        safe_metadata: {
          authorization_id: authId,
          capture_id: cap.captureId,
          status: cap.status,
        },
      });
      const out = {
        workStatus: mapped === "CAPTURED" ? "ACCEPTED" : task.work_status,
        paymentStatus: mapped,
        captureId: cap.captureId,
        paypalStatus: cap.status,
        already: false,
      };
      await repo.finishIdempotency(opKey, "SUCCEEDED", out);
      await maybeCompleteProject(project.id);
      return out;
    }

    const voided = await pp.voidAuthorization(authId, {
      minorUnits: task.amount_minor_units,
      requestId: reqIds.void,
      orderId: payment.paypal_order_id,
    });
    await repo.claimPaymentState(task.id, ["VOID_PENDING"], "VOIDED", {
      paypal_status: voided.status,
      last_error: null,
    });
    await repo.updateTaskWorkStatus(task.id, "REJECTED", {
      homeowner_feedback: input.reason.trim(),
    });
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "paypal",
      event_type: "authorization_voided",
      safe_metadata: {
        authorization_id: voided.authorizationId,
        status: voided.status,
      },
    });
    const out = {
      workStatus: "REJECTED",
      paymentStatus: "VOIDED",
      authorizationId: voided.authorizationId,
      paypalStatus: voided.status,
      already: false,
    };
    await repo.finishIdempotency(opKey, "SUCCEEDED", out);
    await maybeCompleteProject(project.id);
    return out;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PayPal request could not be completed";
    if (isDefinitelyNotSent(error)) {
      await repo
        .claimPaymentState(task.id, [pendingStatus], "AUTHORIZED", {
          last_error: message.slice(0, 500),
        })
        .catch(() => null);
      await repo.finishIdempotency(opKey, "FAILED");
      await repo.recordPaymentEvent({
        payment_record_id: payment.id,
        task_id: task.id,
        actor: "paypal",
        event_type: "settlement_rejected_before_move",
        safe_metadata: { error: message.slice(0, 300) },
      });
      throw new HttpError(409, `${message}. No money was moved.`);
    }

    await repo
      .claimPaymentState(task.id, [pendingStatus], "RECONCILIATION_REQUIRED", {
        last_error: message.slice(0, 500),
      })
      .catch(() => null);
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "system",
      event_type: "reconciliation_required",
      safe_metadata: { error: message.slice(0, 300), attempted: opType },
    });
    throw new HttpError(
      502,
      `${message}. Payment outcome unconfirmed — use Reconcile Status instead of retrying.`
    );
  }
}

export async function reconcileTaskPayment(
  taskId: string,
  user: Profile,
  paypalOverride?: PayPalSandboxClient
) {
  const repo = getRepo();
  const pp = requirePayPalClient(paypalOverride);
  const { project, task } = await assertTaskOwner(taskId, user);
  const payment = task.payment;

  if (
    ["ORDER_CREATED", "BUYER_APPROVAL_PENDING"].includes(payment.payment_status) &&
    payment.paypal_order_id
  ) {
    const order = await pp.getOrder(payment.paypal_order_id);
    assertOrderMatchesTask(order, {
      referenceId: task.id,
      minorUnits: task.amount_minor_units,
      merchantId: pp.merchantId,
    });
    const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) {
      await repo.claimPaymentState(
        task.id,
        ["ORDER_CREATED", "BUYER_APPROVAL_PENDING"],
        "BUYER_APPROVAL_PENDING",
        { paypal_status: order.status }
      );
      return {
        paymentStatus: "BUYER_APPROVAL_PENDING",
        paypalStatus: order.status,
        message:
          order.status === "APPROVED"
            ? "Buyer approved order at PayPal; ready to authorize."
            : `Order is ${order.status} at PayPal.`,
      };
    }

    const verified = await pp.verifiedAuthorization(
      auth.id,
      task.amount_minor_units,
      order.id
    );
    const nextStatus: PaymentStatus =
      verified.status === "CREATED"
        ? "AUTHORIZED"
        : verified.status === "VOIDED"
        ? "VOIDED"
        : verified.status === "EXPIRED"
        ? "AUTHORIZATION_EXPIRED"
        : "RECONCILIATION_REQUIRED";

    await repo.claimPaymentState(
      task.id,
      ["ORDER_CREATED", "BUYER_APPROVAL_PENDING"],
      nextStatus,
      {
        paypal_authorization_id: verified.id,
        paypal_status: verified.status,
        payee_merchant_id: pp.merchantId,
        authorization_created_at: verified.create_time ?? new Date().toISOString(),
        authorization_expires_at: verified.expiration_time ?? null,
        last_error: null,
      }
    );
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "paypal",
      event_type: "reconciled_order",
      safe_metadata: {
        order_id: order.id,
        authorization_id: verified.id,
        status: verified.status,
      },
    });
    return {
      paymentStatus: nextStatus,
      paypalStatus: verified.status,
      authorizationId: verified.id,
      message: `Reconciled authorization ${verified.id} (${verified.status}).`,
    };
  }

  if (!payment.paypal_authorization_id) {
    throw new HttpError(409, "No PayPal order or authorization recorded for this task yet.");
  }

  const auth = await pp.verifiedAuthorization(
    payment.paypal_authorization_id,
    task.amount_minor_units,
    payment.paypal_order_id
  );
  const order = payment.paypal_order_id ? await pp.getOrder(payment.paypal_order_id) : null;
  const captureId =
    payment.paypal_capture_id ||
    order?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
    null;

  if (captureId) {
    const capture = await pp.getCapture(captureId);
    const nextStatus = mapCaptureStatusToPaymentStatus(capture.status);
    if (payment.payment_status !== nextStatus || payment.paypal_status !== capture.status) {
      await repo.claimPaymentState(task.id, [payment.payment_status], nextStatus, {
        paypal_capture_id: capture.id,
        paypal_status: capture.status,
        last_error: null,
      });
      if (nextStatus === "CAPTURED" && task.work_status !== "ACCEPTED") {
        await repo.updateTaskWorkStatus(task.id, "ACCEPTED");
      }
      await repo.recordPaymentEvent({
        payment_record_id: payment.id,
        task_id: task.id,
        actor: "paypal",
        event_type: "reconciled_capture",
        safe_metadata: { capture_id: capture.id, status: capture.status },
      });
    }
    await maybeCompleteProject(project.id);
    return {
      paymentStatus: nextStatus,
      paypalStatus: capture.status,
      captureId: capture.id,
      message: `PayPal reports capture ${capture.id} (${capture.status}).`,
    };
  }

  let nextStatus: PaymentStatus = payment.payment_status;
  if (auth.status === "VOIDED") nextStatus = "VOIDED";
  else if (auth.status === "EXPIRED") nextStatus = "AUTHORIZATION_EXPIRED";
  else if (auth.status === "CREATED") nextStatus = "AUTHORIZED";

  if (nextStatus !== payment.payment_status || auth.status !== payment.paypal_status) {
    await repo.claimPaymentState(task.id, [payment.payment_status], nextStatus, {
      paypal_status: auth.status,
      authorization_expires_at: auth.expiration_time ?? payment.authorization_expires_at,
      last_error: null,
    });
    if (nextStatus === "VOIDED" && task.work_status !== "REJECTED") {
      await repo.updateTaskWorkStatus(task.id, "REJECTED");
    }
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "paypal",
      event_type: "reconciled_authorization",
      safe_metadata: { authorization_id: auth.id, status: auth.status },
    });
  }

  await maybeCompleteProject(project.id);
  return {
    paymentStatus: nextStatus,
    paypalStatus: auth.status,
    authorizationId: auth.id,
    message: `Reconciled with PayPal: authorization ${auth.id} is ${auth.status}.`,
  };
}

export async function processPayPalWebhook(headers: Headers, rawBody: string) {
  const cfg = getPayPalClientConfig();
  const pp = requirePayPalClient();
  if (!cfg.webhookId) {
    throw new HttpError(503, "PAYPAL_WEBHOOK_ID is not configured on the server.");
  }
  const event = JSON.parse(rawBody) as {
    id?: string;
    event_type?: string;
    resource?: {
      id?: string;
      status?: string;
      supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } };
    };
  };

  const verified = await pp.verifyWebhookSignature({
    webhookId: cfg.webhookId,
    headers,
    event,
  });
  if (!verified) {
    throw new HttpError(401, "PayPal webhook signature verification failed.");
  }

  const repo = getRepo();
  const resourceId = event.resource?.id ?? null;
  const related = event.resource?.supplementary_data?.related_ids;
  const payment = await repo.findPaymentByPayPalIds({
    orderId: related?.order_id ?? (event.event_type?.includes("ORDER") ? resourceId : null),
    authorizationId:
      related?.authorization_id ??
      (event.event_type?.includes("AUTHORIZATION") ? resourceId : null),
    captureId: event.event_type?.includes("CAPTURE") ? resourceId : null,
  });

  if (!payment) {
    return { received: true, matched: false };
  }

  const inserted = await repo.recordPaymentEvent({
    payment_record_id: payment.id,
    task_id: payment.task_id,
    actor: "webhook",
    event_type: event.event_type || "paypal.webhook",
    paypal_event_id: event.id || null,
    safe_metadata: {
      resource_id: resourceId,
      resource_status: event.resource?.status ?? null,
    },
  });

  if (!inserted) {
    return { received: true, matched: true, duplicate: true };
  }

  // Update payment state safely based on webhook event type
  if (event.event_type === "PAYMENT.AUTHORIZATION.VOIDED" && payment.payment_status !== "VOIDED") {
    await repo
      .claimPaymentState(payment.task_id, [payment.payment_status], "VOIDED", {
        paypal_status: "VOIDED",
      })
      .catch(() => null);
  } else if (
    event.event_type === "PAYMENT.CAPTURE.COMPLETED" &&
    payment.payment_status !== "CAPTURED"
  ) {
    await repo
      .claimPaymentState(payment.task_id, [payment.payment_status], "CAPTURED", {
        paypal_capture_id: resourceId || payment.paypal_capture_id,
        paypal_status: "COMPLETED",
      })
      .catch(() => null);
  }

  return { received: true, matched: true, duplicate: false };
}

async function maybeCompleteProject(projectId: string) {
  const repo = getRepo();
  const project = await repo.getProjectBundle(projectId);
  if (!project || project.tasks.length === 0) return;
  const allSettled = project.tasks.every((t) =>
    ["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(t.payment_status)
  );
  if (allSettled && project.status !== "COMPLETED") {
    await repo.updateProjectStatus(projectId, "COMPLETED");
  }
}

export async function assertCanAccessProject(projectId: string, user: Profile) {
  const repo = getRepo();
  const project = await repo.getProjectBundle(projectId);
  if (!project) throw new HttpError(404, "Project not found");
  if (project.homeowner_id !== user.id && project.contractor_id !== user.id) {
    throw new HttpError(403, "Access denied");
  }
  return project;
}

export function computeGuidedDemoStep(tasks: TaskBundle[]): number {
  if (tasks.length === 0) return 1;
  const allAuthorizedOrSettled = tasks.every((t) => t.payment.paypal_authorization_id !== null);
  const allHaveBeforeAfter = tasks.every(
    (t) =>
      t.evidence.some((e) => e.evidence_type === "before") &&
      t.evidence.some((e) => e.evidence_type === "after")
  );
  const allReviewed = tasks.every((t) => t.latest_review !== null);
  const allDecided = tasks.every((t) => t.decisions.length > 0);
  const allSettled = tasks.every((t) =>
    ["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(t.payment_status)
  );
  if (allSettled) return 6;
  if (allDecided) return 5;
  if (allReviewed) return 4;
  if (allHaveBeforeAfter) return 3;
  if (allAuthorizedOrSettled) return 2;
  return 1;
}
