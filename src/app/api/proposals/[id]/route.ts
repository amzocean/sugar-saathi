import { z } from "zod";
import { finish } from "@/lib/records";
import { body, json, requireSession, route, sameOrigin } from "@/lib/http";
import { storage } from "@/lib/store";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => {
    sameOrigin(request);
    const session = await requireSession();
    const { action } = z.object({ action: z.enum(["confirm", "cancel"]) }).strict().parse(await body(request));
    const { id } = await context.params;
    const proposal = await finish(storage(), session, id, action);
    return json({ proposal });
  });
}
