import { z } from "zod";
import { generateScopeSuggestions } from "@/lib/ai/provider";
import { requireCurrentUser } from "@/lib/auth/session";
import { responseError } from "@/lib/http";

const ScopeSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(3).max(1000),
});

export async function POST(request: Request) {
  try {
    await requireCurrentUser("homeowner");
    const raw = await request.json().catch(() => null);
    const parsed = ScopeSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: "Provide a task title and description to generate criteria suggestions." },
        { status: 400 }
      );
    }
    const suggestion = await generateScopeSuggestions(parsed.data);
    return Response.json({ suggestion });
  } catch (err) {
    return responseError(err);
  }
}
