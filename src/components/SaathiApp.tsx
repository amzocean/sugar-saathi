"use client";

import { type FormEvent, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Proposal, Reading } from "@/lib/records";
import { api } from "@/lib/client-api";
import { useVoice } from "./useVoice";

function localDateTime() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function when(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function title(type: string) { return type.replace("-", " "); }
const subscribe = () => () => {};
const browserSnapshot = () => true;
const serverSnapshot = () => false;

export default function SaathiApp({ initiallyAuthenticated, configurationError, local }: {
  initiallyAuthenticated: boolean; configurationError: string; local: boolean;
}) {
  const [authenticated, setAuthenticated] = useState(initiallyAuthenticated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedMonth, setMonth] = useState<string>();
  const [loaded, setLoaded] = useState<{ month: string; readings: Reading[] | null }>({ month: "", readings: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState("fasting");
  const [selectedTime, setMeasuredAt] = useState<string>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const voice = useVoice();
  const browserReady = useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
  const deviceTime = browserReady ? localDateTime() : "";
  const month = selectedMonth ?? deviceTime.slice(0, 7);
  const measuredAt = selectedTime ?? deviceTime;
  const readings = loaded.month === month ? loaded.readings ?? [] : [];
  const loading = !!month && (loaded.month !== month || refreshing);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    if (!month) return;
    try {
      const result = await api<{ readings: Reading[] }>(`/api/history?month=${encodeURIComponent(month)}`, undefined, signal);
      if (!signal?.aborted) setLoaded({ month, readings: result.readings });
    } catch (error) {
      if (!signal?.aborted) {
        setError(error instanceof Error ? error.message : "History could not be loaded");
        setLoaded({ month, readings: null });
      }
    } finally { if (!signal?.aborted) setRefreshing(false); }
  }, [month]);
  useEffect(() => {
    if (!authenticated || !month) return;
    const controller = new AbortController();
    // History is external state; loadHistory updates React only after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [authenticated, month, loadHistory]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = event.currentTarget;
    try {
      await api("/api/auth/login", { password: new FormData(form).get("password") });
      form.reset(); setAuthenticated(true);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() {
    voice.stop(); setBusy(true); setError("");
    try {
      await api("/api/auth/logout", {});
      setAuthenticated(false); setLoaded({ month: "", readings: [] }); setProposal(null); setShowForm(false); setNotice("");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ proposal: Proposal }>("/api/reading/propose", {
        valueMgDl: Number(form.get("value")), type,
        measuredAt: new Date(measuredAt).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        meal: form.get("meal"),
        mealStartedAt: type === "post-meal" ? new Date(String(form.get("mealStartedAt"))).toISOString() : null,
      });
      setProposal(result.proposal);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function finish(action: "confirm" | "cancel") {
    if (!proposal) return;
    setBusy(true); setError("");
    try {
      const { proposal: result } = await api<{ proposal: Proposal }>(`/api/proposals/${encodeURIComponent(proposal.id)}`, { action });
      if (result.status === "committed") {
        setNotice(`Saved ${result.reading!.valueMgDl} mg/dL. Confirmed and recorded.`);
        setMonth(result.id.slice(0, 7));
        setShowForm(false); setMeasuredAt(localDateTime());
      } else setNotice("Draft cancelled. No reading was saved.");
      setProposal(null);
      if (result.status !== "committed" || result.id.slice(0, 7) === month) await loadHistory();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="shell">
    <header className="site-header">
      <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">s</span><span>Sugar <strong>Saathi</strong><small>A LITTLE CARE, EVERY DAY</small></span></Link>
      {authenticated && <button className="quiet" onClick={logout} disabled={busy}>Sign out</button>}
    </header>
    <main>
      {local && <p className="dev-note">Local development · records stay in this project&apos;s ignored data folder</p>}
      {configurationError ? <section className="card setup">
        <p className="eyebrow">FIRST THINGS FIRST</p><h1>A private space,<br />ready for you.</h1>
        <p>Set up the family password before opening your diary.</p>
        <div className="message" role="status">{configurationError}</div>
        <p>In this project&apos;s terminal, run <code>npm run setup:local</code>, then restart the app. For Vercel, configure login secrets and a <strong>private</strong> Blob store.</p>
        <p className="small">No default password. No public health records.</p>
      </section> : !authenticated ? <section className="card login-card">
        <p className="eyebrow">JUST FOR THE FAMILY</p>
        <h1>A little clarity.<br /><em>A little care.</em></h1>
        <p>Your readings, your own pace. Sign in to your private diary.</p>
        <form onSubmit={login}><label htmlFor="password">Family password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" maxLength={256} required />
          <button className="primary full" disabled={busy}>{busy ? "Signing in..." : "Open my diary"}</button>
        </form>
        <p className="small">This iPhone stays signed in for up to 30 days. Only use a trusted device.</p>
      </section> : <>
        <section className="welcome"><p className="eyebrow">ONE DAY AT A TIME</p><h1>Your daily<br /><em>little check-in.</em></h1><p>A place to keep your readings, without the rush.</p></section>
        <section className="voice-card" aria-label="Voice conversation">
          <span className="status"><span className={voice.active ? "dot live" : "dot"} />{voice.status}</span>
          <svg className="microphone" viewBox="0 0 64 64" aria-hidden="true"><rect x="24" y="9" width="16" height="30" rx="8" /><path d="M16 29v4a16 16 0 0 0 32 0v-4M32 49v9M24 58h16" /></svg>
          <h2>{voice.active ? "Take your time. I am here." : "Bolo, aaram se."}</h2>
          <p>Speak naturally in Hindi or Gujarati.</p>
          <button className={voice.active ? "voice-button stop" : "voice-button"} onClick={() => voice.active ? voice.stop() : void voice.start()}>{voice.active ? "Stop conversation" : "Start conversation"}</button>
          {voice.caption && <p className="captions" aria-live="polite">{voice.caption}</p>}
          <p className="prototype">Voice is a no-write prototype. Use the form below to save readings.</p>
          {voice.error && <p role="alert" className="voice-error">{voice.error}</p>}
        </section>
        <section className="record-section" aria-labelledby="record-heading">
          <div className="section-heading"><div><p className="eyebrow">YOUR CONFIRMED DIARY</p><h2 id="record-heading">One reading at a time</h2></div>
            {!showForm && <button className="secondary" onClick={() => { voice.stop(); setMeasuredAt(localDateTime()); setShowForm(true); setNotice(""); setError(""); }}>+ Add reading</button>}
          </div>
          {showForm && !proposal && <form className="card reading-form" onSubmit={propose}>
            <h3>Add a reading</h3><p className="small">Nothing is saved to your history until you review and confirm.</p>
            <div className="fields"><div><label htmlFor="value">Glucose (mg/dL)</label><input id="value" name="value" type="number" step="any" min="0.1" max="2000" inputMode="decimal" required /></div>
              <div><label htmlFor="type">Reading type</label><select id="type" value={type} onChange={event => setType(event.target.value)}><option value="fasting">Fasting</option><option value="post-meal">Post-meal</option><option value="pre-meal">Pre-meal</option><option value="random">Random</option></select></div></div>
            <label htmlFor="measuredAt">When was it measured?</label><input id="measuredAt" type="datetime-local" value={measuredAt} onChange={event => setMeasuredAt(event.target.value)} required />
            {type === "post-meal" && <><label htmlFor="mealStartedAt">When did that meal start?</label><input id="mealStartedAt" name="mealStartedAt" type="datetime-local" required /></>}
            <label htmlFor="meal">{type === "fasting" ? "What did you eat the previous evening?" : "Food or meal context"}</label>
            <textarea id="meal" name="meal" maxLength={1000} placeholder="Describe the meal, or enter Unknown" required />
            <p className="small">Your device&apos;s local timezone is used. No meal or date is guessed.</p>
            <div className="actions"><button className="primary" disabled={busy}>{busy ? "Preparing..." : "Review reading"}</button><button type="button" className="quiet" disabled={busy} onClick={() => setShowForm(false)}>Close</button></div>
          </form>}
          {proposal && <section className="card review" aria-label="Review reading">
            <p className="eyebrow">NOT SAVED YET</p><h3>Please check this reading</h3>
            <p className="reading-number">{proposal.draft.valueMgDl}<span> mg/dL</span></p>
            <p><strong>{title(proposal.draft.type)}</strong> · {when(proposal.draft.measuredAt)}</p>
            <p>{proposal.draft.type === "fasting" ? "Previous evening's meal" : "Meal context"}: {proposal.draft.meal}</p>
            {proposal.draft.mealStartedAt && <p>Meal started: {when(proposal.draft.mealStartedAt)}</p>}
            <p className="small">This draft expires after ten minutes. Confirm only if the number, date and context are right.</p>
            <div className="actions"><button className="primary" disabled={busy} onClick={() => void finish("confirm")}>{busy ? "Please wait..." : "Yes, save this reading"}</button>
              <button className="quiet" disabled={busy} onClick={() => void finish("cancel")}>Cancel draft</button></div>
          </section>}
          {notice && <p className="success" role="status">{notice}</p>}
          <div className="history-heading"><label htmlFor="month">History month</label><input id="month" type="month" value={month} onChange={event => { setError(""); setMonth(event.target.value); }} /><button className="quiet" disabled={loading} onClick={() => { setRefreshing(true); void loadHistory(); }}>Refresh</button></div>
          {loading ? <p role="status">Loading confirmed readings...</p> : loaded.month === month && loaded.readings === null ? <p>History is unavailable right now. Use Refresh to try again.</p> : readings.length ? <ul className="history">{readings.map(reading => <li className="card" key={reading.id}>
            <div><strong className="history-value">{reading.valueMgDl}<small> mg/dL</small></strong><span className="badge">{title(reading.type)}</span></div>
            <p>{when(reading.measuredAt)}</p><p className="meal-copy">{reading.meal}</p>
            {reading.elapsedMinutes !== null && <p className="small">{reading.elapsedMinutes} minutes after meal start</p>}
          </li>)}</ul> : <div className="empty"><span aria-hidden="true">+</span><h3>A fresh page for your readings.</h3><p>No confirmed readings in this month. Add one whenever you are ready.</p></div>}
        </section>
      </>}
      {error && <div className="message error" role="alert">{error}</div>}
      <footer><span className="footer-flower" aria-hidden="true">✦</span><p>A personal diary, not medical advice.<br />For urgent symptoms, seek local medical help.</p><small>Private by design. One confirmed step at a time.</small></footer>
    </main>
  </div>;
}
