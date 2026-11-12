import { inspectTaskEvidenceWithFallback } from "@/lib/ai/provider";
import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";

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
    const task = await repo.getTaskBundle(id);
    if (!task) throw new HttpError(404, "Task not found");

    const body = (await request.json().catch(() => ({}))) as { retryLiveAI?: boolean } | null;
    const retryLiveAI = Boolean(body?.retryLiveAI);

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

    const result = await inspectTaskEvidenceWithFallback({
      task,
      beforeImages,
      afterImages,
      retryLiveAI,
    });

    if (result.outcome === "cached") {
      return Response.json({
        status: "cached",
        cached: true,
        review: result.cachedReview,
        notice: result.notice,
        qualityWarnings: result.qualityWarnings,
      });
    }

    if (result.outcome === "guided_fallback") {
      return Response.json({
        status: "guided_fallback",
        fallback: true,
        activeTier: result.activeTier,
        reasonCode: result.reasonCode,
        message: result.message,
        qualityWarnings: result.qualityWarnings,
        template: result.template,
      });
    }

    const review = await repo.saveAIReview({
      task_id: task.id,
      model: result.model,
      provider: result.provider,
      analysis_source: result.analysisSource,
      is_genuine_ai: true,
      analyzed_evidence_ids: result.evidenceIds,
      image_hashes: result.imageHashes,
      input_fingerprint: result.inputFingerprint,
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
        analysis_source: result.analysisSource,
        is_genuine_ai: true,
        version: review.review_version,
        assessment: result.findings.overall_assessment,
        recommendation: result.recommendation,
      },
    });

    return Response.json({
      status: "completed",
      review,
      fallbackNotice: result.fallbackNotice,
      qualityWarnings: result.qualityWarnings,
    });
  } catch (err) {
    return responseError(err);
  }
}
