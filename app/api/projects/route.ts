import { z } from "zod";
import { getLiveSystemConfigStatus, requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { buildGuidedDemoProjectInput } from "@/lib/db/repository";
import { getConfiguredPaymentMode } from "@/lib/payments/simulator";
import { DEMO_ACCOUNTS } from "@/lib/db/sqlite";
import { HttpError } from "@/lib/errors";
import { responseError } from "@/lib/http";

const TaskSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(4).max(1000),
  acceptance_criteria: z.array(z.string().min(2).max(300)).min(1).max(10),
  amount_minor_units: z.number().int().min(100).max(1_000_000),
  contractor_notes: z.string().max(500).optional(),
});

const CreateProjectSchema = z.union([
  z.object({
    guided_demo: z.literal(true),
    contractor_id: z.string().optional(),
  }),
  z.object({
    guided_demo: z.literal(false).optional(),
    title: z.string().min(3).max(140),
    description: z.string().max(2000).default(""),
    location: z.string().min(2).max(140),
    contractor_id: z.string().min(1),
    due_date: z.string().nullable().optional(),
    tasks: z.array(TaskSchema).min(1).max(20),
  }),
]);

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const repo = getRepo();
    const [projects, events, contractors, config] = await Promise.all([
      repo.listProjectsForUser(user),
      repo.listAllEventsForUser(user),
      repo.listProfilesByRole("contractor"),
      getLiveSystemConfigStatus(),
    ]);
    return Response.json({
      user,
      projects,
      events,
      contractors,
      config,
    });
  } catch (err) {
    return responseError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser("homeowner");
    const raw = await request.json().catch(() => null);
    const parsed = CreateProjectSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid project payload" },
        { status: 400 }
      );
    }
    const repo = getRepo();
    await repo.ensureSeedProfiles();

    const activeMode = getConfiguredPaymentMode();

    if (parsed.data.guided_demo) {
      const contractorId = parsed.data.contractor_id || DEMO_ACCOUNTS.contractor.id;
      const contractor = await repo.getProfileById(contractorId);
      if (!contractor || contractor.role !== "contractor") {
        throw new HttpError(400, "Assigned contractor profile not found");
      }
      const project = await repo.createProject(
        buildGuidedDemoProjectInput({
          homeownerId: user.id,
          contractorId: contractor.id,
          paymentMode: activeMode,
        })
      );
      return Response.json({ project }, { status: 201 });
    }

    const contractor = await repo.getProfileById(parsed.data.contractor_id);
    if (!contractor || contractor.role !== "contractor") {
      throw new HttpError(400, "Selected contractor account does not exist");
    }
    const project = await repo.createProject({
      homeowner_id: user.id,
      contractor_id: contractor.id,
      title: parsed.data.title,
      description: parsed.data.description,
      location: parsed.data.location,
      due_date: parsed.data.due_date ?? null,
      is_guided_demo: false,
      payment_mode: activeMode,
      tasks: parsed.data.tasks,
    });
    return Response.json({ project }, { status: 201 });
  } catch (err) {
    return responseError(err);
  }
}
