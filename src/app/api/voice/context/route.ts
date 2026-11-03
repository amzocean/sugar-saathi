import { body, json, requireSession, route, sameOrigin } from "@/lib/http";
import { contextStatus, saveContext } from "@/lib/private-context";
import { storage } from "@/lib/store";

export const runtime = "nodejs";
export async function GET() {
  return route(async () => {
    await requireSession();
    return json(await contextStatus(storage()));
  });
}
export async function POST(request: Request) {
  return route(async () => {
    sameOrigin(request);
    await requireSession();
    return json(await saveContext(storage(), await body(request, 150_000)));
  });
}
