import { beforeEach, describe, expect, it } from "vitest";
import { useI18nStore } from "../../lib/i18n/useTranslation";
import {
  extractErrorDetails,
  formatDeviceFailure,
  formatMediaError,
  isSecureMediaContext,
} from "./mediaErrors";

describe("mediaErrors", () => {
  beforeEach(() => {
    useI18nStore.setState({ locale: "en" });
  });

  describe("extractErrorDetails", () => {
    it("extracts from DOMException NotAllowedError", () => {
      const err = new DOMException(
        "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
        "NotAllowedError",
      );
      const details = extractErrorDetails(err);
      expect(details.name).toBe("NotAllowedError");
      expect(details.message).toContain("not allowed by the user agent");
    });

    it("extracts from generic Error with NotAllowedError message", () => {
      const err = new Error(
        "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
      );
      const details = extractErrorDetails(err);
      expect(details.name).toBe("NotAllowedError");
    });

    it("detects user cancellation in screen share", () => {
      const err = new DOMException("Permission denied by user", "NotAllowedError");
      const details = extractErrorDetails(err);
      expect(details.isCancelled).toBe(true);
    });

    it("extracts from cause object if nested", () => {
      const cause = new DOMException("Requested device not found", "NotFoundError");
      const err = new Error("LiveKit device error", { cause });
      const details = extractErrorDetails(err);
      expect(details.name).toBe("NotFoundError");
    });
  });

  describe("formatMediaError (English)", () => {
    it("formats NotAllowedError for camera", () => {
      const err = new DOMException(
        "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
        "NotAllowedError",
      );
      expect(formatMediaError(err, "camera")).toBe("Camera access was blocked.");
    });

    it("formats NotAllowedError for microphone", () => {
      const err = new DOMException("Permission denied", "NotAllowedError");
      expect(formatMediaError(err, "mic")).toBe("Microphone access was blocked.");
    });

    it("formats NotAllowedError for screen sharing", () => {
      const err = new DOMException(
        "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
        "NotAllowedError",
      );
      expect(formatMediaError(err, "screen")).toBe("Screen sharing wasn’t allowed.");
    });

    it("formats NotFoundError for camera and mic", () => {
      const err = new DOMException("Requested device not found", "NotFoundError");
      expect(formatMediaError(err, "camera")).toBe("No camera was found on your device.");
      expect(formatMediaError(err, "mic")).toBe("No microphone was found on your device.");
      expect(formatMediaError(err, "screen")).toBe("No display surface was found to share.");
    });

    it("formats NotReadableError (device in use by Zoom/Teams)", () => {
      const err = new DOMException("Could not start video source", "NotReadableError");
      expect(formatMediaError(err, "camera")).toBe(
        "Camera is currently in use by another application.",
      );
      expect(formatMediaError(err, "mic")).toBe(
        "Microphone is currently in use by another application.",
      );
    });

    it("formats AbortError", () => {
      const err = new DOMException("The user aborted a request", "AbortError");
      expect(formatMediaError(err, "camera")).toBe("Camera request was aborted. Try again.");
      expect(formatMediaError(err, "mic")).toBe("Microphone request was aborted. Try again.");
      expect(formatMediaError(err, "screen")).toBe("Screen sharing was cancelled or aborted.");
    });

    it("formats InvalidStateError", () => {
      const err = new DOMException(
        "An attempt was made to request a display while another request was pending",
        "InvalidStateError",
      );
      expect(formatMediaError(err, "screen")).toBe("Couldn’t start screen sharing. Try again.");
      expect(formatMediaError(err, "camera")).toBe("Camera is in an invalid state. Try again.");
    });

    it("formats SecurityError / insecure origin", () => {
      const err = new DOMException("Only secure origins are allowed", "SecurityError");
      expect(formatMediaError(err, "camera")).toBe(
        "Media access requires a secure HTTPS connection.",
      );
      expect(formatMediaError(err, "screen")).toBe(
        "Screen sharing requires a secure HTTPS connection.",
      );
    });

    it("formats OverconstrainedError", () => {
      const err = new DOMException("Constraints could not be satisfied", "OverconstrainedError");
      expect(formatMediaError(err, "camera")).toBe(
        "Camera does not meet requested video constraints.",
      );
    });

    it("formats fallback errors without exposing raw browser message", () => {
      const err = new Error("Some internal proprietary browser error 0x80004005");
      expect(formatMediaError(err, "camera")).toBe("Couldn’t access camera. Try again.");
      expect(formatMediaError(err, "mic")).toBe("Couldn’t access microphone. Try again.");
      expect(formatMediaError(err, "screen")).toBe("Couldn’t start screen sharing. Try again.");
    });
  });

  describe("formatDeviceFailure", () => {
    it("formats PermissionDenied", () => {
      expect(formatDeviceFailure("PermissionDenied", "camera")).toBe(
        "Camera access was blocked.",
      );
      expect(formatDeviceFailure("PermissionDenied", "mic")).toBe(
        "Microphone access was blocked.",
      );
    });

    it("formats NotFound", () => {
      expect(formatDeviceFailure("NotFound", "camera")).toBe(
        "No camera was found on your device.",
      );
    });

    it("formats DeviceInUse", () => {
      expect(formatDeviceFailure("DeviceInUse", "mic")).toBe(
        "Microphone is currently in use by another application.",
      );
    });

    it("formats unknown failure code", () => {
      expect(formatDeviceFailure("UnknownFailure")).toBe(
        "Media device is currently unavailable.",
      );
    });
  });

  describe("Vietnamese localization", () => {
    it("translates errors when locale is vi", () => {
      useI18nStore.setState({ locale: "vi" });
      const err = new DOMException("Permission denied", "NotAllowedError");
      expect(formatMediaError(err, "camera")).toBe("Quyền truy cập camera đã bị chặn.");
      expect(formatMediaError(err, "mic")).toBe("Quyền truy cập micrô đã bị chặn.");
      expect(formatMediaError(err, "screen")).toBe("Chia sẻ màn hình không được phép.");
    });
  });

  describe("isSecureMediaContext", () => {
    it("returns boolean in test environment", () => {
      const res = isSecureMediaContext();
      expect(typeof res).toBe("boolean");
    });
  });
});
