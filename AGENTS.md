# Sugar Saathi implementation guardrails

Read `README.md` and `IMPLEMENTATION_PLAN.md` before implementing. This is a new, independent project; do not change or reuse deployment credentials from `husein-games`.

## Scope and implementation

- Implement the approved first slice; do not describe uncompleted milestones as working.
- Use Next.js/TypeScript, Vercel Hobby, private Vercel Blob, a shared-family password/session, and OpenAI Realtime. No Firebase, Supabase, paid authentication, or paid infrastructure without approval.
- Create synthetic fixtures only. Do not copy the source PDF, personal profile details, medical examples, recordings, or real history into tracked files.
- Verify current provider documentation, model access, SDK compatibility, and hosting limits before wiring services. Realtime and GPT-Live are different interfaces.

## Non-negotiable behavior

- The database is the source of truth; prompts and model memory are not a medical record.
- Every record and voice operation checks the signed family session. This intentionally provides shared access, not separate owner/caregiver roles or individual attribution.
- Blob credentials remain server-side; never expose public health-data files or rely on robots.txt for access control.
- No reading, meal, correction, or deletion commits without a fresh, explicit confirmation of its exact payload.
- A model tool call, `confirmed: true`, or a nonce by itself is not evidence that the person confirmed.
- Corrections supersede old proposals. Expired, replayed, cancelled, or revision-conflicting proposals must not mutate data.
- Keep each month's readings, meal context, proposals, and mutation receipts in one bounded journal. Use conditional writes/retries to prevent lost updates; never assume Blob provides multi-file transactions.
- Never announce "saved" before a successful server receipt. Reconcile uncertain outcomes instead of blindly resubmitting.
- Stop closes microphone tracks, playback, browser transport, and server/provider session resources; test all failure paths.
- Do not prescribe, change medication, infer unknown health facts, invent glucose targets, or guarantee a food's glucose effect.
- Safety rules and localized action scripts require qualified clinical review before real use.

## Privacy and validation

- No permanent API keys in the browser. Do not cache authenticated API responses or health records in a service worker.
- Keep health payloads, audio, transcripts, tokens, and session secrets out of logs and analytics.
- No cloud deployment, real health-data collection, or repository publication without approval.
- Infrastructure must stay within free tiers; an operation limit or failed save must be visible, not trigger an automatic paid upgrade.
- Test state-machine boundaries, transactions, authorization, retries, revocation, and failure recovery before UI polish.
- Test microphone, interruptions, Stop, screen lock, backgrounding, and permission recovery on an actual iPhone; desktop browser automation is not sufficient.
- Use the project's actual scripts once established. A documentation-only change does not require installing an application toolchain.
