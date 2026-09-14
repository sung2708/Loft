export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"
).replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws");
export const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "";
