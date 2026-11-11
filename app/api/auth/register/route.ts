import { z } from "zod";
import { getSystemConfigStatus, registerUserAccount } from "@/lib/auth/session";
import { responseError } from "@/lib/http";

const RegisterSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["homeowner", "contractor"]),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = RegisterSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid registration details" },
        { status: 400 }
      );
    }
    const user = await registerUserAccount(parsed.data);
    return Response.json({ user, config: getSystemConfigStatus() }, { status: 201 });
  } catch (err) {
    return responseError(err);
  }
}
