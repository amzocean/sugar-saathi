import { AppError } from "@/lib/errors";
import { json, requireSession, route, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    sameOrigin(request);
    await requireSession();
    if (process.env.VOICE_PROTOTYPE_ENABLED !== "true" || !process.env.OPENAI_API_KEY) {
      throw new AppError(503, "Voice is not enabled. This first version supports manual, confirmed recording. Configure the opt-in voice prototype to test conversation.");
    }
    // A prototype must not accidentally spend on a deployed endpoint before server quotas are implemented.
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new AppError(503, "Paid voice sessions are local-prototype only until server usage limits and provider cleanup are verified.");
    }
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 60 },
        session: {
          type: "realtime", model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini",
          instructions: "You are Sugar Saathi, a warm Hindi/Gujarati voice connectivity prototype. Follow the user's language. Use one or two short sentences and ask one question at a time. You have NO storage tools and cannot save, retrieve, confirm, or change records. Say clearly that readings must be entered and reviewed using the app's manual form. Do not claim a reading was saved. Do not diagnose, interpret personal glucose results, recommend treatment or medication changes, or invent clinical targets. This session tests conversation only.",
          audio: { output: { voice: "marin" } },
          tools: [],
        },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) throw new AppError(502, "The voice provider could not start a session. Check model access and configuration.");
    const result = await response.json() as { value?: string };
    if (!result.value) throw new AppError(502, "The voice provider returned an unexpected response");
    return json({ clientSecret: result.value });
  });
}
