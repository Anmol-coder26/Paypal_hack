import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";
import { sanitizeImage } from "@/lib/image";
import type { EvidenceType, WorkStatus } from "@/lib/types";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser("contractor");
    const { id } = await context.params;
    const repo = getRepo();
    const project = await repo.getTaskProject(id);
    if (!project) throw new HttpError(404, "Task not found");
    if (project.contractor_id !== user.id) {
      throw new HttpError(403, "Only the assigned contractor can upload evidence.");
    }
    const task = await repo.getTaskBundle(id);
    if (!task) throw new HttpError(404, "Task not found");
    if (["CAPTURED", "VOIDED", "AUTHORIZATION_EXPIRED"].includes(task.payment_status)) {
      throw new HttpError(409, "Evidence is locked after payment settlement.");
    }
    if (["ACCEPTED", "REJECTED"].includes(task.work_status)) {
      throw new HttpError(409, "Evidence is locked after a final homeowner decision.");
    }

    const form = await request.formData();
    const stageRaw = String(form.get("stage") || "");
    if (!["before", "after", "reference"].includes(stageRaw)) {
      throw new HttpError(400, "Evidence stage must be 'before', 'after', or 'reference'.");
    }
    const stage = stageRaw as EvidenceType;
    const notes = String(form.get("notes") || "").slice(0, 500);
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "Please attach an image file.");
    }

    const hadBefore = task.evidence.some((e) => e.evidence_type === "before");
    const hadAfter = task.evidence.some((e) => e.evidence_type === "after");
    const willHaveBefore = hadBefore || stage === "before";
    const willHaveAfter = hadAfter || stage === "after";
    const nextWork: WorkStatus =
      willHaveBefore && willHaveAfter
        ? "EVIDENCE_SUBMITTED"
        : willHaveBefore
        ? "BEFORE_SUBMITTED"
        : task.work_status;

    const rawBytes = new Uint8Array(await file.arrayBuffer());
    const clean = await sanitizeImage(rawBytes, file.type || undefined);

    const saved = await repo.saveEvidence({
      task_id: task.id,
      uploaded_by: user.id,
      evidence_type: stage,
      mime_type: clean.type,
      byte_size: clean.bytes.byteLength,
      width: clean.width,
      height: clean.height,
      notes,
      bytes: clean.bytes,
      ext: clean.ext,
    });

    await repo.updateTaskWorkStatus(task.id, nextWork, {
      contractor_notes: notes ? notes : task.contractor_notes,
    });

    await repo.recordPaymentEvent({
      payment_record_id: task.payment.id,
      task_id: task.id,
      actor: "contractor",
      event_type: `evidence_${stage}_uploaded`,
      safe_metadata: {
        evidence_id: saved.id,
        mime_type: saved.mime_type,
        width: saved.width,
        height: saved.height,
      },
    });

    const refreshed = await repo.getTaskBundle(id);
    let qualityWarnings: string[] = [];
    if (refreshed) {
      const { assessEvidenceQuality } = await import("@/lib/ai/provider");
      const load = async (evType: "before" | "after") => {
        const rows = refreshed.evidence.filter((e) => e.evidence_type === evType).slice(0, 2);
        const out = [];
        for (const r of rows) {
          const loaded = await repo.readEvidenceBytes(r.image_storage_path);
          if (loaded) out.push({ record: r, bytes: loaded.bytes });
        }
        return out;
      };
      const [bImgs, aImgs] = await Promise.all([load("before"), load("after")]);
      const quality = await assessEvidenceQuality(bImgs, aImgs);
      qualityWarnings = quality.warnings;
    }

    return Response.json({ evidence: saved, workStatus: nextWork, qualityWarnings }, { status: 201 });
  } catch (err) {
    return responseError(err);
  }
}
