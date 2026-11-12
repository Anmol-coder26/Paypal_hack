import crypto from "node:crypto";
import { getRepo } from "../db";
import { HttpError } from "../errors";
import { getPayPalClientConfig } from "./paypal-client";
import type { DecisionAction, PaymentMode, Profile, Project, TaskBundle } from "../types";

export function isDemoModeEnabled(): boolean {
  return ["true", "1", "yes"].includes(
    (process.env.PUNCHPAY_DEMO_MODE || "").trim().toLowerCase()
  );
}

export function getConfiguredPaymentMode(): PaymentMode {
  const raw = (process.env.PAYMENT_MODE || "").trim().toLowerCase();
  if (raw === "simulation") return "simulation";
  if (raw === "paypal_sandbox") return "paypal_sandbox";
  if (isDemoModeEnabled()) return "simulation";
  return getPayPalClientConfig().configured ? "paypal_sandbox" : "simulation";
}

function shortToken(): string {
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

export async function simCreateIntentForTask(task: TaskBundle, project: Project) {
  const repo = getRepo();
  const payment = task.payment;

  if (
    payment.payment_status === "BUYER_APPROVAL_PENDING" &&
    payment.sim_intent_id
  ) {
    return {
      mode: "simulation" as const,
      orderId: payment.sim_intent_id,
      status: payment.payment_status,
      payeeMerchantId: payment.payee_merchant_id || "DEMO-MERCHANT-ACCT",
      reused: true,
    };
  }

  if (!["DRAFT", "ORDER_CREATED", "PAYMENT_FAILED"].includes(payment.payment_status)) {
    throw new HttpError(
      409,
      `Task payment is ${payment.payment_status} and cannot create a new simulated order.`
    );
  }

  const nextAttempt =
    payment.payment_status === "PAYMENT_FAILED" ? payment.order_attempt + 1 : payment.order_attempt;
  const opKey = `sim-intent:${task.id}:${nextAttempt}`;
  const lock = await repo.beginIdempotency({
    operation_key: opKey,
    payment_record_id: payment.id,
    operation_type: "create_order",
  });
  if (!lock.acquired) {
    if (lock.existing?.status === "SUCCEEDED" && lock.existing.response_json) {
      return lock.existing.response_json as {
        mode: "simulation";
        orderId: string;
        status: string;
        payeeMerchantId: string;
        reused: boolean;
      };
    }
    throw new HttpError(409, "Simulated order creation already in progress.");
  }

  try {
    const simIntentId = `DEMO-ORD-${shortToken()}`;
    const simMerchant = `DEMO-MERCHANT-${project.contractor_id.slice(0, 6).toUpperCase()}`;
    await repo.claimPaymentState(
      task.id,
      ["DRAFT", "ORDER_CREATED", "PAYMENT_FAILED"],
      "ORDER_CREATED",
      {
        payment_mode: "simulation",
        order_attempt: nextAttempt,
        sim_intent_id: simIntentId,
        sim_status: "CREATED",
        payee_merchant_id: simMerchant,
        last_error: null,
      }
    );
    await repo.claimPaymentState(task.id, ["ORDER_CREATED"], "BUYER_APPROVAL_PENDING", {
      sim_status: "BUYER_APPROVAL_PENDING",
    });

    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "simulation",
      event_type: "sim_order_created",
      safe_metadata: {
        demo_order_id: simIntentId,
        amount_minor_units: task.amount_minor_units,
        payment_mode: "simulation",
      },
    });

    const response = {
      mode: "simulation" as const,
      orderId: simIntentId,
      status: "BUYER_APPROVAL_PENDING",
      payeeMerchantId: simMerchant,
      reused: false,
    };
    await repo.finishIdempotency(opKey, "SUCCEEDED", response);
    return response;
  } catch (err) {
    await repo.finishIdempotency(opKey, "FAILED");
    throw err;
  }
}

export interface SimAuthorizeResult {
  mode: "simulation";
  authorizationId: string;
  status: string;
  already?: boolean;
}

