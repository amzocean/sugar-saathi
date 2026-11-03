# Sugar Saathi implementation plan

Updated 2026-11-02 after reviewing the supplied 11-page design and approving a simpler family-access architecture.

## Implementation status

The foundation, manual confirmed-record flow and production login are implemented. Conversation-only deployed voice now has server-owned SDP exchange, private call ownership and provider Stop. The user explicitly chose no app-enforced usage limits or timer in v1; quotas and spending controls are deferred. Real voice, live diary writes, physical-iPhone testing, reliable voice logging and clinical guidance still require verification. See README for actual commands and configuration.

## 1. Approved decisions

| Area | Decision |
| --- | --- |
| Product | iPhone-installable, voice-first Hindi/Gujarati glucose diary and food-question companion |
| Code/deployment | Public code-only GitHub repository `amzocean/sugar-saathi`; Vercel deployment has not been provisioned yet |
| Web | Next.js App Router, TypeScript, mobile-first UI |
| Hosting/data budget | Vercel Hobby and private Vercel Blob; no paid infrastructure without approval |
| AI | OpenAI Realtime is the one approved usage-based cost |
| Login | One family password verified server-side; signed, expiring HttpOnly cookie; persistent login, logout and failed-attempt throttling |
| Authorization tradeoff | Everyone with the family password has the same access; no separate caregiver roles or individual edit attribution |
| Privacy | Basic authenticated access, HTTPS, private storage, server-only secrets and no indexing; no enterprise compliance/security add-ons |
| Database | No Firebase or Supabase. Private JSON journals with conditional writes and explicit conflict handling |
| Development | Local ignored data files for a single local server; never use the deployment filesystem as durable storage |

This supersedes the PDF's Firebase recommendation and separate-identity permission model. Simpler access does not relax numeric accuracy, confirmation, truthful save receipts, or clinical boundaries.

The user-selected repository is public. Only application code and synthetic tests belong there; credentials, diary data and the source PDF remain excluded.

## 2. Scope and first working slice

First slice:

- Accessible login and configuration guidance; no default/development login bypass.
- Home screen with Start/Stop, visible connection state, and optional captions.
- Manual fallback: capture value, unit, category, measurement time and relevant meal context; review the exact draft; explicitly save or cancel.
- Confirmed-only history by measurement month, with no synthetic records automatically seeded.
- Authenticated server-side Realtime SDP exchange and a conversation-only voice pilot.
- Manifest/icons, static-only offline shell and install instructions.
- Focused domain/auth/storage tests, lint, typecheck, production build and browser validation.

Subsequent slices:

- Trusted server-side voice proposal/confirmation integration and server-enforced paid-session quotas/cleanup.
- Voice-created confirmed reading/meal records, exact historical lookup, corrections and deletion/restore.
- Verified profile, clinician-approved rules/action scripts, comparable-category trends and reviewed food guidance.
- Export/restore/purge policy and physical-iPhone pilot.

Do not claim voice logging, medical interpretation, account recovery, provider shutdown guarantees or deployment until those parts are implemented and tested.

## 3. Architecture and authentication

```text
iPhone PWA -> Next.js server routes -> private Vercel Blob
     |               |
     |               +-> verify family session, origin, inputs and limits
     |
     +-- WebRTC audio -> OpenAI Realtime (conversation only; no record-write tools)
                     +-> authenticated Stop -> provider hangup
```

Store a salted scrypt password hash and a separate strong session signing secret in server environment settings, not Git or the browser. A local setup tool creates `.env.local` without printing secrets. Session cookies are HttpOnly, SameSite=Lax, Secure on HTTPS, and expire. Logout removes the cookie. Password/secret rotation invalidates old sessions. Session duration and login limits are documented implementation defaults, not paid services.

Check same-origin requests for every authenticated mutation and credential request. Do not cache authenticated responses. Store login attempt counters durably, not just in one serverless process. A global family-login limit is intentionally simple; it can temporarily lock out the family during repeated bad attempts. Revisit this if it becomes a usability problem.

