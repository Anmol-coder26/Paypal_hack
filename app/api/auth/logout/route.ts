import { clearSessionCookie } from "@/lib/auth/session";
import { responseError } from "@/lib/http";

export async function POST() {
  try {
    await clearSessionCookie();
    return Response.json({ ok: true });
  } catch (err) {
    return responseError(err);
  }
}
