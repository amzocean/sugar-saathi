import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Conflict, type Store, type Snapshot } from "../src/lib/store";
import { startVoice, stopVoice, voiceOffer } from "../src/lib/voice";

class MemoryStore implements Store {
  items = new Map<string, Snapshot<unknown>>();
  async read<T>(key: string) { return structuredClone(this.items.get(key) as Snapshot<T> ?? null); }
  async write<T>(key: string, value: T, expected: string | null) {
    const previous = this.items.get(key);
    if ((previous?.version ?? null) !== expected) throw new Conflict();
    this.items.set(key, { value: structuredClone(value), version: String(Number(previous?.version ?? 0) + 1) });
  }
}
const keys = ["VOICE_PROTOTYPE_ENABLED", "OPENAI_API_KEY", "VERCEL", "NODE_ENV"] as const;
const environment: Record<string, string | undefined> = process.env;
const original = Object.fromEntries(keys.map(key => [key, environment[key]]));
environment.VOICE_PROTOTYPE_ENABLED = "true";
environment.OPENAI_API_KEY = "synthetic-test-key";
environment.VERCEL = "1";
environment.NODE_ENV = "production";
after(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete environment[key]; else environment[key] = original[key];
  }
});
const session = { id: "synthetic-family-session", expiresAt: Date.now() + 86_400_000 };
const offer = () => ({ id: randomUUID(), sdp: "v=0\r\n" });
const answer = (id = "rtc_synthetic") => new Response("v=0\r\n", {
  headers: { Location: `https://api.openai.com/v1/realtime/calls/${id}` },
});
function provider() {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.method, "POST");
    return String(url).endsWith("/hangup") ? new Response(null) : answer(`rtc_synthetic_${calls.length}`);
  };
  return { calls, fetcher };
}

test("deployed voice uses server SDP exchange without exposing API keys or diary tools", async () => {
  const result = await startVoice(new MemoryStore(), session, offer(), async (_url, options) => {
    const config = JSON.parse(String((options?.body as FormData).get("session")));
    assert.deepEqual(config.tools, []);
    assert.match(config.instructions, /NO storage tools/);
    return answer();
  });
  assert.ok(!JSON.stringify(result).includes("synthetic-test-key"));
  assert.ok(!("clientSecret" in result));
  assert.ok(!("deadline" in result));
});

test("v1 has no daily or concurrent-call caps, but repeated requests cannot create duplicate calls", async () => {
  const store = new MemoryStore();
  const p = provider();
  const inputs = Array.from({ length: 8 }, offer);
  await Promise.all(inputs.map(input => startVoice(store, session, input, p.fetcher)));
  assert.equal(p.calls.length, 8);
  await assert.rejects(startVoice(store, session, inputs[0], p.fetcher), /already requested/);
  assert.equal(p.calls.length, 8);
});

test("Stop is owner-bound and idempotent and cannot stop a different call", async () => {
  const store = new MemoryStore();
  const p = provider();
  const first = await startVoice(store, session, offer(), p.fetcher);
  await assert.rejects(stopVoice(store, first.id, "different-session", p.fetcher), /not available/);
  assert.deepEqual(await stopVoice(store, first.id, session.id, p.fetcher), { closed: true });
  await stopVoice(store, first.id, session.id, p.fetcher);
  const second = await startVoice(store, session, offer(), p.fetcher);
  await stopVoice(store, first.id, session.id, p.fetcher);
  assert.equal(p.calls.filter(url => url.endsWith("/hangup")).length, 1);
  await stopVoice(store, second.id, session.id, p.fetcher);
  assert.equal(p.calls.filter(url => url.endsWith("/hangup")).length, 2);
});

test("disabled voice cannot reserve or start a provider call", async () => {
  const store = new MemoryStore();
  const p = provider();
  process.env.VOICE_PROTOTYPE_ENABLED = "false";
  try { await assert.rejects(startVoice(store, session, offer(), p.fetcher), /not enabled/); }
  finally { process.env.VOICE_PROTOTYPE_ENABLED = "true"; }
  assert.equal(store.items.size, 0);
  assert.equal(p.calls.length, 0);
});

test("unknown creation and failed hangup never claim confirmed provider cleanup", async () => {
  const store = new MemoryStore();
  const input = offer();
  await assert.rejects(startVoice(store, session, input, async () => { throw new Error("response lost"); }), /could not be confirmed/);
  assert.deepEqual(await stopVoice(store, input.id, session.id), { closed: false });
  const p = provider();
  const connected = await startVoice(store, session, offer(), p.fetcher);
  await assert.rejects(stopVoice(store, connected.id, session.id, async () => new Response(null, { status: 503 })), /cleanup is not confirmed/);
  assert.deepEqual(await stopVoice(store, connected.id, session.id, p.fetcher), { closed: true });
});

test("Stop during creation hangs up a late accepted provider call", async () => {
  const store = new MemoryStore();
  const input = offer();
  let created!: () => void;
  const ready = new Promise<void>(resolve => { created = resolve; });
  let respond!: (value: Response) => void;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  let hangups = 0;
  const pending = startVoice(store, session, input, async url => {
    if (String(url).endsWith("/hangup")) { hangups++; return new Response(null); }
    created(); return response;
  });
  const rejected = assert.rejects(pending, /cancelled/);
  await ready;
  assert.deepEqual(await stopVoice(store, input.id, session.id), { closed: false });
  respond(answer());
  await rejected;
  assert.equal(hangups, 1);
});

test("provider rejection and missing call IDs never produce a connected response", async () => {
  const store = new MemoryStore();
  const rejected = offer();
  await assert.rejects(startVoice(store, session, rejected, async () => new Response(null, { status: 401 })), /billing/);
  assert.deepEqual(await stopVoice(store, rejected.id, session.id), { closed: true });
  await assert.rejects(startVoice(store, session, offer(), async () => new Response("v=0\r\n")), /controllable call ID/);
  assert.equal(voiceOffer.safeParse({ id: "../other", sdp: "not-sdp" }).success, false);
});

test("local private storage persists voice ownership for a later Stop request", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { LocalStore } = await import("../src/lib/store");
  const directory = await mkdtemp(join(tmpdir(), "saathi-voice-test-"));
  const p = provider();
  try {
    const call = await startVoice(new LocalStore(directory), session, offer(), p.fetcher);
    assert.deepEqual(await stopVoice(new LocalStore(directory), call.id, session.id, p.fetcher), { closed: true });
  } finally { await rm(directory, { recursive: true }); }
});
