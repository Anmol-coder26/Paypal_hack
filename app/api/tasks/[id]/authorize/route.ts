import { requireCurrentUser } from "@/lib/auth/session";
import { responseError } from "@/lib/http";
import { authorizeOrderForTask } from "@/lib/payments/service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser("homeowner");
    const { id } = await context.params;
    const result = await authorizeOrderForTask(id, user);
    return Response.json(result);
  } catch (err) {
    return responseError(err);
  }
}
