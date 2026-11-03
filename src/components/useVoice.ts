"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

type Resources = {
  abort: AbortController; id?: string; generation: number; stream?: MediaStream;
  peer?: RTCPeerConnection; channel?: RTCDataChannel; audio?: HTMLAudioElement;
  timer?: ReturnType<typeof setTimeout>;
};
export function useVoice() {
  const resources = useRef<Resources | null>(null);
  const pendingStop = useRef<Resources | null>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState("Ready");
  const [active, setActive] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");

  const stopProvider = useCallback(async (current: Resources) => {
    if (!current.id) return;
    try {
      const response = await fetch("/api/voice/stop", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id }), cache: "no-store", keepalive: true,
      });
      const closed = response.status === 404 || (response.ok && (await response.json()).closed === true);
      if (generation.current !== current.generation) return;
      if (closed) {
        if (pendingStop.current === current) pendingStop.current = null;
        setCleanupPending(false);
        setStatus(previous => previous.includes("provider cleanup pending") ? "Stopped" : previous);
        setError(previous => previous.startsWith("Server cleanup") || previous.startsWith("The Stop request") ? "" : previous);
      } else {
        pendingStop.current = current;
        setCleanupPending(true);
        setStatus("Microphone stopped; provider cleanup pending");
        setError("Server cleanup is not confirmed yet. Retry server Stop. There is no automatic cutoff.");
      }
    } catch {
      if (generation.current === current.generation) {
        pendingStop.current = current;
        setCleanupPending(true);
        setStatus("Microphone stopped; provider cleanup pending");
        setError("The Stop request could not be confirmed. Retry server Stop.");
      }
    }
  }, []);
  const stop = useCallback((message = "Stopped") => {
    const current = resources.current ?? pendingStop.current;
    resources.current = null;
    current?.abort.abort();
    if (current?.timer) clearTimeout(current.timer);
    current?.stream?.getTracks().forEach(track => track.stop());
    current?.channel?.close();
    current?.peer?.close();
    if (current?.audio) { current.audio.pause(); current.audio.srcObject = null; }
    setActive(false); setStatus(message);
    if (current?.id) {
      pendingStop.current = current;
      setCleanupPending(true);
      void stopProvider(current);
    }
  }, [stopProvider]);

  useEffect(() => {
    const onHide = () => { if (document.hidden && resources.current) stop("Stopped while the app was in the background"); };
    const onPageHide = () => stop();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      stop();
    };
  }, [stop]);

  const start = useCallback(async () => {
    if (resources.current || pendingStop.current) return;
    const current: Resources = { abort: new AbortController(), generation: ++generation.current };
    resources.current = current;
    setError(""); setCaption(""); setStatus("Connecting"); setActive(true);
    const live = () => resources.current === current && !current.abort.signal.aborted;
    current.timer = setTimeout(() => {
      if (live()) { stop("Connection timed out"); setError("Voice took too long to connect. Please try again."); }
    }, 30_000);
    try {
      await api("/api/voice/session", undefined, current.abort.signal);
      if (!live()) return;
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access requires HTTPS or localhost");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!live()) { stream.getTracks().forEach(track => track.stop()); return; }
      current.stream = stream;
      current.peer = new RTCPeerConnection();
      current.audio = new Audio();
      current.audio.autoplay = true;
      current.peer.ontrack = event => {
        if (!live() || !current.audio) return;
        current.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void current.audio.play().catch(() => {
          if (live()) { stop(); setError("Audio playback was blocked. Stop and try Start again."); }
        });
      };
      stream.getTracks().forEach(track => current.peer!.addTrack(track, stream));
      current.peer.onconnectionstatechange = () => {
        if (!live()) return;
        if (current.peer?.connectionState === "connected") {
          clearTimeout(current.timer); setStatus("Listening");
        }
        if (["failed", "disconnected", "closed"].includes(current.peer?.connectionState ?? "")) stop("Disconnected. Start a new conversation to retry.");
      };
      current.channel = current.peer.createDataChannel("oai-events");
      current.channel.onopen = () => {
        if (live()) current.channel?.send(JSON.stringify({
          type: "response.create",
          response: { instructions: "Greet briefly in Hindi. Ask whether the user prefers Hindi or Gujarati. Explain that saving readings uses the app's manual form, then listen." },
        }));
      };
      current.channel.onmessage = event => {
        if (!live()) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "input_audio_buffer.speech_started") { setStatus("Listening"); setCaption(""); }
          if (message.type === "response.output_audio_transcript.delta") {
            setStatus("Speaking"); setCaption(previous => (previous + (message.delta ?? "")).slice(-2000));
          }
          if (message.type === "response.done") setStatus("Listening");
          if (message.type === "error") { stop(); setError("The voice provider reported an error. Start again after cleanup."); }
        } catch { /* Ignore non-JSON transport events. */ }
      };
      await current.peer.setLocalDescription(await current.peer.createOffer());
      if (current.peer.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const peer = current.peer!;
          const abort = () => { cleanup(); reject(new Error("Voice connection cancelled")); };
          const ready = () => { if (peer.iceGatheringState === "complete") { cleanup(); resolve(); } };
          const timer = setTimeout(() => { cleanup(); reject(new Error("Network negotiation timed out")); }, 10_000);
          const cleanup = () => {
            clearTimeout(timer); peer.removeEventListener("icegatheringstatechange", ready);
            current.abort.signal.removeEventListener("abort", abort);
          };
          peer.addEventListener("icegatheringstatechange", ready);
          current.abort.signal.addEventListener("abort", abort, { once: true });
          if (current.abort.signal.aborted) abort(); else ready();
        });
      }
      if (!live()) return;
      current.id = crypto.randomUUID();
      // Keep receiving a late answer after Stop so its server-owned call can be closed again.
      const result = await api<{ sdp: string }>("/api/voice/session", {
        id: current.id, sdp: current.peer.localDescription!.sdp,
      }, AbortSignal.timeout(25_000));
      if (!live()) { void stopProvider(current); return; }
      await current.peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
    } catch (error) {
      if (!live()) return;
      stop(); setError(error instanceof Error ? error.message : "Voice could not connect");
    }
  }, [stop, stopProvider]);
  return { status, active, cleanupPending, caption, error, start, stop };
}
