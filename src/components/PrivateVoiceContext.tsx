"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { extractContext, type ContextDraft } from "@/lib/context-format";
import type { ContextStatus } from "@/lib/private-context";

export default function PrivateVoiceContext() {
  const [status, setStatus] = useState<ContextStatus | null>(null);
  const [draft, setDraft] = useState<ContextDraft | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selection = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void api<ContextStatus>("/api/voice/context", undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setStatus(result);
    }).catch(() => { if (!controller.signal.aborted) setError("Private context status could not be loaded. Use Reload status."); });
    return () => controller.abort();
  }, []);

  async function reload() {
    setBusy(true); setError(""); setApproved(false);
    try { setStatus(await api<ContextStatus>("/api/voice/context")); }
    catch { setError("Private context status could not be loaded."); }
    finally { setBusy(false); }
  }
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const current = ++selection.current;
    event.target.value = "";
    setDraft(null); setApproved(false); setNotice(""); setError("");
    if (!file) return;
    try {
      if (file.size > 80_000) throw new Error("Choose a Markdown file no larger than 80 KB.");
      const extracted = extractContext(await file.text());
      if (current === selection.current) setDraft(extracted);
    } catch (error) { if (current === selection.current) setError(error instanceof Error ? error.message : "The file could not be read."); }
  }
  async function save() {
    if (!draft || !approved || !status) return;
    setBusy(true); setError(""); setNotice("");
    try {
      setStatus(await api<ContextStatus>("/api/voice/context", { ...draft, approved: true, expectedVersion: status.version }));
      setDraft(null); setApproved(false);
      setNotice("Private context saved. Stop and start voice again to use it. No diary readings were imported.");
    } catch (error) { setError(error instanceof Error ? error.message : "The private context save was not confirmed."); }
    finally { setBusy(false); }
  }
  return <details className="card private-context">
    <summary>Family settings: private voice context</summary>
    <p>{status ? status.invalid ? "Stored context is invalid. Review and replace it before starting voice." : status.configured ? "Approved family notes are configured for new voice conversations." : "No private context yet. Voice uses the general app guidance." : "Checking private context status..."}</p>
    {status?.approvedAt && <p className="small">Last approved: {new Date(status.approvedAt).toLocaleString()}</p>}
    <p className="small">Anyone with the family password can replace these notes. Only profile and food-reference sections B and C are imported. Examples, developer instructions and clinical protocols are excluded.</p>
    <label htmlFor="private-context-file">Choose private context Markdown</label>
    <input id="private-context-file" type="file" accept=".md,text/markdown,text/plain" disabled={busy} onChange={event => void choose(event)} />
    {draft && <>
      <h3>Review what will be shared</h3>
      <pre className="context-preview">{`FAMILY-REPORTED PROFILE\n${draft.profile}\n\nFOOD REFERENCE\n${draft.nutrition}`}</pre>
      <p className="small">Approval does not verify medical facts or nutrition values. Historical notes are not confirmed readings. Targets and medication details still need qualified verification.</p>
      <label className="context-consent"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} disabled={busy} />I reviewed these sections and have permission to store them privately and send them to OpenAI in new voice sessions.</label>
      <button className="secondary" disabled={!approved || !status || busy} onClick={() => void save()}>{busy ? "Saving..." : "Approve and save private context"}</button>
    </>}
    <button className="quiet" disabled={busy} onClick={() => void reload()}>Reload status</button>
    {notice && <p className="success" aria-live="polite">{notice}</p>}
    {error && <p className="message error" role="alert">{error}</p>}
  </details>;
}
