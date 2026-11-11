import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth/session";
import { responseError } from "@/lib/http";
import { executeHomeownerDecision } from "@/lib/payments/service";

const DecisionSchema = z.object({
  decision: z.enum(["accept", "reject", "request_corrections", "request_evidence"]),
  reason: z.string().max(1000).default(""),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser("homeowner");
    const { id } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = DecisionSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid decision payload" },
        { status: 400 }
      );
    }
    const result = await executeHomeownerDecision(id, user, parsed.data);
    return Response.json(result);
  } catch (err) {
    return responseError(err);
  }
}
