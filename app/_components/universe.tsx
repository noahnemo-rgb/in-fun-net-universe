"use client";

import type { EveMessage } from "eve/react";
import { useEveAgent } from "eve/react";
import { useEffect, useRef, useState } from "react";
import { VOICE_QUIET, voiceFromInfo, type VoiceState } from "@/app/voice";
import type { WorldFrame } from "@/app/world/mount-world";

function plain(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function messageText(message: EveMessage) {
  return plain(
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  );
}

export function Universe({
  initialEntered = false,
  sessionId,
}: {
  readonly initialEntered?: boolean;
  readonly sessionId?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<WorldFrame["phase"]>(initialEntered ? "ground" : "gateway");
  const [focus, setFocus] = useState<WorldFrame["focus"]>(null);
  const [hint, setHint] = useState(true);
  const [draft, setDraft] = useState("");
  const [voice, setVoice] = useState<VoiceState>("unknown");
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);

  const agent = useEveAgent({
    initialSession: sessionId === undefined ? undefined : { sessionId, streamIndex: 0 },
    resume: sessionId !== undefined,
    onSessionChange(session) {
      if (sessionId === undefined && session !== undefined) {
        History.prototype.replaceState.call(
          window.history,
          window.history.state,
          "",
          `/s/${encodeURIComponent(session.sessionId)}`,
        );
      }
    },
  });

  const busy = agent.status === "submitted" || agent.status === "streaming";
  const resuming = agent.status === "resuming";
  const assistantLines = agent.data.messages.filter(
    (message) => message.role === "assistant" && messageText(message).length > 0,
  );
  const currentPresence = assistantLines.length > 0 ? messageText(assistantLines.at(-1) as EveMessage) : "";
  const failure = !busy && !resuming ? agent.error?.message : undefined;
  const spoken = currentPresence || (failure ? plain(failure) : "") || note;
  const withPeer = focus?.kind === "peer";
  const withSign = focus?.kind === "sign";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dispose = () => {};
    let alive = true;
    void import("@/app/world/mount-world").then((mod) => {
      if (!alive) return;
      const world = mod.mountWorld(canvas, {
        skipGateway: initialEntered,
        onReady: () => setReady(true),
        onFlash: (opacity) => {
          if (flashRef.current) flashRef.current.style.opacity = String(opacity);
        },
        onFrame: (frame) => {
          setPhase((current) => (current === frame.phase ? current : frame.phase));
          setFocus((current) => (sameFocus(current, frame.focus) ? current : frame.focus));
          if (frame.phase === "ground" && !moved.current && (frame.focus?.kind === "peer" || frame.focus?.kind === "sign")) {
            moved.current = true;
            setHint(false);
          }
        },
      });
      enterRef.current = world.enter;
      dispose = world.dispose;
    });
    return () => {
      alive = false;
      dispose();
    };
  }, [initialEntered]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/eve/v1/info", { signal: controller.signal })
      .then(async (response) => voiceFromInfo(await response.json()))
      .then((next) => {
        if (!controller.signal.aborted) setVoice(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setVoice("unknown");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (withPeer) inputRef.current?.focus();
  }, [withPeer]);

  const speak = async (text: string) => {
    const line = text.trim();
    if (line.length === 0 || resuming || !withPeer) return;
    setDraft("");
    setNote("");
    let readyVoice = voice === "ready";
    if (!readyVoice) {
      try {
        const info = voiceFromInfo(await (await fetch("/eve/v1/info")).json());
        setVoice(info);
        readyVoice = info !== "quiet";
      } catch {
        readyVoice = voice !== "quiet";
      }
    }
    if (!readyVoice) {
      setNote(VOICE_QUIET);
      return;
    }
    try {
      await agent.send(line, busy ? { turnPolicy: "steer" } : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : VOICE_QUIET;
      setNote(/gateway|api key|credential|oidc/i.test(message) ? VOICE_QUIET : plain(message));
    }
  };

  const peerWords =
    withPeer && voice === "quiet" && spoken.length === 0 ? VOICE_QUIET : withPeer ? spoken : "";

  return (
    <main className={phase === "ground" ? "stage ground" : "stage"}>
      <img
        alt="In-Fun.net. A white core, a rainbow spiral of sparks, and two beams rising through a black void."
        className={ready ? "gateway-still away" : "gateway-still"}
        src="/mark.jpg"
      />
      <canvas aria-label="In-Fun.net fairground" className="world-canvas" ref={canvasRef} />
      <div aria-hidden="true" className="flash" ref={flashRef} />

      {phase === "gateway" ? (
        <button className="door" onClick={() => enterRef.current()} type="button">
          <span>step in</span>
        </button>
      ) : null}

      {withPeer ? (
        <div
          aria-live="polite"
          className="peer-speech"
          style={{ left: focus.x, top: focus.y }}
        >
          <p className="who">Rio</p>
          {peerWords ? <p>{peerWords}</p> : null}
          {busy && currentPresence.length === 0 ? <p className="listening">The light is answering.</p> : null}
        </div>
      ) : null}

      {withSign ? (
        <p className="sign-line" style={{ left: focus.x, top: focus.y }}>
          {focus.line}
        </p>
      ) : null}

      <div className="ground-ui">
        {phase === "ground" && hint ? <p className="hint">Click the ground, or use the arrow keys.</p> : null}
        {withPeer ? (
          <form
            className="speak"
            onSubmit={(event) => {
              event.preventDefault();
              void speak(draft);
            }}
            style={{ top: focus.feetY }}
          >
            <label className="sr" htmlFor="speak">
              Speak with Rio
            </label>
            <input
              autoComplete="off"
              disabled={resuming}
              id="speak"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="speak with Rio"
              ref={inputRef}
              spellCheck={false}
              value={draft}
            />
          </form>
        ) : null}
        <h1>In-Fun.net</h1>
      </div>
    </main>
  );
}

function sameFocus(current: WorldFrame["focus"], next: WorldFrame["focus"]) {
  if (current === next) return true;
  if (!current || !next) return false;
  if (current.kind !== next.kind) return false;
  if (current.kind === "peer" && next.kind === "peer") {
    return Math.abs(current.x - next.x) < 8 && Math.abs(current.y - next.y) < 8;
  }
  if (current.kind === "sign" && next.kind === "sign") {
    return current.line === next.line && Math.abs(current.x - next.x) < 8 && Math.abs(current.y - next.y) < 8;
  }
  return false;
}
