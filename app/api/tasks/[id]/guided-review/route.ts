import { z } from "zod";
import { buildGuidedChecklistFindings } from "@/lib/ai/knowledge";
import { assessEvidenceQuality } from "@/lib/ai/provider";
import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";

const GuidedReviewSchema = z.object({
  criteriaResponses: z
    .array(
      z.object({
        criterion: z.string().min(1),
        status: z.enum(["satisfied", "unmet", "unverifiable"]),
        note: z.string().max(400).optional(),
      })
    )
    .min(1),
  needsCloserPhoto: z.boolean().optional(),
  reviewerNotes: z.string().max(600).optional(),
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
    const parsed = GuidedReviewSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid guided checklist submission." },
        { status: 400 }
      );
    }

    const task = await repo.getTaskBundle(id);
    if (!task) throw new HttpError(404, "Task not found");

    const beforeRecords = task.evidence.filter((e) => e.evidence_type === "before").slice(0, 2);
    const afterRecords = task.evidence.filter((e) => e.evidence_type === "after").slice(0, 2);
    const loadBytes = async (records: typeof beforeRecords) => {
      const out = [];
      for (const record of records) {
        const file = await repo.readEvidenceBytes(record.image_storage_path);
        if (file) out.push({ record, bytes: file.bytes });
      }
      return out;
    };
    const [beforeImages, afterImages] = await Promise.all([
      loadBytes(beforeRecords),
      loadBytes(afterRecords),
    ]);
    const quality = await assessEvidenceQuality(beforeImages, afterImages);

    const findings = buildGuidedChecklistFindings({
      task,
      criteriaResponses: parsed.data.criteriaResponses,
      needsCloserPhoto: parsed.data.needsCloserPhoto,
      reviewerNotes: parsed.data.reviewerNotes,
      qualityWarnings: quality.warnings,
      evidenceIds: quality.evidenceIds,
      imageHashes: quality.allHashes,
    });

    const review = await repo.saveAIReview({
      task_id: task.id,
      model: "guided-checklist-v1",
      provider: "guided",
      analysis_source: "guided_checklist",
      is_genuine_ai: false,
      analyzed_evidence_ids: quality.evidenceIds,
      image_hashes: quality.allHashes,
      input_fingerprint: null,
      structured_findings: findings,
      recommendation: findings.suggested_outcome,
    });

    if (["EVIDENCE_SUBMITTED", "AI_REVIEWED", "CORRECTIONS_REQUESTED"].includes(task.work_status)) {
      await repo.updateTaskWorkStatus(task.id, "AI_REVIEWED");
    }

    await repo.recordPaymentEvent({
      payment_record_id: task.payment.id,
      task_id: task.id,
      actor: user.role === "contractor" ? "contractor" : "homeowner",
      event_type: "guided_checklist_recorded",
      safe_metadata: {
        provider: "guided",
        is_genuine_ai: false,
        version: review.review_version,
        assessment: findings.overall_assessment,
        recommendation: review.recommendation,
      },
    });

    return Response.json({ review });
  } catch (err) {
    return responseError(err);
  }
}
