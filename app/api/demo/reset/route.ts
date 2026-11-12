import { requireCurrentUser } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";
import { DEMO_ACCOUNTS } from "@/lib/db/sqlite";
import { responseError } from "@/lib/http";
import { getConfiguredPaymentMode } from "@/lib/payments/simulator";

export async function POST() {
  try {
    const user = await requireCurrentUser("homeowner");
    const repo = getRepo();
    await repo.ensureSeedProfiles();
    const project = await repo.resetGuidedDemo(
      user.id,
      DEMO_ACCOUNTS.contractor.id,
      getConfiguredPaymentMode()
    );
    return Response.json({
      project,
      message:
        "Guided demonstration project reset cleanly. Unrelated projects and records were left untouched.",
    });
  } catch (err) {
    return responseError(err);
  }
}
