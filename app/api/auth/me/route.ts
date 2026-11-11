import { getCurrentUser, getSystemConfigStatus } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { responseError } from "@/lib/http";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const contractors = user ? await getRepo().listProfilesByRole("contractor") : [];
    return Response.json({
      user,
      contractors,
      config: getSystemConfigStatus(),
    });
  } catch (err) {
    return responseError(err);
  }
}
