import { inspectTaskEvidence } from "@/lib/ai/provider";
import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";

export async function POST(
  _request: Request,
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
    const task = await repo.getTaskBundle(id);
    if (!task) throw new HttpError(404, "Task not found");

    const beforeRecords = task.evidence.filter((e) => e.evidence_type === "before").slice(0, 2);
    const afterRecords = task.evidence.filter((e) => e.evidence_type === "after").slice(0, 2);
    if (!beforeRecords.length || !afterRecords.length) {
      throw new HttpError(
        409,
        "Upload at least one BEFORE and one AFTER photograph before running AI inspection."
      );
    }

    const loadBytes = async (records: typeof beforeRecords) => {
      const out = [];
      for (const record of records) {
        const file = await repo.readEvidenceBytes(record.image_storage_path);
        if (!file) throw new HttpError(500, "Could not load stored evidence photo bytes");
        out.push({ record, bytes: file.bytes });
      }
      return out;
    };

    const [beforeImages, afterImages] = await Promise.all([
      loadBytes(beforeRecords),
      loadBytes(afterRecords),
    ]);

    const result = await inspectTaskEvidence({ task, beforeImages, afterImages });
    const review = await repo.saveAIReview({
      task_id: task.id,
      model: result.model,
      provider: result.provider,
      structured_findings: result.findings,
      recommendation: result.recommendation,
    });

    if (["EVIDENCE_SUBMITTED", "AI_REVIEWED", "CORRECTIONS_REQUESTED"].includes(task.work_status)) {
      await repo.updateTaskWorkStatus(task.id, "AI_REVIEWED");
    }

    await repo.recordPaymentEvent({
      payment_record_id: task.payment.id,
      task_id: task.id,
      actor: "ai",
      event_type: "ai_inspection_completed",
      safe_metadata: {
        provider: result.provider,
        model: result.model,
        version: review.review_version,
        assessment: result.findings.overall_assessment,
        recommendation: result.recommendation,
      },
    });

    return Response.json({ review });
  } catch (err) {
    return responseError(err);
  }
}
