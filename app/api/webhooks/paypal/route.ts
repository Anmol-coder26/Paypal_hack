import { responseError } from "@/lib/http";
import { processPayPalWebhook } from "@/lib/payments/service";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const result = await processPayPalWebhook(request.headers, rawBody);
    return Response.json(result);
  } catch (err) {
    return responseError(err);
  }
}
