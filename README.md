# Sugar Saathi

A private, iPhone-oriented family glucose diary and voice companion prototype. This is a separate project from `husein-games`.

## Current implementation

- Shared-family password login with salted scrypt hashing, a signed 30-day HttpOnly session cookie, logout, credential-rotation invalidation and a durable eight-attempt/ten-minute login window.
- Manual glucose entry with explicit type/time/meal context, a separate review step, cancellation and confirmed-only monthly history.
- Session-bound ten-minute proposals, idempotent save receipts and conditional-write retries to avoid duplicate or lost records.
- Private Vercel Blob adapter; single-server local file adapter for development only.
- Responsive home/history UI, manifest, icon, noindex directives and an offline page that caches no health data.
- Opt-in Realtime conversation-only voice: server-owned API key and SDP exchange, private call ownership, provider Stop and retryable cleanup. No app-enforced call-duration, daily-use or concurrent-call limits in v1.
- Authenticated review/import of private family context, stored in private Blob and loaded server-side into each new voice session. Family-reported background is not a verified clinical profile or confirmed diary history.

**Not implemented yet:** reliable voice logging, trusted voice confirmation, usage/spending limits, clinician-verified profile/rules or individualized clinical advice, live diary lookup during voice, historical editing/deletion and export/restore. Basic deployed voice was confirmed by the user; personalized spoken behavior, provider-side Stop, physical-iPhone audio and live diary writes still need independent verification.

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

The browser suite covers failed/successful login, persistent login and history after reload, logout, private APIs, cancelled drafts, a committed save whose response is lost, safe retry without duplication, responsive layouts, disabled voice, Stop during delayed microphone permission, server SDP exchange, failed-Stop retry, private-context review/approval and an offline shell that caches no diary/API data. Context tests use synthetic notes, check conditional replacement and next-call freshness, and ensure imports never create journal readings or expose context in voice responses/status/public HTML. They do not prove model behavior or substitute for actual iPhone or OpenAI testing.

Validation commands are listed above. The full dependency set retains 16 moderate development-tool advisories from the last dependency check. No Workflow/timer SDK or new context dependency is required.

## Configure private storage for a later Vercel deployment

1. Connect `amzocean/sugar-saathi` to a Vercel Hobby project. This repository is public and contains code only; passwords, keys, diary records and the source PDF must remain outside Git.
2. Create and connect a **private** Vercel Blob store.
3. Configure `FAMILY_PASSWORD_HASH`, `SESSION_SECRET` and `DATA_STORAGE=blob` privately in the server environment. Use the generated hash, never the plaintext family password.
4. Let the connected store provide its OIDC/store configuration, or configure a server-only `BLOB_READ_WRITE_TOKEN`.
5. Leave voice disabled until ready for the controlled voice checks below.

The Blob SDK resolves rotating OIDC credentials from Vercel's request context as well as environment variables. A connected `BLOB_STORE_ID` is sufficient to select the adapter; the SDK still authenticates every storage request. Do not manually copy or manage `VERCEL_OIDC_TOKEN`.

The application has been deployed at https://sugar-saathi-rose.vercel.app with a private Blob connection. Login and basic voice have been confirmed; do not infer personalized voice, provider-side cleanup or diary-write verification from deployment alone.

Keep the non-OpenAI infrastructure on free tiers. Blob quotas can interrupt access when exceeded; the app must not silently upgrade or claim failed writes succeeded. No paid auth, database, monitoring, SMS or backup product is required.

## Configure the conversation-only voice pilot

In Vercel's **Production** environment, privately set `OPENAI_API_KEY`, `VOICE_PROTOTYPE_ENABLED=true` and `OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini`, then redeploy. The key must have Realtime access and API billing enabled; a ChatGPT subscription alone is not API credit. Never use a `NEXT_PUBLIC_` prefix. Use a dedicated OpenAI project and modest budget alerts.

This makes usage-based OpenAI calls. The model has no diary tools and must direct recording to the manual form. Per the v1 decision, there is no app timer, daily quota, concurrency quota or automatic spending cap. Provider-imposed session limits still apply. Microphone denial does not create a paid call.

The browser sends SDP only to the authenticated app server; no API or ephemeral key reaches it. A private Blob record binds each call to its family-login session, allowing server-side Stop without exposing credentials. Replayed creation IDs cannot start duplicate paid calls. No scheduler, background worker, Workflow or additional paid infrastructure is used.

Stop closes local tracks, playback, peer, channel and connection timers, then requests the server to hang up its owned provider call. Backgrounding/sign-out also stops voice. Failed closure displays **Retry server Stop** rather than claiming success. Unknown creation without a usable call ID cannot guarantee provider cleanup. There is no automatic cutoff or billing-finalization receipt. Use Stop when finished and check OpenAI usage if closure is unconfirmed.

First use synthetic conversation content. Verify connection, Hindi/Gujarati speech, Stop and backgrounding, and check the provider call ends before a real-data pilot. Do not treat unit/browser mocks as that live check.

For local testing, set the same variables privately in ignored `.env.local` and restart `npm run dev`.

Never paste keys into chat or put them in Git. Automated implementation tests do not make paid OpenAI calls.

## Import private voice context

1. Sign in, open **Family settings: private voice context** below the diary, and choose the private Markdown file from your device. Do not copy it into this public repository.
2. The browser extracts only `## B.` (family-reported profile) and `## C.` (food reference), including their subsections. Other top-level sections, sample dialogues, developer integration instructions and clinical protocols are excluded. Review the exact preview; malformed or oversized files are rejected.
3. Check the consent box only after family review and permission to store these notes privately and share them with OpenAI. Choose **Approve and save private context**. This confirmation is not clinical verification.
4. Stop and start voice again. Each new server-created session reads the latest approved context from `system/voice-context.json` in private Blob. An existing call retains its original context.

Only the selected sections are saved, not the original file. The authenticated status endpoint returns configuration/approval metadata, never the profile. The profile is not included in public HTML, browser bundles, offline cache or the SDP response; its review preview comes from the file chosen locally. Anyone with the shared family password can replace context, with a conditional write preventing stale overwrites. **Reload status** is required before replacing a version changed by another family member.

Without a profile, existing general voice still works. Invalid or unreadable stored context blocks new paid calls rather than silently pretending to personalize them; invalid context can be replaced through the same review flow. The notes support language, texture preferences and general food education only. Supplied nutrition figures are approximate, unverified references, not a medical meal plan. Historical numbers and typical routines in notes are not today's intake or confirmed diary entries, and importing them never writes journal records. Voice still has no live diary/history or record-write tools and cannot prescribe doses, diagnose, invent targets or interpret personal glucose results.

The actual source and health details remain outside Git. Review OpenAI's applicable data-handling/retention settings before approving real health context; no special retention agreement is configured by this feature.

## Product and safety boundaries

Read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for milestones and [AGENTS.md](AGENTS.md) for contributor guardrails.

The source is the supplied 11-page design PDF, kept outside the repository. No personal medical details or historical readings were imported. Tests use synthetic data.

This is not medical advice or a diagnostic device. No medication changes, invented glucose targets or guaranteed food outcomes. Real clinical interpretation and localized safety instructions remain gated on verification, consent and qualified review.

Provider retention, real-store behavior, physical-iPhone installation/audio, expired-proposal cleanup, exports and recovery must be verified before a real-data pilot. No enterprise security/compliance certification is claimed.
