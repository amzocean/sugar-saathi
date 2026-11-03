import { z } from "zod";
import { body, json, requireSession, route, sameOrigin } from "@/lib/http";
import { storage } from "@/lib/store";
import { stopVoice } from "@/lib/voice";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    sameOrigin(request);
    const session = await requireSession();
    const { id } = z.object({ id: z.uuid() }).strict().parse(await body(request));
    return json(await stopVoice(storage(), id, session.id));
  });
}
