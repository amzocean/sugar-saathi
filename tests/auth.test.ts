import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SaathiApp from "../src/components/SaathiApp";
import { authConfig, createSession, passwordMatches, SESSION_SECONDS, verifySession } from "../src/lib/auth";
import { sameOrigin, body } from "../src/lib/http";

const salt = randomBytes(16).toString("hex");
process.env.FAMILY_PASSWORD_HASH = `scrypt:${salt}:${scryptSync("synthetic-test-password", salt, 64).toString("hex")}`;
process.env.SESSION_SECRET = randomBytes(32).toString("hex");

test("family password is verified by hash, not accepted as a default", () => {
  assert.equal(passwordMatches("synthetic-test-password"), true);
  assert.equal(passwordMatches("incorrect"), false);
});

test("session tampering, expiry and credential rotation are rejected", () => {
  const now = 1_800_000_000_000;
  const { token, session } = createSession(now);
  assert.deepEqual(verifySession(token, now), session);
  assert.equal(verifySession(`${token}x`, now), null);
  assert.equal(verifySession(token, now + SESSION_SECONDS * 1000), null);
  const secret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  assert.equal(verifySession(token, now), null);
  process.env.SESSION_SECRET = secret;
  const hash = process.env.FAMILY_PASSWORD_HASH!;
  process.env.FAMILY_PASSWORD_HASH = hash.replace(/.$/, hash.endsWith("0") ? "1" : "0");
  assert.equal(verifySession(token, now), null);
  process.env.FAMILY_PASSWORD_HASH = hash;
});

test("missing authentication settings fail closed", () => {
  const secret = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  assert.throws(() => authConfig(), /not configured/);
  process.env.SESSION_SECRET = secret;
});

test("cross-origin and origin-less writes are rejected", () => {
  sameOrigin(new Request("https://saathi.example/api/record", { headers: { origin: "https://saathi.example" } }));
  sameOrigin(new Request("http://localhost:3127/api/record", { headers: { host: "127.0.0.1:3127", origin: "http://127.0.0.1:3127" } }));
  for (const origin of ["https://other.example", "null", ""]) {
    assert.throws(() => sameOrigin(new Request("https://saathi.example/api/record", { headers: { origin } })), /must come from/);
  }
});

test("request bodies are bounded and malformed JSON is not accepted", async () => {
  const request = (data: string) => new Request("https://saathi.example", { method: "POST", headers: { "content-type": "application/json" }, body: data });
  assert.deepEqual(await body(request('{"value":1}')), { value: 1 });
  await assert.rejects(body(request("invalid")), /Invalid JSON/);
  await assert.rejects(body(request(JSON.stringify("a".repeat(9000)))), /too large/);
});

test("storage setup errors do not instruct the family to reset a configured password", () => {
  const markup = renderToStaticMarkup(createElement(SaathiApp, {
    initiallyAuthenticated: false,
    configurationError: "Private storage is not configured.",
    local: false,
  }));
  assert.match(markup, /Private storage is not configured/);
  assert.match(markup, /Blob connection, then redeploy/);
  assert.doesNotMatch(markup, /Set up the family password before opening/);
});