export async function simAuthorizeTask(
  task: TaskBundle,
  project: Project,
  opts: { simulateTimeout?: boolean } = {}
): Promise<SimAuthorizeResult> {
  const repo = getRepo();
  const payment = task.payment;

  if (payment.payment_status === "AUTHORIZED" && payment.sim_authorization_id) {
    return {
      mode: "simulation" as const,
      authorizationId: payment.sim_authorization_id,
      status: "CREATED",
      already: true,
    };
  }
  if (!payment.sim_intent_id) {
    throw new HttpError(409, "Create a simulated payment intent first.");
  }
  if (
    ![
      "ORDER_CREATED",
      "BUYER_APPROVAL_PENDING",
      "PAYMENT_FAILED",
      "RECONCILIATION_REQUIRED",
    ].includes(payment.payment_status)
  ) {
    throw new HttpError(
      409,
      `Simulated intent cannot authorize from state ${payment.payment_status}.`
    );
  }

  const opKey = `sim-authorize:${payment.sim_intent_id}`;
  const lock = await repo.beginIdempotency({
    operation_key: opKey,
    payment_record_id: payment.id,
    operation_type: "authorize",
  });
  if (!lock.acquired) {
    if (lock.existing?.status === "SUCCEEDED" && lock.existing.response_json) {
      return {
        ...(lock.existing.response_json as {
          mode: "simulation";
          authorizationId: string;
          status: string;
        }),
        already: true,
      };
    }
    throw new HttpError(409, "Simulated authorization is already in flight; run Reconcile.");
  }

  const authId = payment.sim_authorization_id || `DEMO-AUTH-${shortToken()}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 29 * 86400_000).toISOString();

  if (opts.simulateTimeout) {
    // Persist the underlying simulation hold first, then park in RECONCILIATION_REQUIRED so reconcile proves recovery
    await repo.claimPaymentState(
      task.id,
      ["ORDER_CREATED", "BUYER_APPROVAL_PENDING", "PAYMENT_FAILED", "RECONCILIATION_REQUIRED"],
      "RECONCILIATION_REQUIRED",
      {
        sim_authorization_id: authId,
        sim_status: "CREATED",
        authorization_created_at: createdAt,
        authorization_expires_at: expiresAt,
        last_error: "Simulated network timeout after authorization; run Reconcile to confirm.",
      }
    );
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "simulation",
      event_type: "sim_authorization_uncertain",
      safe_metadata: { demo_authorization_id: authId, reason: "simulated_timeout" },
    });
    throw new HttpError(
      504,
      "Simulated timeout after sending authorization. Payment parked in RECONCILIATION_REQUIRED — use Reconcile instead of retrying."
    );
  }

  await repo.claimPaymentState(
    task.id,
    ["ORDER_CREATED", "BUYER_APPROVAL_PENDING", "PAYMENT_FAILED", "RECONCILIATION_REQUIRED"],
    "AUTHORIZED",
    {
      sim_authorization_id: authId,
      sim_status: "CREATED",
      payee_merchant_id:
        payment.payee_merchant_id || `DEMO-MERCHANT-${project.contractor_id.slice(0, 6).toUpperCase()}`,
      authorization_created_at: createdAt,
      authorization_expires_at: expiresAt,
      last_error: null,
    }
  );
  await repo.recordPaymentEvent({
    payment_record_id: payment.id,
    task_id: task.id,
    actor: "simulation",
    event_type: "sim_authorization_created",
    safe_metadata: {
      demo_authorization_id: authId,
      amount_minor_units: task.amount_minor_units,
      note: "Payment lifecycle simulated locally. No funds moved.",
    },
  });

  const result = {
    mode: "simulation" as const,
    authorizationId: authId,
    status: "CREATED",
  };
  await repo.finishIdempotency(opKey, "SUCCEEDED", result);
  return result;
}

export interface SimSettlementResult {
  mode: "simulation";
  workStatus: string;
  paymentStatus: string;
  captureId?: string | null;
  voidId?: string | null;
  authorizationId?: string | null;
  paypalStatus: string | null;
  already?: boolean;
}

export async function simExecuteSettlement(
  task: TaskBundle,
  project: Project,
  user: Profile,
  input: { decision: Extract<DecisionAction, "accept" | "reject">; reason: string; simulateTimeout?: boolean },
  onProjectMaybeComplete: (projectId: string) => Promise<void>
): Promise<SimSettlementResult> {
  const repo = getRepo();
  const payment = task.payment;
  const accepted = input.decision === "accept";

  if (accepted && payment.payment_status === "CAPTURED") {
    return {
      mode: "simulation" as const,
      workStatus: task.work_status,
      paymentStatus: payment.payment_status,
      captureId: payment.sim_capture_id,
      paypalStatus: payment.sim_status,
      already: true,
    };
  }
  if (!accepted && payment.payment_status === "VOIDED") {
    return {
      mode: "simulation" as const,
      workStatus: task.work_status,
      paymentStatus: payment.payment_status,
      authorizationId: payment.sim_authorization_id,
      voidId: payment.sim_void_id ?? null,
      paypalStatus: payment.sim_status,
      already: true,
    };
  }
  if (!payment.sim_authorization_id) {
    throw new HttpError(409, "No simulated authorization exists for this task yet.");
  }
  if (!["AUTHORIZED", "SETTLEMENT_PENDING", "PAYMENT_FAILED"].includes(payment.payment_status)) {
    throw new HttpError(
      409,
      `Simulated payment is ${payment.payment_status} and cannot execute ${input.decision}.`
    );
  }
  if (!["EVIDENCE_SUBMITTED", "AI_REVIEWED", "CORRECTIONS_REQUESTED"].includes(task.work_status)) {
    throw new HttpError(409, "Contractor must submit evidence before settlement.");
  }

  const authId = payment.sim_authorization_id;
  const opKey = accepted ? `sim-capture:${authId}` : `sim-void:${authId}`;
  const lock = await repo.beginIdempotency({
    operation_key: opKey,
    payment_record_id: payment.id,
    operation_type: accepted ? "capture" : "void",
  });
  if (!lock.acquired) {
    if (lock.existing?.status === "SUCCEEDED" && lock.existing.response_json) {
      return { ...(lock.existing.response_json as unknown as SimSettlementResult), already: true };
    }
    throw new HttpError(409, "Simulated settlement operation already in flight; click Reconcile.");
  }

  await repo.claimPaymentState(
    task.id,
    ["AUTHORIZED", "SETTLEMENT_PENDING", "PAYMENT_FAILED"],
    accepted ? "CAPTURE_PENDING" : "VOID_PENDING"
  );

  if (input.simulateTimeout) {
    const preCapId = accepted ? `DEMO-CAP-${shortToken()}` : null;
    const preVoidId = !accepted ? `DEMO-VOID-${shortToken()}` : null;
    await repo.claimPaymentState(
      task.id,
      [accepted ? "CAPTURE_PENDING" : "VOID_PENDING"],
      "RECONCILIATION_REQUIRED",
      {
        ...(preCapId ? { sim_capture_id: preCapId } : {}),
        ...(preVoidId ? { sim_void_id: preVoidId } : {}),
        sim_status: accepted ? "COMPLETED" : "VOIDED",
        last_error: "Simulated response lost after settlement; click Reconcile to recover status.",
      }
    );
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "simulation",
      event_type: accepted ? "sim_capture_uncertain" : "sim_void_uncertain",
      safe_metadata: {
        demo_authorization_id: authId,
        demo_capture_id: preCapId,
        demo_void_id: preVoidId,
      },
    });
    throw new HttpError(
      504,
      "Simulated timeout during settlement. Parked in RECONCILIATION_REQUIRED — click Reconcile to recover cleanly."
    );
  }

  if (accepted) {
    const captureId = `DEMO-CAP-${shortToken()}`;
    await repo.claimPaymentState(task.id, ["CAPTURE_PENDING"], "CAPTURED", {
      sim_capture_id: captureId,
      sim_status: "COMPLETED",
      last_error: null,
    });
    await repo.updateTaskWorkStatus(task.id, "ACCEPTED", { homeowner_feedback: input.reason });
    await repo.recordDecision({
      task_id: task.id,
      homeowner_id: user.id,
      decision: "accept",
      reason: input.reason,
    });
    await repo.recordPaymentEvent({
      payment_record_id: payment.id,
      task_id: task.id,
      actor: "simulation",
      event_type: "sim_payment_captured",
      safe_metadata: {
        demo_capture_id: captureId,
        demo_authorization_id: authId,
        amount_minor_units: task.amount_minor_units,
        note: "Payment lifecycle simulated locally. No funds moved.",
      },
    });
    await onProjectMaybeComplete(project.id);
    const out = {
      mode: "simulation" as const,
      workStatus: "ACCEPTED",
      paymentStatus: "CAPTURED",
      captureId,
      paypalStatus: "SIM_COMPLETED",
    };
    await repo.finishIdempotency(opKey, "SUCCEEDED", out);
    return out;
  }

  const voidId = `DEMO-VOID-${shortToken()}`;
  await repo.claimPaymentState(task.id, ["VOID_PENDING"], "VOIDED", {
    sim_void_id: voidId,
    sim_status: "VOIDED",
    last_error: null,
  });
  await repo.updateTaskWorkStatus(task.id, "REJECTED", { homeowner_feedback: input.reason });
  await repo.recordDecision({
    task_id: task.id,
    homeowner_id: user.id,
    decision: "reject",
    reason: input.reason,
  });
  await repo.recordPaymentEvent({
    payment_record_id: payment.id,
    task_id: task.id,
    actor: "simulation",
    event_type: "sim_authorization_voided",
    safe_metadata: {
      demo_void_id: voidId,
      demo_authorization_id: authId,
      amount_minor_units: task.amount_minor_units,
      note: "Payment lifecycle simulated locally. No funds moved.",
    },
  });
  await onProjectMaybeComplete(project.id);
  const out = {
    mode: "simulation" as const,
    workStatus: "REJECTED",
    paymentStatus: "VOIDED",
    authorizationId: authId,
    voidId,
    paypalStatus: "SIM_VOIDED",
  };
  await repo.finishIdempotency(opKey, "SUCCEEDED", out);
  return out;
}

export async function simReconcileTask(
  task: TaskBundle,
  project: Project,
  onProjectMaybeComplete: (projectId: string) => Promise<void>
) {
  const repo = getRepo();
  const p = task.payment;

  if (!p.sim_intent_id && !p.sim_authorization_id) {
    throw new HttpError(409, "No simulated order or authorization exists to reconcile.");
  }

  if (p.sim_capture_id || p.sim_status === "COMPLETED") {
    const capId = p.sim_capture_id || `DEMO-CAP-${shortToken()}`;
    await repo.claimPaymentState(
      task.id,
      [p.payment_status],
      "CAPTURED",
      { sim_capture_id: capId, sim_status: "COMPLETED", last_error: null }
    );
    if (!["ACCEPTED", "REJECTED"].includes(task.work_status)) {
      await repo.updateTaskWorkStatus(task.id, "ACCEPTED");
    }
    if (p.sim_authorization_id) {
      await repo.finishIdempotency(`sim-capture:${p.sim_authorization_id}`, "SUCCEEDED", {
        mode: "simulation",
        workStatus: "ACCEPTED",
        paymentStatus: "CAPTURED",
        captureId: capId,
        paypalStatus: "SIM_COMPLETED",
      });
    }
    await repo.recordPaymentEvent({
      payment_record_id: p.id,
      task_id: task.id,
      actor: "simulation",
      event_type: "sim_reconciled_capture",
      safe_metadata: { demo_capture_id: capId },
    });
    await onProjectMaybeComplete(project.id);
    return {
      mode: "simulation" as const,
      paymentStatus: "CAPTURED",
      paypalStatus: "SIM_COMPLETED",
      captureId: capId,
      message: `Reconciled simulated capture ${capId} (No funds moved).`,
    };
  }

  if (p.sim_void_id || p.sim_status === "VOIDED" || p.payment_status === "VOID_PENDING") {
    const voidId = p.sim_void_id || `DEMO-VOID-${shortToken()}`;
    await repo.claimPaymentState(task.id, [p.payment_status], "VOIDED", {
      sim_void_id: voidId,
      sim_status: "VOIDED",
      last_error: null,
    });
    if (!["ACCEPTED", "REJECTED"].includes(task.work_status)) {
      await repo.updateTaskWorkStatus(task.id, "REJECTED");
    }
    if (p.sim_authorization_id) {
      await repo.finishIdempotency(`sim-void:${p.sim_authorization_id}`, "SUCCEEDED", {
        mode: "simulation",
        workStatus: "REJECTED",
        paymentStatus: "VOIDED",
        authorizationId: p.sim_authorization_id,
        voidId,
        paypalStatus: "SIM_VOIDED",
      });
      await repo.finishIdempotency(`sim-capture:${p.sim_authorization_id}`, "FAILED");
    }
    await repo.recordPaymentEvent({
      payment_record_id: p.id,
      task_id: task.id,
      actor: "simulation",
      event_type: "sim_reconciled_void",
      safe_metadata: { demo_void_id: voidId, demo_authorization_id: p.sim_authorization_id },
    });
    await onProjectMaybeComplete(project.id);
    return {
      mode: "simulation" as const,
      paymentStatus: "VOIDED",
      paypalStatus: "SIM_VOIDED",
      authorizationId: p.sim_authorization_id,
      voidId,
      message: `Reconciled simulated void ${voidId} on ${p.sim_authorization_id} (No funds moved).`,
    };
  }

  if (p.sim_authorization_id) {
    await repo.claimPaymentState(task.id, [p.payment_status], "AUTHORIZED", {
      sim_status: "CREATED",
      last_error: null,
    });
    await repo.finishIdempotency(`sim-authorize:${p.sim_intent_id}`, "SUCCEEDED", {
      mode: "simulation",
      authorizationId: p.sim_authorization_id,
      status: "CREATED",
    });
    await repo.finishIdempotency(`sim-capture:${p.sim_authorization_id}`, "FAILED");
    await repo.finishIdempotency(`sim-void:${p.sim_authorization_id}`, "FAILED");
    await repo.recordPaymentEvent({
      payment_record_id: p.id,
      task_id: task.id,
      actor: "simulation",
      event_type: "sim_reconciled_authorization",
      safe_metadata: { sim_authorization_id: p.sim_authorization_id },
    });
    return {
      mode: "simulation" as const,
      paymentStatus: "AUTHORIZED",
      paypalStatus: "SIM_CREATED",
      authorizationId: p.sim_authorization_id,
      message: `Reconciled simulated hold ${p.sim_authorization_id} as AUTHORIZED (No money moved).`,
    };
  }

  return {
    mode: "simulation" as const,
    paymentStatus: p.payment_status,
    paypalStatus: p.sim_status || "SIM_PENDING",
    message: `Simulated intent ${p.sim_intent_id} is ${p.payment_status}; approve hold to authorize.`,
  };
}
