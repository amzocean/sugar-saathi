"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

type Resources = { abort: AbortController; stream?: MediaStream; peer?: RTCPeerConnection; channel?: RTCDataChannel; audio?: HTMLAudioElement; timer?: ReturnType<typeof setTimeout> };
export function useVoice() {
  const resources = useRef<Resources | null>(null);
  const [status, setStatus] = useState("Ready");
  const [active, setActive] = useState(false);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const stop = useCallback((message = "Stopped") => {
    const current = resources.current;
    resources.current = null;
    current?.abort.abort();
    if (current?.timer) clearTimeout(current.timer);
    current?.stream?.getTracks().forEach(track => track.stop());
    current?.channel?.close();
    current?.peer?.close();
    if (current?.audio) { current.audio.pause(); current.audio.srcObject = null; }
    setActive(false);
    setStatus(message);
  }, []);

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
    if (resources.current) return;
    const current: Resources = { abort: new AbortController() };
    resources.current = current;
    setError(""); setCaption(""); setStatus("Connecting"); setActive(true);
    const live = () => resources.current === current && !current.abort.signal.aborted;
    current.timer = setTimeout(() => {
      if (live()) { stop("Connection timed out"); setError("Voice took too long to connect. Please try again."); }
    }, 30_000);
    try {
      // Check opt-in configuration before asking for microphone permission or making a paid call.
      const { clientSecret } = await api<{ clientSecret: string }>("/api/voice/session", {}, current.abort.signal);
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
        if (current.peer?.connectionState === "connected") setStatus("Listening");
        if (["failed", "disconnected", "closed"].includes(current.peer?.connectionState ?? "")) stop("Disconnected. Start a new conversation to retry.");
      };
      current.channel = current.peer.createDataChannel("oai-events");
      current.channel.onmessage = event => {
        if (!live()) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "input_audio_buffer.speech_started") { setStatus("Listening"); setCaption(""); }
          if (message.type === "response.output_audio_transcript.delta") {
            setStatus("Speaking");
            setCaption(previous => (previous + (message.delta ?? "")).slice(-2000));
          }
          if (message.type === "response.done") setStatus("Listening");
          if (message.type === "error") { stop(); setError("The voice provider reported an error. Start again to retry."); }
        } catch { /* Ignore non-JSON transport events. */ }
      };
      await current.peer.setLocalDescription(await current.peer.createOffer());
      const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
        body: current.peer.localDescription!.sdp,
        signal: current.abort.signal,
      });
      if (!answer.ok) throw new Error("The voice connection was rejected. Check model access and try again.");
      const sdp = await answer.text();
      if (!live()) return;
      await current.peer.setRemoteDescription({ type: "answer", sdp });
      // A local prototype limit is not a server-enforced spending cap.
      clearTimeout(current.timer);
      current.timer = setTimeout(() => stop("Prototype ended after three minutes"), 180_000);
    } catch (error) {
      if (!live()) return;
      stop();
      setError(error instanceof Error ? error.message : "Voice could not connect");
    }
  }, [stop]);
  return { status, active, caption, error, start, stop };
}
