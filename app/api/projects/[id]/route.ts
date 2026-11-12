import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";
import { assertCanAccessProject } from "@/lib/payments/service";
import { getConfiguredPaymentMode } from "@/lib/payments/simulator";

const AddTaskSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(4).max(1000),
  acceptance_criteria: z.array(z.string().min(2).max(300)).min(1).max(10),
  amount_minor_units: z.number().int().min(100).max(1_000_000),
  contractor_notes: z.string().max(500).optional(),
});

const EditProjectSchema = z.object({
  title: z.string().min(3).max(140).optional(),
  description: z.string().max(2000).optional(),
  location: z.string().min(2).max(140).optional(),
  due_date: z.string().nullable().optional(),
  contractor_id: z.string().min(1).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await context.params;
    const project = await assertCanAccessProject(id, user);
    return Response.json({ project });
  } catch (err) {
    return responseError(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser("homeowner");
    const { id } = await context.params;
    const existing = await assertCanAccessProject(id, user);
    if (existing.homeowner_id !== user.id) {
      throw new HttpError(403, "Only the project homeowner can edit project details.");
    }
    const raw = await request.json().catch(() => null);
    const parsed = EditProjectSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid project update payload" },
        { status: 400 }
      );
    }
    const repo = getRepo();
    if (parsed.data.contractor_id) {
      const contractor = await repo.getProfileById(parsed.data.contractor_id);
      if (!contractor || contractor.role !== "contractor") {
        throw new HttpError(400, "Selected contractor profile does not exist.");
      }
    }
    const project = await repo.updateProjectDetails(id, parsed.data);
    return Response.json({ project });
  } catch (err) {
    return responseError(err);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser("homeowner");
    const { id } = await context.params;
    const project = await assertCanAccessProject(id, user);
    if (project.homeowner_id !== user.id) {
      throw new HttpError(403, "Only the project homeowner can add tasks.");
    }
    const raw = await request.json().catch(() => null);
    const parsed = AddTaskSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid task payload" },
        { status: 400 }
      );
    }
    const task = await getRepo().addTask(id, parsed.data, getConfiguredPaymentMode());
    return Response.json({ task }, { status: 201 });
  } catch (err) {
    return responseError(err);
  }
}
