import { translateUI } from "../../lib/i18n/uiText";
import { useI18nStore } from "../../lib/i18n/useTranslation";

export type MediaKind = "camera" | "mic" | "screen" | "general";

const tr = (english: string) =>
  translateUI(useI18nStore.getState().locale, english);

/**
 * Detects whether the current execution context satisfies browser secure-context
 * requirements for WebRTC and MediaDevices APIs.
 */
export function isSecureMediaContext(): boolean {
  if (typeof window === "undefined") return true;
  if ("isSecureContext" in window && window.isSecureContext === false) {
    return false;
  }
  if (!navigator?.mediaDevices) {
    return false;
  }
  return true;
}

/**
 * Normalized representation of a media error extracted from DOMException,
 * Error, LiveKit failure codes, or raw string messages.
 */
export interface NormalizedMediaError {
  name: string;
  message: string;
  isCancelled: boolean;
}

export function extractErrorDetails(error: unknown): NormalizedMediaError {
  if (!error) {
    return { name: "UnknownError", message: "", isCancelled: false };
  }

  let name = "";
  let message = "";

  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error || (typeof error === "object" && error !== null)) {
    const errObj = error as {
      name?: string;
      message?: string;
      code?: number | string;
      cause?: unknown;
    };
    name = errObj.name || "";
    message = errObj.message || "";

    if ((!name || name === "Error") && errObj.cause && typeof errObj.cause === "object") {
      const cause = errObj.cause as { name?: string; message?: string };
      if (cause.name && cause.name !== "Error") name = cause.name;
      if (cause.message && !message) message = cause.message;
    }
  }

  const rawLower = `${name} ${message}`.toLowerCase();

  // Recognize DOMException names embedded in message strings
  if (!name || name === "Error") {
    if (rawLower.includes("notallowederror") || rawLower.includes("permission denied") || rawLower.includes("not allowed by the user agent") || rawLower.includes("permissiondenied")) {
      name = "NotAllowedError";
    } else if (rawLower.includes("notfounderror") || rawLower.includes("devicesnotfounderror") || rawLower.includes("device not found")) {
      name = "NotFoundError";
    } else if (rawLower.includes("notreadableerror") || rawLower.includes("trackstarterror") || rawLower.includes("could not start video") || rawLower.includes("device in use")) {
      name = "NotReadableError";
    } else if (rawLower.includes("aborterror") || rawLower.includes("request was aborted")) {
      name = "AbortError";
    } else if (rawLower.includes("invalidstateerror") || rawLower.includes("invalid state")) {
      name = "InvalidStateError";
    } else if (rawLower.includes("securityerror") || rawLower.includes("secure context") || rawLower.includes("insecure origin")) {
      name = "SecurityError";
    } else if (rawLower.includes("overconstrainederror")) {
      name = "OverconstrainedError";
    }
  }

  const isCancelled =
    rawLower.includes("permission denied by user") ||
    rawLower.includes("user cancelled") ||
    rawLower.includes("user canceled") ||
    rawLower.includes("aborted by user");

  return { name, message, isCancelled };
}

/**
 * Maps DOMException and runtime media errors into clean, human-readable Mingly messages.
 * Never leaks raw browser error strings like "The request is not allowed by the user agent...".
 */
