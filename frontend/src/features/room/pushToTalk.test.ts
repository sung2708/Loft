import { describe, expect, it } from "vitest";
import { createLatestApplier, isPushToTalkKey } from "./pushToTalk";
import { levelFromSamples } from "./PreJoin";
import { parseMediaPreferences, defaultMediaPreferences } from "@/stores/useMediaPrefsStore";

const target = (match: boolean, isContentEditable = false) =>
  ({ isContentEditable, closest: () => (match ? {} : null) }) as unknown as EventTarget;

const key = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    code: "Space",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: target(false),
    ...overrides,
  }) as KeyboardEvent;

describe("isPushToTalkKey", () => {
  it("accepts a plain Space press outside text fields", () => {
    expect(isPushToTalkKey(key())).toBe(true);
  });

  it("ignores other keys and modifier chords", () => {
    expect(isPushToTalkKey(key({ code: "KeyM" }))).toBe(false);
    expect(isPushToTalkKey(key({ ctrlKey: true }))).toBe(false);
    expect(isPushToTalkKey(key({ metaKey: true }))).toBe(false);
  });

  it("never steals Space from text inputs or editable content", () => {
    expect(isPushToTalkKey(key({ target: target(true) }))).toBe(false);
    expect(isPushToTalkKey(key({ target: target(false, true) }))).toBe(false);
  });
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
const flush = () => new Promise((done) => setTimeout(done, 0));

describe("createLatestApplier", () => {
  it("serializes calls and applies only the latest desired state", async () => {
    const calls: boolean[] = [];
    const pending: ReturnType<typeof deferred>[] = [];
    const applier = createLatestApplier((enabled) => {
      calls.push(enabled);
      const next = deferred();
      pending.push(next);
      return next.promise;
    });

    applier.set(true, false);
    applier.set(false, false); // released while unmute is in flight
    applier.set(true, false); // pressed again
    expect(calls).toEqual([true]);

    pending[0].resolve();
    await flush();
    // Latest desired (true) already applied: no extra toggle.
    expect(calls).toEqual([true]);

    applier.set(false, true);
    await flush();
    expect(calls).toEqual([true, false]);
  });

  it("skips the call when the mic is already in the desired state", async () => {
    const calls: boolean[] = [];
    const applier = createLatestApplier(async (enabled) => {
      calls.push(enabled);
    });
    applier.set(true, true);
    await flush();
    expect(calls).toEqual([]);
  });

  it("stops retrying after a failed toggle", async () => {
    let attempts = 0;
    const applier = createLatestApplier(async () => {
      attempts += 1;
      throw new Error("denied");
    });
    applier.set(true, false);
    await flush();
    expect(attempts).toBe(1);
  });
});

describe("levelFromSamples", () => {
  it("is zero for silence and clamps loud input to one", () => {
    expect(levelFromSamples(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelFromSamples(new Uint8Array(64).fill(255))).toBe(1);
    expect(levelFromSamples(new Uint8Array())).toBe(0);
  });
});

describe("parseMediaPreferences", () => {
  it("falls back to defaults for missing or corrupt storage", () => {
    expect(parseMediaPreferences(null)).toEqual(defaultMediaPreferences);
    expect(parseMediaPreferences("{not json")).toEqual(defaultMediaPreferences);
  });

  it("drops values with the wrong type", () => {
    expect(
      parseMediaPreferences(
        JSON.stringify({ pushToTalk: "yes", audioDeviceId: 4, micOnJoin: false }),
      ),
    ).toEqual({ ...defaultMediaPreferences, micOnJoin: false });
  });

  it("keeps valid saved choices", () => {
    const saved = {
      audioDeviceId: "mic-1",
      videoDeviceId: "cam-2",
      audioOutputDeviceId: "speaker-3",
      micOnJoin: false,
      cameraOnJoin: true,
      pushToTalk: true,
      noiseFilter: false,
      screenShareMode: "motion" as const,
    };
    expect(parseMediaPreferences(JSON.stringify(saved))).toEqual(saved);
  });
});
