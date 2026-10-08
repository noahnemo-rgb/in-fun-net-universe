export const VOICE_QUIET =
  "The voice is quiet. Set AI_GATEWAY_API_KEY in .env.local, or from this project run eve link so a VERCEL_OIDC_TOKEN is pulled. Restart the site after that.";

export type VoiceState = "unknown" | "ready" | "quiet";

export function voiceFromInfo(info: unknown): VoiceState {
  if (typeof info !== "object" || info === null || !("agent" in info)) return "unknown";
  const agent = info.agent;
  if (typeof agent !== "object" || agent === null || !("model" in agent)) return "unknown";
  const model = agent.model;
  if (typeof model !== "object" || model === null || !("endpoint" in model)) return "unknown";
  const endpoint = model.endpoint;
  if (typeof endpoint !== "object" || endpoint === null || !("kind" in endpoint)) return "unknown";
  if (endpoint.kind === "gateway" && "connected" in endpoint && endpoint.connected === false) {
    return "quiet";
  }
  return "ready";
}
