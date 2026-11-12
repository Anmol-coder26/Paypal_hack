import { z } from "zod";
import { clearGeminiCooldown, DEFAULT_GEMINI_MODEL, testGeminiConnection } from "@/lib/ai/gemini";
import { getLiveSystemConfigStatus, requireCurrentUser } from "@/lib/auth/session";
import { responseError } from "@/lib/http";

const TestSchema = z
  .object({
    apiKey: z.string().trim().optional(),
    model: z.string().trim().optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    await requireCurrentUser("admin");
    const raw = await request.json().catch(() => ({}));
    const parsed = TestSchema.safeParse(raw);
    const body = parsed.success && parsed.data ? parsed.data : {};

    clearGeminiCooldown();
    const result = await testGeminiConnection({
      apiKey: body.apiKey || undefined,
      model: body.model || DEFAULT_GEMINI_MODEL,
    });
    const config = await getLiveSystemConfigStatus();

    return Response.json(
      { ...result, config },
      { status: result.ok ? 200 : result.code === "daily_quota_exhausted" || result.code === "rate_limited" ? 429 : 400 }
    );
  } catch (err) {
    return responseError(err);
  }
}
