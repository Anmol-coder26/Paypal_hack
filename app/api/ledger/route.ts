import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { responseError } from "@/lib/http";
import { formatMinorUnits } from "@/lib/payments/state-machine";

function csvCell(val: unknown): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    const repo = getRepo();
    const entries = await repo.listLedgerForUser(user);
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "csv") {
      const header = [
        "Date",
        "Project",
        "Task",
        "Amount (USD)",
        "Payment Status",
        "PayPal Status",
        "PayPal Order ID",
        "PayPal Authorization ID",
        "PayPal Capture ID",
        "Payee Merchant ID",
        "Work Status",
      ];
      const rows = entries.map((e) => [
        e.payment.updated_at,
        e.project.title,
        e.task.title,
        formatMinorUnits(e.payment.amount_minor_units, e.payment.currency),
        e.payment.payment_status,
        e.payment.paypal_status || "",
        e.payment.paypal_order_id || "",
        e.payment.paypal_authorization_id || "",
        e.payment.paypal_capture_id || "",
        e.payment.payee_merchant_id || "",
        e.task.work_status,
      ]);
      const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="punchpay-settlement-ledger.csv"',
        },
      });
    }

    const events = await repo.listAllEventsForUser(user);
    return Response.json({ entries, events });
  } catch (err) {
    return responseError(err);
  }
}
