import { describe, expect, it } from "vitest";
import {
  assertPaymentTransition,
  assertWorkTransition,
  formatMinorUnits,
  mapCaptureStatusToPaymentStatus,
} from "../lib/payments/state-machine";

describe("Financial & Work State Machine", () => {
  it("allows valid PayPal authorization to capture and void paths", () => {
    expect(() => assertPaymentTransition("DRAFT", "ORDER_CREATED")).not.toThrow();
    expect(() =>
      assertPaymentTransition("BUYER_APPROVAL_PENDING", "AUTHORIZED")
    ).not.toThrow();
    expect(() => assertPaymentTransition("AUTHORIZED", "CAPTURE_PENDING")).not.toThrow();
    expect(() => assertPaymentTransition("CAPTURE_PENDING", "CAPTURED")).not.toThrow();
    expect(() => assertPaymentTransition("AUTHORIZED", "VOID_PENDING")).not.toThrow();
    expect(() => assertPaymentTransition("VOID_PENDING", "VOIDED")).not.toThrow();
  });

  it("blocks illegal transitions like CAPTURED -> VOIDED or VOIDED -> CAPTURED", () => {
    expect(() => assertPaymentTransition("CAPTURED", "VOIDED")).toThrow();
    expect(() => assertPaymentTransition("CAPTURED", "VOID_PENDING")).toThrow();
    expect(() => assertPaymentTransition("VOIDED", "CAPTURED")).toThrow();
    expect(() => assertPaymentTransition("VOIDED", "CAPTURE_PENDING")).toThrow();
    expect(() => assertPaymentTransition("DRAFT", "CAPTURED")).toThrow();
  });

  it("enforces work status transitions and minor-unit formatting", () => {
    expect(() =>
      assertWorkTransition("PENDING_EVIDENCE", "BEFORE_SUBMITTED")
    ).not.toThrow();
    expect(() =>
      assertWorkTransition("EVIDENCE_SUBMITTED", "AI_REVIEWED")
    ).not.toThrow();
    expect(() => assertWorkTransition("ACCEPTED", "REJECTED")).toThrow();
    expect(formatMinorUnits(3000)).toBe("$30.00");
    expect(formatMinorUnits(2000)).toBe("$20.00");
    expect(mapCaptureStatusToPaymentStatus("COMPLETED")).toBe("CAPTURED");
    expect(mapCaptureStatusToPaymentStatus("PENDING")).toBe("CAPTURE_PENDING");
    expect(mapCaptureStatusToPaymentStatus("DECLINED")).toBe("PAYMENT_FAILED");
  });
});
