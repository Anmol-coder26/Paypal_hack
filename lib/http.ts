import { HttpError } from "./errors";

export function responseError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === "PayPalError") {
    console.error("[punchpay-paypal]", error.message);
    return Response.json({ error: error.message }, { status: 502 });
  }
  if (error instanceof Error && error.name === "VerificationError") {
    return Response.json({ error: error.message }, { status: 422 });
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return Response.json(
      {
        error:
          "PayPal did not respond in time. Nothing was retried blindly; run Reconcile to check status.",
      },
      { status: 504 }
    );
  }
  console.error("[punchpay-unexpected]", error);
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}
