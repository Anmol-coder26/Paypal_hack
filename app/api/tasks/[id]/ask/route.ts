import { z } from "zod";
import { answerInspectionQuestion } from "@/lib/ai/provider";
import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";

const AskSchema = z.object({
  question: z.string().min(2).max(400),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await context.params;
    const repo = getRepo();
    const project = await repo.getTaskProject(id);
    if (!project) throw new HttpError(404, "Task not found");
    if (project.homeowner_id !== user.id && project.contractor_id !== user.id) {
      throw new HttpError(403, "Access denied");
    }

    const raw = await request.json().catch(() => null);
    const parsed = AskSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Enter a question (2-400 characters)." },
        { status: 400 }
      );
    }

    const task = await repo.getTaskBundle(id);
    if (!task) throw new HttpError(404, "Task not found");

    const imageRecords = [
      ...task.evidence.filter((e) => e.evidence_type === "before").slice(0, 1),
      ...task.evidence.filter((e) => e.evidence_type === "after").slice(0, 1),
    ];
    const images = [];
    for (const record of imageRecords) {
      const loaded = await repo.readEvidenceBytes(record.image_storage_path);
      if (loaded) images.push({ record, bytes: loaded.bytes });
    }

    const reply = await answerInspectionQuestion({
      task,
      question: parsed.data.question,
      images,
    });
    return Response.json(reply);
  } catch (err) {
    return responseError(err);
  }
}
