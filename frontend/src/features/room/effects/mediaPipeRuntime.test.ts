import { afterEach, describe, expect, it, vi } from "vitest";
import { runMediaPipeInference } from "./mediaPipeRuntime";

describe("runMediaPipeInference", () => {
  afterEach(() => vi.restoreAllMocks());

  it("suppresses only the benign XNNPACK initialization message", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    runMediaPipeInference(() => {
      console.error("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.");
      console.error("real inference error");
    });

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("real inference error");
  });

  it("matches formatted MediaPipe messages even when the prefix is a separate argument", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    runMediaPipeInference(() => {
      console.error("INFO:", "Created TensorFlow Lite XNNPACK delegate for CPU.");
    });

    expect(error).not.toHaveBeenCalled();
  });

  it("restores console.error when inference throws", () => {
    const original = console.error;

    expect(() => runMediaPipeInference(() => { throw new Error("failed"); })).toThrow("failed");
    expect(console.error).toBe(original);
  });
});
