import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";

const UpdateTaskSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  description: z.string().min(4).max(1000).optional(),
  acceptance_criteria: z.array(z.string().min(2).max(300)).min(1).max(10).optional(),
  amount_minor_units: z.number().int().min(100).max(1_000_000).optional(),
  contractor_notes: z.string().max(1000).optional(),
});

export async function GET(
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
    return Response.json({ task, project });
  } catch (err) {
    return responseError(err);
  }
}

export async function PATCH(
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
    const parsed = UpdateTaskSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid update payload" },
        { status: 400 }
      );
    }

    if (user.role === "contractor") {
      if (
        parsed.data.title !== undefined ||
        parsed.data.description !== undefined ||
        parsed.data.acceptance_criteria !== undefined ||
        parsed.data.amount_minor_units !== undefined
      ) {
        throw new HttpError(403, "Only the homeowner can edit repair terms or agreed amount.");
      }
      const existing = await repo.getTaskBundle(id);
      if (!existing) throw new HttpError(404, "Task not found");
      await repo.updateTaskWorkStatus(id, existing.work_status, {
        contractor_notes: parsed.data.contractor_notes ?? existing.contractor_notes,
      });
      const updated = await repo.getTaskBundle(id);
      return Response.json({ task: updated });
    }

    const updated = await repo.updateTask(id, parsed.data);
    return Response.json({ task: updated });
  } catch (err) {
    return responseError(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser("homeowner");
    const { id } = await context.params;
    const repo = getRepo();
    const project = await repo.getTaskProject(id);
    if (!project) throw new HttpError(404, "Task not found");
    if (project.homeowner_id !== user.id) {
      throw new HttpError(403, "Access denied");
    }
    await repo.deleteTask(id);
    return Response.json({ ok: true });
  } catch (err) {
    return responseError(err);
  }
}
