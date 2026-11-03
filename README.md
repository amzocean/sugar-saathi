# Sugar Saathi

A private, iPhone-oriented family glucose diary and voice companion prototype. This is a separate project from `husein-games`.

## Current implementation

- Shared-family password login with salted scrypt hashing, a signed 30-day HttpOnly session cookie, logout, credential-rotation invalidation and a durable eight-attempt/ten-minute login window.
- Manual glucose entry with explicit type/time/meal context, a separate review step, cancellation and confirmed-only monthly history.
- Session-bound ten-minute proposals, idempotent save receipts and conditional-write retries to avoid duplicate or lost records.
- Private Vercel Blob adapter; single-server local file adapter for development only.
- Responsive home/history UI, manifest, icon, noindex directives and an offline page that caches no health data.
- Opt-in, local-only Realtime conversation prototype with no record-writing tools. Stop releases browser audio/microphone/transport resources.

**Not implemented yet:** reliable voice logging, trusted server-side voice confirmation, server-enforced paid-session quotas/provider cleanup, clinical profile/rules, personalized food advice, historical editing/deletion, export/restore, cloud provisioning or deployment. The Blob adapter is compiled but has not been exercised against a real connected store.

The shared login intentionally grants the same access to everyone who knows the password. There are no separate caregiver roles or reliable per-person edit attribution.

## Run locally

Use Node.js 22.6 or newer supported by Next.js; this checkout was validated on Node 26.

```powershell
Set-Location C:\Users\huseinm\Downloads\sugar-saathi
npm ci
npm run setup:local
npm run dev
```

Setup asks for a password of 8 to 256 characters without echoing it, creates ignored `.env.local`, and does not print secrets. It refuses to overwrite an existing file. Local records are stored in ignored `.local-data`. No records are seeded.

Open `http://localhost:3000`. If another project uses that port:

```powershell
npm run dev -- --port 3001
```

Local file mode is intentionally rejected by production and Vercel runtimes. `npm run start` requires configured private Blob storage.

## Validate

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm run test:ui
```

Browser tests start and stop their own server on port 3127, use synthetic credentials/data, and clean their isolated test folder. On Windows they use installed Edge. Elsewhere, install Playwright Chromium with `npx playwright install chromium` before running them.

Tests cover password/session tampering, expiry/rotation, origin checks, bounded request bodies, proposal confirmation/cancellation/expiry, wrong-session access, concurrent writes, idempotent retries, timezone boundaries, meal timing, login limits and local persistence.

The browser suite covers failed/successful login, persistent login and history after reload, logout, private APIs, cancelled drafts, a committed save whose response is lost, safe retry without duplication, responsive layouts, disabled voice, Stop during delayed microphone permission and an offline shell that caches no diary/API data. It does not substitute for actual iPhone or OpenAI testing.

The final checks passed: 16 domain tests, three browser tests, lint, TypeScript and the production build. The production dependency audit reported zero vulnerabilities; the full dependency set still has moderate development-tool advisories.

## Configure private storage for a later Vercel deployment

1. Connect `amzocean/sugar-saathi` to a Vercel Hobby project. This repository is public and contains code only; passwords, keys, diary records and the source PDF must remain outside Git.
2. Create and connect a **private** Vercel Blob store.
3. Configure `FAMILY_PASSWORD_HASH`, `SESSION_SECRET` and `DATA_STORAGE=blob` privately in the server environment. Use the generated hash, never the plaintext family password.
4. Let the connected store provide its OIDC/store configuration, or configure a server-only `BLOB_READ_WRITE_TOKEN`.
5. Leave voice disabled until its production lifecycle and quota gates are implemented.

The Blob SDK resolves rotating OIDC credentials from Vercel's request context as well as environment variables. A connected `BLOB_STORE_ID` is sufficient to select the adapter; the SDK still authenticates every storage request. Do not manually copy or manage `VERCEL_OIDC_TOKEN`.

No hosting/storage resources have been created, and the application has not been deployed.

Keep the non-OpenAI infrastructure on free tiers. Blob quotas can interrupt access when exceeded; the app must not silently upgrade or claim failed writes succeeded. No paid auth, database, monitoring, SMS or backup product is required.

## Optional local voice feasibility

In ignored `.env.local`, set `VOICE_PROTOTYPE_ENABLED=true`, privately provide `OPENAI_API_KEY`, and choose `OPENAI_REALTIME_MODEL` (initial candidate: `gpt-realtime-2.1-mini`). Restart the development server.

This makes usage-based OpenAI calls. It is not voice logging: the model has no write tools and must direct recording to the manual form. Connections time out after 30 seconds; connected prototypes stop locally after three minutes. This is not a server-enforced spending cap or proof of provider billing termination. Production voice creation remains disabled.

Never paste keys into chat or put them in Git. No live OpenAI test was performed during this implementation.

## Product and safety boundaries

Read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for milestones and [AGENTS.md](AGENTS.md) for contributor guardrails.

The source is the supplied 11-page design PDF, kept outside the repository. No personal medical details or historical readings were imported. Tests use synthetic data.

This is not medical advice or a diagnostic device. No medication changes, invented glucose targets or guaranteed food outcomes. Real clinical interpretation and localized safety instructions remain gated on verification, consent and qualified review.

Provider retention, real-store behavior, physical-iPhone installation/audio, expired-proposal cleanup, exports and recovery must be verified before a real-data pilot. No enterprise security/compliance certification is claimed.
