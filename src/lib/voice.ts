import { z } from "zod";
import type { Session } from "./auth";
import { AppError } from "./errors";
import { Conflict, type Store, update } from "./store";

export const voiceOffer = z.object({ id: z.uuid(), sdp: z.string().startsWith("v=0").max(60_000) }).strict();
type Call = { id: string; owner: string; providerId?: string; stopRequested: boolean; closed: boolean };
type Fetcher = typeof fetch;
const key = (id: string) => `voice-calls/${z.uuid().parse(id)}.json`;

export function voiceConfiguration() {
  if (process.env.VOICE_PROTOTYPE_ENABLED !== "true") {
    throw new AppError(503, "Voice is not enabled. Configure the conversation-only voice pilot to test conversation.");
  }
  if (!process.env.OPENAI_API_KEY) throw new AppError(503, "The server's OpenAI API key is not configured.");
  return { conversationOnly: true };
}

function authorization() {
  if (!process.env.OPENAI_API_KEY) throw new AppError(503, "Provider cleanup requires the server's OpenAI API key.");
  return { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
}

async function hangup(providerId: string, fetcher: Fetcher) {
  const response = await fetcher(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(providerId)}/hangup`, {
    method: "POST", headers: authorization(), cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && ![404, 410].includes(response.status)) {
    throw new AppError(502, "The microphone is stopped, but provider cleanup is not confirmed. Please retry Stop.");
  }
}

async function changeCall<T>(store: Store, id: string, owner: string, change: (call: Call) => T) {
  return update<Call | null, T>(store, key(id), () => null, call => {
    if (!call || call.owner !== owner) throw new AppError(404, "This voice call is not available to this session.");
    return change(call);
  });
}

async function closeRecord(store: Store, id: string, owner: string) {
  await changeCall(store, id, owner, call => { call.closed = true; });
}

export async function stopVoice(store: Store, id: string, owner: string, fetcher: Fetcher = fetch) {
  const call = await changeCall(store, id, owner, call => {
    call.stopRequested = true;
    return { ...call };
  });
  if (call.closed) return { closed: true };
  if (!call.providerId) return { closed: false };
  await hangup(call.providerId, fetcher);
  await closeRecord(store, id, owner);
  return { closed: true };
}

export async function startVoice(
  store: Store, session: Session, input: z.infer<typeof voiceOffer>, fetcher: Fetcher = fetch,
) {
  voiceConfiguration();
  const call: Call = { id: input.id, owner: session.id, stopRequested: false, closed: false };
  try {
    await store.write(key(call.id), call, null);
  } catch (error) {
    if (error instanceof Conflict) throw new AppError(409, "This call was already requested. Start a new conversation.");
    throw error;
  }
  const pending = (await store.read<Call>(key(call.id)))?.value;
  if (!pending || pending.stopRequested) {
    await closeRecord(store, call.id, session.id);
    throw new AppError(409, "Voice was cancelled before connecting.");
  }
  const form = new FormData();
  form.set("sdp", input.sdp);
  form.set("session", JSON.stringify({
    type: "realtime", model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini",
    instructions: "You are Sugar Saathi, a warm, concise Hindi/Gujarati voice companion. Follow the user's language. Ask one question at a time. You have NO storage tools and cannot save, retrieve, confirm, or change diary records. Clearly direct recording to the app's manual review form. Never claim a reading was saved. Do not diagnose, interpret personal glucose results, recommend treatment or medication changes, or invent clinical targets.",
    audio: { output: { voice: "marin" } }, tools: [],
  }));
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/realtime/calls", {
      method: "POST", headers: authorization(), body: form, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(502, "Voice creation could not be confirmed. There is no automatic cutoff; close the page and check provider usage before retrying.");
  }
  if (!response.ok) {
    await closeRecord(store, call.id, session.id);
    throw new AppError(502, "OpenAI could not start voice. Check API billing, key permissions and Realtime model access.");
  }
  const location = new URL(response.headers.get("Location") || "/", "https://api.openai.com");
  const providerId = location.origin === "https://api.openai.com" &&
    /^\/v1\/realtime\/calls\/([A-Za-z0-9_-]{1,200})$/.exec(location.pathname)?.[1];
  if (!providerId) throw new AppError(502, "OpenAI did not return a controllable call ID. Voice was not connected; provider cleanup is unconfirmed.");
  try {
    await changeCall(store, call.id, session.id, current => { current.providerId = providerId; });
  } catch (error) {
    await hangup(providerId, fetcher);
    throw error;
  }
  try {
    const sdp = await response.text();
    const current = (await store.read<Call>(key(call.id)))?.value;
    if (!sdp.startsWith("v=0") || !current || current.stopRequested) {
      throw new AppError(409, "Voice was cancelled or its answer was invalid. Start again.");
    }
    return { id: call.id, sdp };
  } catch (error) {
    await stopVoice(store, call.id, session.id, fetcher);
    throw error;
  }
}
