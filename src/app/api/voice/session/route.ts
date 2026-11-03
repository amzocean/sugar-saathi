import { body, json, requireSession, route, sameOrigin } from "@/lib/http";
import { storage } from "@/lib/store";
import { startVoice, voiceConfiguration, voiceOffer } from "@/lib/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return route(async () => {
    await requireSession();
    return json(voiceConfiguration());
  });
}

export async function POST(request: Request) {
  return route(async () => {
    sameOrigin(request);
    const session = await requireSession();
    const offer = voiceOffer.parse(await body(request, 65_536));
    return json(await startVoice(storage(), session, offer));
  });
}
