import { requireCurrentUser } from "@/lib/auth/session";
import { responseError } from "@/lib/http";
import { authorizeOrderForTask } from "@/lib/payments/service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser("homeowner");
    const { id } = await context.params;
    const raw = (await request.json().catch(() => ({}))) as { simulateTimeout?: boolean };
    const result = await authorizeOrderForTask(id, user, undefined, {
      simulateTimeout: Boolean(raw?.simulateTimeout),
    });
    return Response.json(result);
  } catch (err) {
    return responseError(err);
  }
}
