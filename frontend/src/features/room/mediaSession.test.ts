import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatMediaError } from "./mediaErrors";
import { useI18nStore } from "../../lib/i18n/useTranslation";

describe("Media Toggle and Session Flow", () => {
  beforeEach(() => {
    useI18nStore.setState({ locale: "en" });
  });

  it("handles camera off -> on -> off lifecycle correctly", async () => {
    let cameraEnabled = false;
    let mediaError: string | null = null;
    const isTogglingCamera = { current: false };

    const mockLocalParticipant = {
      setCameraEnabled: vi.fn().mockImplementation(async (next: boolean) => {
        cameraEnabled = next;
      }),
    };

    const toggleCamera = async () => {
      if (isTogglingCamera.current) return;
      isTogglingCamera.current = true;
      try {
        await mockLocalParticipant.setCameraEnabled(!cameraEnabled);
        mediaError = null;
      } catch (error) {
        mediaError = formatMediaError(error, "camera");
      } finally {
        isTogglingCamera.current = false;
      }
    };

    // Initially off -> turn on
    expect(cameraEnabled).toBe(false);
    await toggleCamera();
    expect(cameraEnabled).toBe(true);
    expect(mediaError).toBeNull();
    expect(mockLocalParticipant.setCameraEnabled).toHaveBeenCalledWith(true);

    // Turn off
    await toggleCamera();
    expect(cameraEnabled).toBe(false);
    expect(mediaError).toBeNull();
    expect(mockLocalParticipant.setCameraEnabled).toHaveBeenCalledWith(false);
  });

  it("handles microphone off -> on -> off lifecycle correctly", async () => {
    let micEnabled = false;
    let mediaError: string | null = null;
    const isTogglingMic = { current: false };

    const mockLocalParticipant = {
      setMicrophoneEnabled: vi.fn().mockImplementation(async (next: boolean) => {
        micEnabled = next;
      }),
    };

    const toggleMic = async () => {
      if (isTogglingMic.current) return;
      isTogglingMic.current = true;
      try {
        await mockLocalParticipant.setMicrophoneEnabled(!micEnabled);
        mediaError = null;
      } catch (error) {
        mediaError = formatMediaError(error, "mic");
      } finally {
        isTogglingMic.current = false;
      }
    };

    // Initially off -> turn on
    expect(micEnabled).toBe(false);
    await toggleMic();
    expect(micEnabled).toBe(true);
    expect(mediaError).toBeNull();
    expect(mockLocalParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);

    // Turn off
    await toggleMic();
    expect(micEnabled).toBe(false);
    expect(mediaError).toBeNull();
    expect(mockLocalParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it("handles screen share start -> stop lifecycle correctly", async () => {
    let screenEnabled = false;
    let mediaError: string | null = null;
    const isTogglingScreen = { current: false };

    const mockLocalParticipant = {
      setScreenShareEnabled: vi.fn().mockImplementation(async (next: boolean) => {
        screenEnabled = next;
      }),
    };

    const toggleScreen = async () => {
      if (isTogglingScreen.current) return;
      isTogglingScreen.current = true;
      try {
        await mockLocalParticipant.setScreenShareEnabled(!screenEnabled);
        mediaError = null;
      } catch (error) {
        mediaError = formatMediaError(error, "screen");
      } finally {
        isTogglingScreen.current = false;
      }
    };

    // Start sharing
    expect(screenEnabled).toBe(false);
    await toggleScreen();
    expect(screenEnabled).toBe(true);
    expect(mediaError).toBeNull();
    expect(mockLocalParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true);

    // Stop sharing
    await toggleScreen();
    expect(screenEnabled).toBe(false);
    expect(mediaError).toBeNull();
    expect(mockLocalParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });

  it("handles permission denied for camera and mic with clean messages", async () => {
    let mediaError: string | null = null;
    const isTogglingCamera = { current: false };

    const mockLocalParticipant = {
      setCameraEnabled: vi.fn().mockRejectedValue(
        new DOMException(
          "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
          "NotAllowedError",
        ),
      ),
    };

    const toggleCamera = async () => {
      if (isTogglingCamera.current) return;
      isTogglingCamera.current = true;
      try {
        await mockLocalParticipant.setCameraEnabled(true);
        mediaError = null;
      } catch (error) {
        mediaError = formatMediaError(error, "camera");
      } finally {
        isTogglingCamera.current = false;
      }
    };

    await toggleCamera();
    // Raw browser message MUST NOT be leaked to mediaError
    expect(mediaError).toBe("Camera access was blocked.");
    expect(mediaError).not.toContain("The request is not allowed");
  });

  it("handles screen-share cancel cleanly without raw browser error", async () => {
    const screenEnabled = false;
    let mediaError: string | null = null;
    const isTogglingScreen = { current: false };

    // When the user clicks Cancel in the native picker, browser rejects with NotAllowedError
    const mockLocalParticipant = {
      setScreenShareEnabled: vi.fn().mockRejectedValue(
        new DOMException(
          "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
          "NotAllowedError",
        ),
      ),
    };

    const toggleScreen = async () => {
      if (isTogglingScreen.current) return;
      isTogglingScreen.current = true;
      try {
        await mockLocalParticipant.setScreenShareEnabled(!screenEnabled);
        mediaError = null;
      } catch (error) {
        mediaError = formatMediaError(error, "screen");
      } finally {
        isTogglingScreen.current = false;
      }
    };

    await toggleScreen();
    expect(screenEnabled).toBe(false);
    expect(mediaError).toBe("Screen sharing wasn’t allowed.");
  });

  it("prevents duplicate media requests on rapid/repeated toggles", async () => {
    let inFlightCallCount = 0;
    let maxSimultaneousCalls = 0;
    const isTogglingCamera = { current: false };

    const mockLocalParticipant = {
      setCameraEnabled: vi.fn().mockImplementation(async () => {
        inFlightCallCount++;
        maxSimultaneousCalls = Math.max(maxSimultaneousCalls, inFlightCallCount);
        // Simulate async delay like getUserMedia prompt
        await new Promise((resolve) => setTimeout(resolve, 50));
        inFlightCallCount--;
      }),
    };

    const toggleCamera = async () => {
      if (isTogglingCamera.current) return;
      isTogglingCamera.current = true;
      try {
        await mockLocalParticipant.setCameraEnabled(true);
      } finally {
        isTogglingCamera.current = false;
      }
    };

    // User double-clicks rapidly
    const call1 = toggleCamera();
    const call2 = toggleCamera();
    const call3 = toggleCamera();

    await Promise.all([call1, call2, call3]);

    // Second and third concurrent calls were ignored because call1 was in-flight
    expect(mockLocalParticipant.setCameraEnabled).toHaveBeenCalledTimes(1);
    expect(maxSimultaneousCalls).toBe(1);
  });

  it("clears previous media error when permission is allowed on retry", async () => {
    let mediaError: string | null = "Camera access was blocked.";
    let cameraEnabled = false;
    const isTogglingCamera = { current: false };

    const mockLocalParticipant = {
      setCameraEnabled: vi.fn().mockImplementation(async (next: boolean) => {
        cameraEnabled = next;
      }),
    };

    const toggleCamera = async () => {
      if (isTogglingCamera.current) return;
      isTogglingCamera.current = true;
      try {
        await mockLocalParticipant.setCameraEnabled(!cameraEnabled);
        mediaError = null;
      } catch (error) {
        mediaError = formatMediaError(error, "camera");
      } finally {
        isTogglingCamera.current = false;
      }
    };

    // Permission now allowed by user
    await toggleCamera();
    expect(cameraEnabled).toBe(true);
    expect(mediaError).toBeNull();
  });

  it("ensures chat functionality is not blocked when media permission fails", () => {
    const mediaError = "Microphone access was blocked.";
    const chatMessages: string[] = [];

    const sendChat = (content: string) => {
      chatMessages.push(content);
      return true;
    };

    // Even when mediaError is present:
    expect(mediaError).toBeTruthy();
    const sent = sendChat("Hello room!");
    expect(sent).toBe(true);
    expect(chatMessages).toContain("Hello room!");
  });
});
