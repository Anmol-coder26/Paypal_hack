import { z } from "zod";
import {
  authenticateDemoAccount,
  authenticateWithPassword,
  getSystemConfigStatus,
} from "@/lib/auth/session";
import { responseError } from "@/lib/http";

const LoginSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("demo"),
    role: z.enum(["homeowner", "contractor"]),
  }),
  z.object({
    mode: z.literal("password"),
    email: z.string().email(),
    password: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = LoginSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid sign-in payload" }, { status: 400 });
    }
    const user =
      parsed.data.mode === "demo"
        ? await authenticateDemoAccount(parsed.data.role)
        : await authenticateWithPassword(parsed.data.email, parsed.data.password);

    return Response.json({ user, config: getSystemConfigStatus() });
  } catch (err) {
    return responseError(err);
  }
}