No separate actor identity or caregiver revocation is promised. Changing the family password and session secret is the simple shared-access revocation mechanism.

## 4. Durable storage and consistency

Use private Blob only. No raw public Blob URLs or public data files. The app checks login before serving any record. Use server credentials/OIDC; do not send storage tokens to clients.

Layout:

- `journals/YYYY-MM.json`: the measurement month's proposals, completed readings with nested meal context, and operation outcomes.
- `system/login-window.json`: a small global login-attempt window.
- `voice-calls/UUID.json`: per-call ownership, provider ID and cleanup status; no audio or transcripts.
- Future profile/settings in separate private files, with no cross-file atomicity assumed.

Monthly journals bound read/list operations and avoid downloading all history on every request. This is a deliberate refinement of separate files per entry: the currently documented Blob SDK supports ETag conditional writes. A successful compare-and-swap updates a complete proposal/reading/receipt envelope atomically in one file. Do not use last-writer-wins read/modify/write.

Read fresh private data, mutate a validated version, and conditionally write against its ETag. Retry bounded conflicts; return a visible retryable error if contention continues. Initial creation must fail rather than overwrite an existing journal. A local development adapter provides the same expected-version contract for one local server; cloud deployment rejects local mode.

State:

```text
awaiting_confirmation -> committed
                      -> cancelled
                      -> expired
```

Each proposal is bound to the signed session, exact normalized draft and expiry. Corrections to a draft create a new proposal after cancellation; no silent draft mutation. Expired/cancelled proposals cannot save. Repeated confirmation returns the existing receipt and never adds another reading. A committed record and its meal/receipt are in the same journal write.

Manual confirmation is an explicit on-screen action. The no-write voice prototype is not permitted to manufacture that confirmation or call record mutations. A future voice implementation must prove confirmation from the human's actual turn, not an LLM-supplied `confirmed` flag.

Record UTC measurement time separately from capture time, preserving the capture timezone. Clarify type/date/unit; do not guess them. Fasting meal context refers to the previous evening; post-meal context includes the associated meal's start time. Permit unknown food details. Numeric read-back is mandatory in future voice logging.

Set a bounded journal size and return an explicit limit error rather than discard records. Plan private export and expired-proposal payload cleanup before a real-data pilot. Blob lacks relational queries and multi-file transactions; keep the first domain small.

## 5. Voice prototype and remaining gates

Candidate model: `gpt-realtime-2.1-mini`. Verify access and actual Hindi/Gujarati behavior in the configured OpenAI project. Use the Realtime GA credential/call endpoints, not default GPT-Live examples from shared guides.

Voice is explicitly opt-in and disabled until configured. It is conversation only: no record-write tools, no claim of saved readings, no treatment instructions or individualized glucose classification. The UI provides a visible Stop and a manual recording fallback.

The approved v1 is intentionally simple: no app-enforced duration, daily-use, concurrent-call or spending limits. Create a private call record with a conditional Blob write, then create the provider call through server-side SDP exchange. Keep all API keys on the server. No Workflow/timer dependency or paid background worker is used. Network/connection timeouts remain to stop stalled handshakes, not to limit conversation duration.

Explicit Stop, backgrounding and sign-out stop local media and call the owner-bound server Stop endpoint. Present unconfirmed cleanup as pending and expose retry. Upstream rejection is distinct from an unknown/lost creation response. A lost provider call ID can prevent confirmed cleanup; no automatic cutoff or dollar spending cap is promised. Deferred limits are future work, not a v1 launch blocker.

Test interruption, microphone denial, pending connection cancellation, audio playback rejection, network loss, page suspension, session expiry, and repeated Start/Stop. Stop must close local tracks, playback, data channel, timers and peer connection. Client cleanup alone is not proof of provider billing termination.

Before enabling real voice logging:

