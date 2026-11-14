export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"
).replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws");
export const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "";

/** Krisp noise filtering is a LiveKit Cloud feature; self-hosted servers lack it. */
export const LIVEKIT_IS_CLOUD = (() => {
  try {
    return new URL(LIVEKIT_URL.replace(/^ws/, "http")).hostname.endsWith(".livekit.cloud");
  } catch {
    return false;
  }
})();
