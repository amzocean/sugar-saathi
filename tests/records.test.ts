import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { draftSchema, finish, history, propose, reserveLoginAttempt } from "../src/lib/records";
import { BlobStore, Conflict, LocalStore, type Snapshot, type Store, storage, update } from "../src/lib/store";

class MemoryStore implements Store {
  items = new Map<string, Snapshot<unknown>>();
  async read<T>(key: string) { return structuredClone(this.items.get(key) as Snapshot<T> ?? null); }
  async write<T>(key: string, value: T, expected: string | null) {
    const previous = this.items.get(key);
    if ((previous?.version ?? null) !== expected) throw new Conflict();
    this.items.set(key, { value: structuredClone(value), version: String(Number(previous?.version ?? 0) + 1) });
  }
}
const session = { id: "test-family-session", expiresAt: Date.now() + 10_000_000 };
const draft = {
  valueMgDl: 126, type: "fasting", measuredAt: "2020-05-02T03:00:00Z",
  timezone: "Asia/Kolkata", meal: "Unknown", mealStartedAt: null,
};

test("a draft stays out of history until confirmed, with an idempotent receipt", async () => {
  const store = new MemoryStore();
  const pending = await propose(store, session, draft);
  assert.deepEqual(await history(store, "2020-05"), []);
  const saved = await finish(store, session, pending.id, "confirm");
  assert.equal(saved.reading?.valueMgDl, 126);
  assert.deepEqual(await finish(store, session, pending.id, "confirm"), saved);
  assert.equal((await history(store, "2020-05")).length, 1);
});

test("cancelled, expired, wrong-session and invalid proposal IDs cannot save", async () => {
  const store = new MemoryStore();
  const cancelled = await propose(store, session, draft);
  await finish(store, session, cancelled.id, "cancel");
  await assert.rejects(finish(store, session, cancelled.id, "confirm"), /cancelled or expired/);
  const expiring = await propose(store, session, draft);
  await assert.rejects(finish(store, session, expiring.id, "confirm", expiring.expiresAt), /expired/);
  await assert.rejects(finish(store, { ...session, id: "other-session" }, expiring.id, "confirm"), /not available/);
  await assert.rejects(finish(store, session, "../../file", "confirm"), /Invalid proposal/);
  assert.deepEqual(await history(store, "2020-05"), []);
});

test("concurrent draft creation and repeated confirmations preserve all records", async () => {
  const store = new MemoryStore();
  const proposals = await Promise.all([126, 128, 132, 136].map(valueMgDl => propose(store, session, { ...draft, valueMgDl })));
  await Promise.all(proposals.map(item => finish(store, session, item.id, "confirm")));
  await Promise.all(Array.from({ length: 4 }, () => finish(store, session, proposals[0].id, "confirm")));
  assert.deepEqual((await history(store, "2020-05")).map(item => item.valueMgDl).sort(), [126, 128, 132, 136]);
});

test("measurement-month uses capture timezone rather than UTC month", async () => {
  const store = new MemoryStore();
  const proposal = await propose(store, session, { ...draft, measuredAt: "2020-04-30T22:00:00Z" });
  assert.match(proposal.id, /^2020-05:/);
  await finish(store, session, proposal.id, "confirm");
  assert.equal((await history(store, "2020-05")).length, 1);
  assert.equal((await history(store, "2020-04")).length, 0);
});

test("post-meal timing is computed from verified timestamps and invalid input is rejected", async () => {
  const store = new MemoryStore();
  const proposal = await propose(store, session, {
    ...draft, type: "post-meal", mealStartedAt: "2020-05-02T01:15:00Z",
  });
  assert.equal((await finish(store, session, proposal.id, "confirm")).reading?.elapsedMinutes, 105);
  for (const patch of [
    { type: "post-meal" }, { valueMgDl: -1 }, { valueMgDl: "126" }, { type: "unknown" },
    { timezone: "not-a-zone" }, { meal: "" }, { measuredAt: "2099-01-01T00:00:00Z" },
    { type: "post-meal", mealStartedAt: "2020-05-03T00:00:00Z" },
  ]) assert.equal(draftSchema.safeParse({ ...draft, ...patch }).success, false);
});

test("durable login window caps attempts and resets after the window", async () => {
  const store = new MemoryStore();
  const now = 100_000;
  for (let count = 0; count < 8; count++) await reserveLoginAttempt(store, now);
  await assert.rejects(reserveLoginAttempt(store, now), /Too many login attempts/);
  await reserveLoginAttempt(store, now + 600_000);
});

test("storage write failures and exhausted conflicts never return a saved receipt", async () => {
  const failing: Store = { read: async () => null, write: async () => { throw new Error("storage offline"); } };
  await assert.rejects(propose(failing, session, draft), /storage offline/);
  const racing: Store = { read: async () => null, write: async () => { throw new Conflict(); } };
  await assert.rejects(update(racing, "ignored", () => ({}), () => "not a receipt"), /same time/);
});

test("local adapter persists receipts, enforces versions and rejects path traversal", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "saathi-test-"));
  try {
    const store = new LocalStore(directory);
    const pending = await propose(store, session, draft);
    await finish(store, session, pending.id, "confirm");
    const reopened = new LocalStore(directory);
    assert.equal((await history(reopened, "2020-05")).length, 1);
    await assert.rejects(reopened.write("journals/2020-05.json", {}, null), Conflict);
    await assert.rejects(reopened.read("../credentials"), /Invalid storage key/);
  } finally { await rm(directory, { recursive: true }); }
});

test("local data mode is never accepted on Vercel", () => {
  const original = { mode: process.env.DATA_STORAGE, vercel: process.env.VERCEL };
  process.env.DATA_STORAGE = "local"; process.env.VERCEL = "1";
  try { assert.throws(() => storage(), /development-only/); }
  finally {
    if (original.mode === undefined) delete process.env.DATA_STORAGE; else process.env.DATA_STORAGE = original.mode;
    if (original.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = original.vercel;
  }
});

test("Blob selection accepts request-context authentication but rejects missing connections", () => {
  const keys = ["DATA_STORAGE", "BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "VERCEL_OIDC_TOKEN"] as const;
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.DATA_STORAGE = "blob";
    process.env.BLOB_STORE_ID = "store_synthetic";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    assert.ok(storage() instanceof BlobStore);

    delete process.env.BLOB_STORE_ID;
    process.env.VERCEL_OIDC_TOKEN = "synthetic-token-without-store";
    assert.throws(() => storage(), /Private storage is not configured/);

    delete process.env.VERCEL_OIDC_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "synthetic-static-credential";
    assert.ok(storage() instanceof BlobStore);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    }
  }
});