1. Prove trusted server event handling, confirmation and complete provider-side shutdown.
2. Verify a free hosting runtime can sustain required session control. No paid background worker is preapproved.
3. Before reliable voice logging, revisit concurrency, duration, idle, daily-usage and spending limits; verify real provider cleanup. V1 conversation-only voice explicitly defers these limits.
4. Run at least 30 consented spoken trials with synthetic utterances across Hindi, Gujarati and code-switching.
5. Require exact confirmed numbers, no ambiguous/negative/stale-confirmation writes, and no false saved acknowledgements. Measure latency and clarification rates.

If free infrastructure cannot meet these requirements, report the limitation and keep the affected feature disabled rather than quietly adding a paid service.

## 6. Safety and privacy

This is a diary companion, not a medical protocol or diagnostic device. No medication changes, invented targets, inferred health facts, zero-spike guarantees, or causal claims from a few observations.

Store private profile/clinical settings only after verification and consent. Do not seed records or personal details from the PDF. Real clinical interpretations and localized escalation instructions require qualified review. Unknown targets remain unknown.

No raw audio/full-transcript retention by default. Keep necessary voice context in memory and minimal structured records. Exclude health payloads, cookies, credentials and transcripts from logs/analytics. Review actual provider retention before real data is transmitted.

Use `noindex`/robots directives as additional search exclusion, not as the access boundary. No persistent offline health-data cache in v1. Offline saves are disabled, not silently queued.

## 7. Build milestones and acceptance

| Milestone | Work | Exit |
| --- | --- | --- |
| M1 - Working local foundation | Scaffold, configuration tool, family login, storage contracts, accessible shell and PWA assets | Fresh install builds; no secret/default login bypass; configuration failures are clear |
| M2 - Confirmed records | Validated manual proposal, review/cancel/save, private journal, month history and honest receipts | Concurrent writes/retries do not lose or duplicate records; auth/session/origin boundaries tested |
| M3 - Voice feasibility | Authenticated credential route, browser WebRTC lifecycle, optional captions, explicit no-write prototype status | Automated transport tests plus real provider/iPhone testing when access exists; no claimed voice save |
| M4 - Reliable voice logging | Trusted session control, confirmed voice tools, quotas, shutdown and real historical corrections | 30 spoken trials; end-to-end authorization, expiry, replay and failure cases pass |
| M5 - Personalized private pilot | Verified profile/safety settings, reviewed food/trend answers, export/restore/purge and family installation | Consent/clinical/content gates, device checks and operating-limit drills pass |

Automated coverage: scrypt/session tampering and expiry, credential rotation, login limits, same-origin checks, malformed/unit/time inputs, session-bound proposal expiry/cancel/retry, concurrent journal creation/update, history filtering, storage failures and local-mode rejection on Vercel. The real Blob adapter still requires connected-store verification. UI browser tests cover login/logout, persistence after reload, review-before-save, cancel, month history, lost-response retry, voice-disabled/Stop behavior and an offline shell without cached diary/API data.

Clinical and deployment claims are never inferred from passing automated tests.

## 8. Free-tier operating envelope

Target $0 for code hosting, Vercel hosting and storage; OpenAI usage is paid. Current Hobby Blob allowance includes 1 GB storage, 10,000 simple operations and 2,000 advanced operations monthly. These are shared limits, not an entitlement independent of other account usage; recheck the selected account's allowances.

Use monthly journal reads instead of polling or listing every reading. Keep diagnostics local/minimal. Voice adds small private per-call ownership records, but no raw audio/transcripts. Use an included `vercel.app` address initially; a purchased domain, paid monitoring, managed backups, SMS/email service, paid authentication, Workflow/timer service or always-on worker is not required.

Hobby storage can become unavailable if quotas are exhausted; do not promise uptime or silently upgrade. A paused/failed storage request must never yield a "saved" message. Manual private exports are the initial backup direction; automatic backup/restore guarantees remain unimplemented.

## 9. References

Accessed 2026-11-02; recheck APIs, SDK capabilities and limits during implementation.

- [OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime)
- [Realtime Mini model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
- [Next.js PWA](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Private Vercel Blob](https://vercel.com/docs/vercel-blob/private-storage)
- [Blob SDK and conditional writes](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Blob pricing and Hobby limits](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
