import { propose } from "@/lib/records";
import { body, json, requireSession, route, sameOrigin } from "@/lib/http";
import { storage } from "@/lib/store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    sameOrigin(request);
    const session = await requireSession();
    const proposal = await propose(storage(), session, await body(request));
    return json({ proposal }, 201);
  });
}
