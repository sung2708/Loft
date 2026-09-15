import { beforeEach, describe, expect, it } from "vitest";
import { useVideoEffectsStore } from "./useVideoEffectsStore";

describe("video effects store", () => {
  beforeEach(() => useVideoEffectsStore.getState().reset());

  it("keeps desired selection separate from runtime truth", () => {
    useVideoEffectsStore.getState().setBackground("blur");
    expect(useVideoEffectsStore.getState().selection).toMatchObject({ background: "blur", generation: 1 });
    expect(useVideoEffectsStore.getState().runtime.status).toBe("inactive");
    useVideoEffectsStore.getState().setRuntime({ status: "loading" });
    expect(useVideoEffectsStore.getState().runtime.status).toBe("loading");
  });

  it("increments generations and clears custom IDs safely", () => {
    useVideoEffectsStore.getState().setBackground("custom", "local-id");
    useVideoEffectsStore.getState().setLook("warm");
    useVideoEffectsStore.getState().setBackground("none");
    expect(useVideoEffectsStore.getState().selection).toMatchObject({ generation: 3, background: "none", look: "warm", customBackgroundId: undefined });
  });
});
