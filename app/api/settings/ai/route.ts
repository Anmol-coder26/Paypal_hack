import { z } from "zod";
import {
  assertValidGeminiModelName,
  clearGeminiCooldown,
  DEFAULT_GEMINI_MODEL,
  getGeminiPublicMetadata,
} from "@/lib/ai/gemini";
import { getLiveSystemConfigStatus, requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { responseError } from "@/lib/http";
import { encryptCredential } from "@/lib/security/secrets-vault";

const SaveAIConfigSchema = z.object({
  apiKey: z.string().trim().min(10, "Gemini API key looks too short.").max(512).optional(),
  model: z.string().trim().min(3).max(100).default(DEFAULT_GEMINI_MODEL),
});

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const [gemini, config] = await Promise.all([
      getGeminiPublicMetadata(),
      getLiveSystemConfigStatus(),
    ]);
    return Response.json({
      canManage: user.role === "admin",
      gemini,
      config,
    });
  } catch (err) {
    return responseError(err);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireCurrentUser("admin");
    const raw = await request.json().catch(() => null);
    const parsed = SaveAIConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid AI configuration payload." },
        { status: 400 }
      );
    }

    const model = assertValidGeminiModelName(parsed.data.model);
    const repo = getRepo();
    const existing = await repo.getServerCredential("gemini");

    let encryptedPayload = existing?.encrypted_payload ?? "";
    if (parsed.data.apiKey) {
      encryptedPayload = encryptCredential(parsed.data.apiKey);
    } else if (!encryptedPayload) {
      return Response.json(
        { error: "Enter a valid Gemini API key before saving." },
        { status: 400 }
      );
    }

    await repo.saveServerCredential({
      provider: "gemini",
      encrypted_payload: encryptedPayload,
      model,
      updated_by: admin.id,
    });
    clearGeminiCooldown();

    const [gemini, config] = await Promise.all([
      getGeminiPublicMetadata(),
      getLiveSystemConfigStatus(),
    ]);
    return Response.json({
      ok: true,
      message: parsed.data.apiKey
        ? `Gemini API key encrypted and saved server-side (${model}).`
        : `Updated selected Gemini vision model (${model}).`,
      gemini,
      config,
    });
  } catch (err) {
    return responseError(err);
  }
}

export async function DELETE() {
  try {
    await requireCurrentUser("admin");
    await getRepo().deleteServerCredential("gemini");
    clearGeminiCooldown();
    const [gemini, config] = await Promise.all([
      getGeminiPublicMetadata(),
      getLiveSystemConfigStatus(),
    ]);
    return Response.json({
      ok: true,
      message: gemini.configured
        ? "Removed saved credential. Environment-configured Gemini key remains active."
        : "Removed saved Gemini API credential.",
      gemini,
      config,
    });
  } catch (err) {
    return responseError(err);
  }
}
