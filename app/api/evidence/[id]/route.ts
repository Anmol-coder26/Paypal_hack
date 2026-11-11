import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await context.params;
    const repo = getRepo();
    const ev = await repo.getEvidenceById(id);
    if (!ev) throw new HttpError(404, "Evidence not found");
    const project = await repo.getTaskProject(ev.task_id);
    if (!project || (project.homeowner_id !== user.id && project.contractor_id !== user.id)) {
      throw new HttpError(403, "Access denied to private evidence photo");
    }
    const file = await repo.readEvidenceBytes(ev.image_storage_path);
    if (!file) throw new HttpError(404, "Stored image file not found");
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return responseError(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser("contractor");
    const { id } = await context.params;
    const repo = getRepo();
    const ev = await repo.getEvidenceById(id);
    if (!ev) throw new HttpError(404, "Evidence not found");
    const project = await repo.getTaskProject(ev.task_id);
    if (!project || project.contractor_id !== user.id) {
      throw new HttpError(403, "Only the assigned contractor can remove evidence");
    }
    const task = await repo.getTaskBundle(ev.task_id);
    if (task && ["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(task.payment_status)) {
      throw new HttpError(409, "Evidence cannot be deleted after payment settlement");
    }
    if (task && ["ACCEPTED", "REJECTED"].includes(task.work_status)) {
      throw new HttpError(409, "Evidence cannot be deleted after a final homeowner decision");
    }
    await repo.deleteEvidence(id);
    if (task && ["PENDING_EVIDENCE", "BEFORE_SUBMITTED", "EVIDENCE_SUBMITTED"].includes(task.work_status)) {
      const remaining = task.evidence.filter((e) => e.id !== id);
      const hasBefore = remaining.some((e) => e.evidence_type === "before");
      const hasAfter = remaining.some((e) => e.evidence_type === "after");
      const nextWork =
        hasBefore && hasAfter
          ? "EVIDENCE_SUBMITTED"
          : hasBefore
          ? "BEFORE_SUBMITTED"
          : "PENDING_EVIDENCE";
      if (nextWork !== task.work_status) {
        await repo.updateTaskWorkStatus(task.id, nextWork);
      }
    }
    return Response.json({ ok: true });
  } catch (err) {
    return responseError(err);
  }
}
