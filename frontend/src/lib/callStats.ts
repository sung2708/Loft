import type { CallFeedbackPayload, RoomCredential } from "@/types/api";

/**
 * Coarse, privacy-preserving call quality collection: one LiveKit connection
 * quality sample every few seconds plus a reconnect count. After leaving, the
 * totals wait in sessionStorage for the post-call rating prompt.
 */
const PENDING_KEY = "loft.call.feedback";
/** Calls shorter than this are not worth asking about. */
export const MIN_RATED_CALL_SECONDS = 60;
const PENDING_TTL_MS = 10 * 60 * 1000;

export type QualitySample = "excellent" | "good" | "poor" | "lost" | "unknown";

export type CallStats = Omit<CallFeedbackPayload, "rating" | "tags">;

export interface PendingFeedback {
  roomId: string;
  credential: RoomCredential;
  stats: CallStats;
  endedAt: number;
}

interface Collector {
  roomId: string;
  startedAt: number;
  good: number;
  poor: number;
  lost: number;
  reconnects: number;
}

let current: Collector | null = null;

export function startCallStats(roomId: string, now = Date.now()) {
  if (current?.roomId === roomId) return;
  current = { roomId, startedAt: now, good: 0, poor: 0, lost: 0, reconnects: 0 };
}

export function sampleCallQuality(sample: QualitySample) {
  if (!current) return;
  if (sample === "excellent" || sample === "good") current.good += 1;
  else if (sample === "poor") current.poor += 1;
  else if (sample === "lost") current.lost += 1;
}

export function noteCallReconnect() {
  if (current) current.reconnects += 1;
}

/** Ends collection; returns the stats that were queued, if any. */
export function finishCallStats(credential: RoomCredential, now = Date.now()): PendingFeedback | null {
  const collector = current;
  current = null;
  if (!collector || collector.roomId !== credential.roomId) return null;
  const duration = Math.round((now - collector.startedAt) / 1000);
  if (duration < MIN_RATED_CALL_SECONDS) return null;
  const pending: PendingFeedback = {
    roomId: collector.roomId,
    credential,
    endedAt: now,
    stats: {
      duration_seconds: Math.min(duration, 86400),
      samples_good: Math.min(collector.good, 20000),
      samples_poor: Math.min(collector.poor, 20000),
      samples_lost: Math.min(collector.lost, 20000),
      reconnects: Math.min(collector.reconnects, 1000),
    },
  };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Feedback is optional.
  }
  return pending;
}

export function readPendingFeedback(now = Date.now()): PendingFeedback | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as PendingFeedback | null;
    if (!value || typeof value.roomId !== "string" || !value.credential || !value.stats) return null;
    if (now - value.endedAt > PENDING_TTL_MS) {
      clearPendingFeedback();
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function clearPendingFeedback() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

/** Test hook. */
export function resetCallStats() {
  current = null;
}
