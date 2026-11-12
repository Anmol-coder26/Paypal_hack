import { getLiveSystemConfigStatus } from "@/lib/auth/session";
import { getRepo } from "@/lib/db";

export async function GET() {
  const repo = getRepo();
  await repo.ensureSeedProfiles();
  return Response.json({
    ok: true,
    config: await getLiveSystemConfigStatus(),
  });
}
