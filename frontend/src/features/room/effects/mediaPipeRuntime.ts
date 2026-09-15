import type { FaceLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";
import type { SegmentationMask, VisionRuntime } from "./runtimeContracts";

const WASM_ROOT = "/effects/wasm";
const SEGMENTER_MODEL = "/effects/models/selfie_segmenter.tflite";
const LANDMARK_MODEL = "/effects/models/face_landmarker.task";
const XNNPACK_INFO = "TensorFlow Lite XNNPACK delegate for CPU";
let logFilterDepth = 0;
let forwardedConsoleError: typeof console.error | undefined;

function isBenignMediaPipeInfo(args: ReadonlyArray<unknown>) {
  return args.some((value) => typeof value === "string" && value.includes(XNNPACK_INFO));
}

function filteredConsoleError(...args: unknown[]) {
  if (isBenignMediaPipeInfo(args)) return;
  const forward = forwardedConsoleError ?? console.error;
  if (forward !== filteredConsoleError) forward.apply(console, args);
}

async function initializeMediaPipe<T>(operation: () => Promise<T>): Promise<T> {
  if (logFilterDepth++ === 0) {
    forwardedConsoleError = console.error;
    console.error = filteredConsoleError;
  }
  try {
    return await operation();
  } finally {
    logFilterDepth--;
    if (logFilterDepth === 0) {
      if (console.error === filteredConsoleError && forwardedConsoleError) console.error = forwardedConsoleError;
      forwardedConsoleError = undefined;
    }
  }
}

export function runMediaPipeInference<T>(operation: () => T): T {
  const originalError = console.error;
  forwardedConsoleError ??= originalError;
  console.error = filteredConsoleError;
  try {
    return operation();
  } finally {
    console.error = originalError;
    if (logFilterDepth === 0) forwardedConsoleError = undefined;
  }
}

export class MediaPipeRuntime implements VisionRuntime {
  private segmenter?: ImageSegmenter;
  private landmarker?: FaceLandmarker;
  private segmentLoading?: Promise<ImageSegmenter>;
  private landmarkLoading?: Promise<FaceLandmarker>;
  private segmentBusy = false;
  private landmarkBusy = false;

  private async loadSegmenter() {
    if (this.segmenter) return this.segmenter;
    this.segmentLoading ??= initializeMediaPipe(async () => {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL, delegate: "GPU" },
        runningMode: "VIDEO", outputConfidenceMasks: false, outputCategoryMask: true,
      });
    });
    this.segmenter = await this.segmentLoading;
    return this.segmenter;
  }

  private async loadLandmarker() {
    if (this.landmarker) return this.landmarker;
    this.landmarkLoading ??= initializeMediaPipe(async () => {
      const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: LANDMARK_MODEL, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1,
      });
    });
    this.landmarker = await this.landmarkLoading;
    return this.landmarker;
  }

  async segment(source: TexImageSource, timestamp: number): Promise<SegmentationMask | undefined> {
    if (this.segmentBusy) return undefined;
    this.segmentBusy = true;
    try {
      const task = await this.loadSegmenter();
      const result = runMediaPipeInference(() => task.segmentForVideo(source, timestamp));
      const mask = result.categoryMask;
      if (!mask) return undefined;
      const data = Uint8Array.from(mask.getAsUint8Array(), (value) => value === 0 ? 0 : 255);
      const output = { data, width: mask.width, height: mask.height };
      result.close();
      return output;
    } finally { this.segmentBusy = false; }
  }

  async landmarks(source: TexImageSource, timestamp: number) {
    if (this.landmarkBusy) return undefined;
    this.landmarkBusy = true;
    try {
      const task = await this.loadLandmarker();
      const result = runMediaPipeInference(() => task.detectForVideo(source, timestamp));
      return result.faceLandmarks[0]?.map(({ x, y, z }) => ({ x, y, z }));
    } finally { this.landmarkBusy = false; }
  }

  closeSegmentation() { this.segmenter?.close(); this.segmenter = undefined; this.segmentLoading = undefined; }
  closeLandmarks() { this.landmarker?.close(); this.landmarker = undefined; this.landmarkLoading = undefined; }
  close() { this.closeSegmentation(); this.closeLandmarks(); }
}
