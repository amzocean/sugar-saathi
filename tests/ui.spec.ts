import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Family password").fill("synthetic-browser-only-passphrase");
  await page.getByRole("button", { name: "Open my diary" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("private login, cancelled draft, lost save response, idempotent retry, history and logout", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  expect((await request.get("/api/history?month=2020-05")).status()).toBe(401);
  const response = await page.goto("/");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  await page.getByLabel("Family password").fill("wrong-password");
  await page.getByRole("button", { name: "Open my diary" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("did not match");
  await page.getByLabel("Family password").fill("synthetic-browser-only-passphrase");
  await page.getByRole("button", { name: "Open my diary" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  const cookie = (await page.context().cookies()).find(item => item.name === "saathi_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  await page.getByLabel("History month").fill("2020-05");

  async function draft() {
    await page.getByRole("button", { name: "+ Add reading", exact: true }).click();
    await page.getByLabel("Glucose (mg/dL)").fill("126");
    await page.getByLabel("When was it measured?").fill("2020-05-02T08:30");
    await page.getByLabel("What did you eat the previous evening?").fill("Unknown");
    await page.getByRole("button", { name: "Review reading" }).click();
    await expect(page.getByRole("region", { name: "Review reading" })).toContainText("NOT SAVED YET");
    const history = await page.request.get("/api/history?month=2020-05");
    expect((await history.json()).readings).toEqual([]);
  }
  await draft();
  await page.getByRole("button", { name: "Cancel draft" }).click();
  await expect(page.getByRole("status")).toContainText("No reading was saved");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await draft();
  let lost = false;
  await page.route("**/api/proposals/*", async route => {
    if (!lost && route.request().postDataJSON()?.action === "confirm") {
      lost = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.fulfill({ status: 503, json: { error: "Save response lost. Retry to reconcile." } });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Yes, save this reading" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Save response lost");
  await expect(page.getByText("Confirmed and recorded.", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Yes, save this reading" }).click();
  await expect(page.getByRole("status")).toContainText("Saved 126 mg/dL");
  await expect(page.locator(".history li")).toHaveCount(1);
  expect((await (await page.request.get("/api/history?month=2020-05")).json()).readings).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByLabel("History month").fill("2020-05");
  await expect(page.locator(".history li")).toHaveCount(1);
  await page.screenshot({ path: "test-results/saathi-mobile.png", fullPage: true });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Family password")).toBeVisible();
  expect((await page.request.get("/api/history?month=2020-05")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test("voice stays disabled without configuration; Stop releases a delayed microphone", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Start conversation", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Voice is not enabled");
  await page.route("**/api/voice/session", route => route.fulfill({ json: { conversationOnly: true } }));
  await page.evaluate(() => {
    const state = window as unknown as { requested: boolean; released: number };
    state.requested = false; state.released = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          state.requested = true;
          return new Promise(resolve => setTimeout(() => resolve({
            getTracks: () => [{ stop: () => { state.released++; } }],
          }), 500));
        },
      },
    });
  });
  let providerCalls = 0;
  await page.route("https://api.openai.com/**", route => { providerCalls++; return route.abort(); });
  await page.getByRole("button", { name: "Start conversation", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { requested: boolean }).requested);
  await page.getByRole("button", { name: "Stop conversation", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { released: number }).released)).toBe(1);
  expect(providerCalls).toBe(0);
  await expect(page.getByRole("button", { name: "Start conversation", exact: true })).toBeVisible();
});

test("offline shell caches no diary or API data", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cached = await page.evaluate(async () => {
    const cache = await caches.open("saathi-static-v1");
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  expect(cached).toEqual(["/offline.html"]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "A little pause." })).toBeVisible();
  await expect(page.getByText("Your private history is not cached", { exact: false })).toBeVisible();
  await context.setOffline(false);
});

test("voice exchanges SDP through the server and exposes retry when provider Stop fails", async ({ page }) => {
  await login(page);
  let starts = 0;
  let stops = 0;
  let directProviderCalls = 0;
  await page.route("https://api.openai.com/**", route => { directProviderCalls++; return route.abort(); });
  await page.route("**/api/voice/session", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { conversationOnly: true } });
    const input = route.request().postDataJSON();
    expect(Object.keys(input).sort()).toEqual(["id", "sdp"]);
    starts++;
    return route.fulfill({ json: { id: input.id, sdp: "v=0\r\n" } });
  });

  await page.route("**/api/voice/stop", route => {
    stops++;
    return route.fulfill(stops === 1
      ? { status: 503, json: { error: "Provider unavailable" } }
      : { json: { closed: true } });
  });
  await page.evaluate(() => {
    const state = window as unknown as { stoppedTracks: number };
    state.stoppedTracks = 0;
    const stream = { getTracks: () => [{ stop: () => { state.stoppedTracks++; } }] };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true, value: { getUserMedia: async () => stream },
    });
    class Peer extends EventTarget {
      connectionState = "new";
      iceGatheringState = "complete";
      localDescription: { sdp: string } | null = null;
      onconnectionstatechange?: () => void;
      channel = { onopen: undefined as (() => void) | undefined, send: () => {}, close: () => {} };
      addTrack() {}
      createDataChannel() { return this.channel; }
      async createOffer() { return { type: "offer", sdp: "v=0\r\n" }; }
      async setLocalDescription(offer: { sdp: string }) { this.localDescription = offer; }
      async setRemoteDescription() {
        this.connectionState = "connected";
        this.onconnectionstatechange?.(); this.channel.onopen?.();
      }
      close() { this.connectionState = "closed"; this.onconnectionstatechange?.(); }
    }
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: Peer });
  });
  await page.getByRole("button", { name: "Start conversation", exact: true }).click();
  await expect(page.locator(".voice-card .status")).toContainText("Listening");
  await page.getByRole("button", { name: "Stop conversation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry server Stop" })).toBeVisible();
  await expect(page.locator("main [role=alert]")).toContainText("cleanup is not confirmed");
  expect(await page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Retry server Stop" }).click();
  await expect(page.getByRole("button", { name: "Start conversation", exact: true })).toBeVisible();
  expect(starts).toBe(1);
  expect(stops).toBe(2);
  expect(directProviderCalls).toBe(0);
});
