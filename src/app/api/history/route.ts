import { history } from "@/lib/records";
import { json, requireSession, route } from "@/lib/http";
import { storage } from "@/lib/store";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return route(async () => {
    await requireSession();
    const month = new URL(request.url).searchParams.get("month") ?? "";
    return json({ readings: await history(storage(), month) });
  });
}
