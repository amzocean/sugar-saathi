import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Session } from "./auth";
import { AppError } from "./errors";
import { type Store, update } from "./store";

const instant = z.iso.datetime({ offset: true });
export const draftSchema = z.object({
  valueMgDl: z.number().finite().positive().max(2000),
  type: z.enum(["fasting", "post-meal", "pre-meal", "random"]),
  measuredAt: instant,
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid timezone"),
  meal: z.string().trim().min(1, "Describe the meal, or enter Unknown").max(1000),
  mealStartedAt: instant.nullable(),
}).strict().superRefine((draft, ctx) => {
  if (Date.parse(draft.measuredAt) > Date.now() + 60_000) {
    ctx.addIssue({ code: "custom", path: ["measuredAt"], message: "Measurement time cannot be in the future" });
  }
  if (draft.type !== "post-meal" && draft.mealStartedAt !== null) {
    ctx.addIssue({ code: "custom", path: ["mealStartedAt"], message: "Meal start is only used for a post-meal reading" });
  }
  if (draft.type === "post-meal" && (!draft.mealStartedAt || Date.parse(draft.mealStartedAt) > Date.parse(draft.measuredAt))) {
    ctx.addIssue({ code: "custom", path: ["mealStartedAt"], message: "Post-meal readings need a meal start time at or before the measurement" });
  }
});
export type Draft = z.infer<typeof draftSchema>;
export type Reading = Draft & { id: string; confirmedAt: string; recordedAt: string; elapsedMinutes: number | null };
export type Proposal = {
  id: string; sessionId: string; createdAt: string; expiresAt: number;
  status: "awaiting_confirmation" | "committed" | "cancelled";
  draft: Draft; reading?: Reading;
};
type Journal = { schema: 1; proposals: Record<string, Proposal> };
const empty = (): Journal => ({ schema: 1, proposals: {} });

export function validMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError(400, "Choose a valid month");
  return month;
}

function monthOf(draft: Draft) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: draft.timezone, year: "numeric", month: "2-digit" })
    .formatToParts(new Date(draft.measuredAt));
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}

function proposalKey(id: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2]):[a-f0-9-]{36}$/.test(id)) throw new AppError(400, "Invalid proposal");
  return `journals/${id.slice(0, 7)}.json`;
}

export async function propose(store: Store, session: Session, input: unknown, now = Date.now()) {
  const draft = draftSchema.parse(input);
  const month = monthOf(draft);
  const proposal: Proposal = {
    id: `${month}:${randomUUID()}`, sessionId: session.id,
    createdAt: new Date(now).toISOString(), expiresAt: now + 10 * 60_000,
    status: "awaiting_confirmation", draft,
  };
  return update(store, `journals/${month}.json`, empty, journal => {
    for (const [id, old] of Object.entries(journal.proposals)) {
      if (old.status !== "committed" && old.expiresAt < now) delete journal.proposals[id];
    }
    if (Object.keys(journal.proposals).length >= 1000) throw new AppError(409, "This month's journal is full. Export/archive support is needed before adding more records.");
    journal.proposals[proposal.id] = proposal;
    return proposal;
  });
}

export async function finish(store: Store, session: Session, id: string, action: "confirm" | "cancel", now = Date.now()) {
  return update(store, proposalKey(id), empty, journal => {
    const proposal = journal.proposals[id];
    if (!proposal || proposal.sessionId !== session.id) throw new AppError(404, "This draft is not available in your session");
    if (proposal.status === "committed") {
      if (action === "confirm") return proposal;
      throw new AppError(409, "This reading is already saved");
    }
    if (proposal.status === "cancelled" || proposal.expiresAt <= now) throw new AppError(409, "This draft was cancelled or expired. Please start again.");
    if (action === "cancel") proposal.status = "cancelled";
    else {
      proposal.status = "committed";
      proposal.reading = {
        ...proposal.draft, id: proposal.id, recordedAt: proposal.createdAt,
        confirmedAt: new Date(now).toISOString(),
        elapsedMinutes: proposal.draft.mealStartedAt
          ? Math.round((Date.parse(proposal.draft.measuredAt) - Date.parse(proposal.draft.mealStartedAt)) / 60_000) : null,
      };
    }
    return proposal;
  });
}

export async function history(store: Store, month: string) {
  const journal = await store.read<Journal>(`journals/${validMonth(month)}.json`);
  return Object.values(journal?.value.proposals ?? {}).flatMap(item =>
    item.status === "committed" && item.reading ? [item.reading] : [],
  ).sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
}

export async function reserveLoginAttempt(store: Store, now = Date.now()) {
  return update(store, "system/login-window.json", () => ({ startedAt: now, attempts: 0 }), window => {
    if (window.startedAt + 10 * 60_000 <= now) { window.startedAt = now; window.attempts = 0; }
    if (window.attempts >= 8) throw new AppError(429, "Too many login attempts. Please wait ten minutes before trying again.");
    window.attempts++;
  });
}