export function formatMediaError(error: unknown, kind: MediaKind): string {
  const { name, message } = extractErrorDetails(error);
  const msgLower = message.toLowerCase();

  // Secure context requirement violations
  if (
    name === "SecurityError" ||
    msgLower.includes("secure context") ||
    msgLower.includes("insecure")
  ) {
    if (kind === "screen") {
      return tr("Screen sharing requires a secure HTTPS connection.");
    }
    return tr("Media access requires a secure HTTPS connection.");
  }

  // NotAllowedError (Permission denied, blocked, or dismiss)
  if (
    name === "NotAllowedError" ||
    msgLower.includes("not allowed by the user agent") ||
    msgLower.includes("permission denied") ||
    msgLower.includes("permissiondenied") ||
    msgLower.includes("dismissed")
  ) {
    switch (kind) {
      case "camera":
        return tr("Camera access was blocked.");
      case "mic":
        return tr("Microphone access was blocked.");
      case "screen":
        return tr("Screen sharing wasn’t allowed.");
      default:
        return tr("Media access was blocked.");
    }
  }

  // NotFoundError (Hardware not present)
  if (
    name === "NotFoundError" ||
    msgLower.includes("notfound") ||
    msgLower.includes("device not found") ||
    msgLower.includes("devicesnotfounderror")
  ) {
    switch (kind) {
      case "camera":
        return tr("No camera was found on your device.");
      case "mic":
        return tr("No microphone was found on your device.");
      case "screen":
        return tr("No display surface was found to share.");
      default:
        return tr("No media device was found.");
    }
  }

  // NotReadableError (Hardware in use by Zoom, Teams, or hardware lock)
  if (
    name === "NotReadableError" ||
    msgLower.includes("notreadable") ||
    msgLower.includes("trackstarterror") ||
    msgLower.includes("could not start") ||
    msgLower.includes("in use")
  ) {
    switch (kind) {
      case "camera":
        return tr("Camera is currently in use by another application.");
      case "mic":
        return tr("Microphone is currently in use by another application.");
      case "screen":
        return tr("Screen capture is currently unavailable.");
      default:
        return tr("Media device is currently in use by another application.");
    }
  }

  // AbortError
  if (name === "AbortError") {
    switch (kind) {
      case "camera":
        return tr("Camera request was aborted. Try again.");
      case "mic":
        return tr("Microphone request was aborted. Try again.");
      case "screen":
        return tr("Screen sharing was cancelled or aborted.");
      default:
        return tr("Media request was aborted. Try again.");
    }
  }

  // InvalidStateError
  if (name === "InvalidStateError") {
    switch (kind) {
      case "screen":
        return tr("Couldn’t start screen sharing. Try again.");
      case "camera":
        return tr("Camera is in an invalid state. Try again.");
      case "mic":
        return tr("Microphone is in an invalid state. Try again.");
      default:
        return tr("Media device is in an invalid state. Try again.");
    }
  }

  // OverconstrainedError
  if (name === "OverconstrainedError") {
    switch (kind) {
      case "camera":
        return tr("Camera does not meet requested video constraints.");
      case "mic":
        return tr("Microphone does not meet requested audio constraints.");
      default:
        return tr("Media constraints could not be satisfied.");
    }
  }

  // General fallbacks per kind
  switch (kind) {
    case "camera":
      return tr("Couldn’t access camera. Try again.");
    case "mic":
      return tr("Couldn’t access microphone. Try again.");
    case "screen":
      return tr("Couldn’t start screen sharing. Try again.");
    default:
      return tr("Media is currently unavailable. Try again.");
  }
}

/**
 * Formats LiveKit device failure callback codes into friendly messages.
 */
export function formatDeviceFailure(failure?: string, kind?: MediaKind): string {
  if (!failure) return tr("Media device is currently unavailable.");

  const lower = failure.toLowerCase();
  if (lower.includes("permissiondenied") || lower.includes("denied")) {
    if (kind === "camera") return tr("Camera access was blocked.");
    if (kind === "mic") return tr("Microphone access was blocked.");
    if (kind === "screen") return tr("Screen sharing wasn’t allowed.");
    return tr("Camera or microphone access was blocked.");
  }

  if (lower.includes("notfound")) {
    if (kind === "camera") return tr("No camera was found on your device.");
    if (kind === "mic") return tr("No microphone was found on your device.");
    return tr("No camera or microphone was found on your device.");
  }

  if (lower.includes("deviceinuse") || lower.includes("inuse")) {
    if (kind === "camera") return tr("Camera is currently in use by another application.");
    if (kind === "mic") return tr("Microphone is currently in use by another application.");
    return tr("Camera or microphone is currently in use by another application.");
  }

  return tr("Media device is currently unavailable.");
}
