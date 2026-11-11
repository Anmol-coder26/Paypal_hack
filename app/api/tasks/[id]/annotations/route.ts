import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";

const CreateAnnotationSchema = z.object({
  evidence_id: z.string().min(1),
  x_pct: z.number().min(0).max(100),
  y_pct: z.number().min(0).max(100),
  label: z.string().min(1).max(200),
  severity: z.enum(["info", "concern", "verified"]).default("info"),
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
    if (!project || (project.homeowner_id !== user.id && project.contractor_id !== user.id)) {
      throw new HttpError(403, "Access denied");
    }
    const raw = await request.json().catch(() => null);
    const parsed = CreateAnnotationSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid pin annotation" },
        { status: 400 }
      );
    }
    const ev = await repo.getEvidenceById(parsed.data.evidence_id);
    if (!ev || ev.task_id !== id) {
      throw new HttpError(400, "Evidence photograph does not belong to this repair task.");
    }
    const annotation = await repo.addAnnotation({
      task_id: id,
      evidence_id: parsed.data.evidence_id,
      author_id: user.id,
      author_name: user.name,
      author_role: user.role,
      x_pct: parsed.data.x_pct,
      y_pct: parsed.data.y_pct,
      label: parsed.data.label.trim(),
      severity: parsed.data.severity,
    });
    return Response.json({ annotation }, { status: 201 });
  } catch (err) {
    return responseError(err);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await context.params;
    const repo = getRepo();
    const project = await repo.getTaskProject(id);
    if (!project || (project.homeowner_id !== user.id && project.contractor_id !== user.id)) {
      throw new HttpError(403, "Access denied");
    }
    const url = new URL(request.url);
    const annotationId = url.searchParams.get("annotationId");
    if (!annotationId) {
      throw new HttpError(400, "annotationId query parameter is required");
    }
    const ann = await repo.getAnnotationById(annotationId, id);
    if (!ann) {
      throw new HttpError(404, "Pin annotation not found");
    }
    if (ann.author_id !== user.id) {
      throw new HttpError(403, "Only the author who created this annotation can remove it.");
    }
    await repo.deleteAnnotation(annotationId, id);
    return Response.json({ ok: true });
  } catch (err) {
    return responseError(err);
  }
}
