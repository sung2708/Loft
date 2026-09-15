import { Track, type TrackProcessor, type VideoProcessorOptions } from "livekit-client";
import { deriveCapabilities } from "./effectCapabilities";
import type { EffectSelection, QualityTier } from "./contracts";
import { DEFAULT_SELECTION } from "./contracts";
import { EffectCompositor } from "./compositor";
import { MediaPipeRuntime } from "./mediaPipeRuntime";
import { EffectPerformanceMonitor, TIER_CONFIG } from "./performanceMonitor";
import type { CustomBackgroundResource } from "./customBackground";
import type { SegmentationMask, VisionResult, VisionRuntime } from "./runtimeContracts";

export class MinglyVideoProcessor implements TrackProcessor<Track.Kind.Video, VideoProcessorOptions> {
  readonly name = "mingly-video-effects";
  processedTrack?: MediaStreamTrack;
  private source?: HTMLVideoElement;
  private canvas?: HTMLCanvasElement;
  private compositor?: EffectCompositor;
  private vision: VisionRuntime;
  private selection: EffectSelection = DEFAULT_SELECTION;
  private customBackground?: CustomBackgroundResource;
  private running = false;
  private frameHandle = 0;
  private mask?: SegmentationMask;
  private landmarks?: VisionResult["landmarks"];
  private lastInference = 0;
  private lastVideoTime = -1;
  private inferenceTurn: "segmentation" | "faceLandmarks" = "segmentation";
  private performanceFallbackReported = false;
  private reducedMotion = false;
  private monitor = new EffectPerformanceMonitor();
  private onFailure?: (capability: "segmentation" | "faceLandmarks" | "processor", error: unknown) => void;

  constructor(options?: { vision?: VisionRuntime; onFailure?: MinglyVideoProcessor["onFailure"] }) {
    this.vision = options?.vision ?? new MediaPipeRuntime();
    this.onFailure = options?.onFailure;
  }

  async init(options: VideoProcessorOptions) { this.start(options); }
  async restart(options: VideoProcessorOptions) { this.stopLoop(); this.start(options, true); }

  update(selection: EffectSelection, customBackground?: CustomBackgroundResource, reducedMotion = false) {
    const previous = deriveCapabilities(this.selection, this.reducedMotion);
    this.selection = selection; this.reducedMotion = reducedMotion;
    if (this.customBackground !== customBackground) this.customBackground?.dispose();
    this.customBackground = customBackground;
    const next = deriveCapabilities(selection, reducedMotion);
    if (previous.needsSegmentation && !next.needsSegmentation) { this.vision.closeSegmentation(); this.mask = undefined; }
    if (previous.needsFaceLandmarks && !next.needsFaceLandmarks) { this.vision.closeLandmarks(); this.landmarks = undefined; }
  }

  setTier(tier: QualityTier) { this.monitor.tier = tier; }

  async destroy() {
    this.stopLoop();
    this.vision.close();
    this.customBackground?.dispose(); this.customBackground = undefined;
    this.compositor?.destroy(); this.compositor = undefined;
    this.source = undefined;
    this.processedTrack?.stop(); this.processedTrack = undefined;
    this.canvas?.remove(); this.canvas = undefined;
  }

  private start(options: VideoProcessorOptions, restarting = false) {
    if (options.kind !== Track.Kind.Video) throw new TypeError("Video effects require a video track");
    this.source = options.element as HTMLVideoElement | undefined;
    if (!this.source) throw new Error("Missing camera source element");
    this.canvas ??= document.createElement("canvas");
    const context = this.canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context || typeof this.canvas.captureStream !== "function") throw new Error("unsupported");
    this.compositor ??= new EffectCompositor(this.canvas, context);
    const settings = options.track.getSettings();
    const high = TIER_CONFIG.high;
    const sourceWidth = settings.width ?? high.width;
    const sourceHeight = settings.height ?? high.height;
    const scale = Math.min(1, high.width / sourceWidth, high.height / sourceHeight);
    this.compositor.resize(Math.round(sourceWidth * scale), Math.round(sourceHeight * scale));
    if (!restarting || !this.processedTrack || this.processedTrack.readyState === "ended") {
      this.processedTrack?.stop();
      this.processedTrack = this.canvas.captureStream(30).getVideoTracks()[0];
    }
    this.running = true;
    this.schedule();
  }

  private schedule() {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame((time) => { void this.render(time).finally(() => this.schedule()); });
  }

  private async render(time: number) {
    if (!this.running || !this.source || !this.compositor || this.source.readyState < 2) return;
    const started = performance.now();
    const caps = deriveCapabilities(this.selection, this.reducedMotion);
    const tier = TIER_CONFIG[this.monitor.tier];
    if (this.monitor.tier === "off") {
      this.compositor.draw({ source: this.source, selection: DEFAULT_SELECTION, timestamp: time, reducedMotion: true });
      return;
    }
    const interval = 1000 / Math.max(1, tier.inferenceFps);
    const hasNewVideoFrame = this.source.currentTime !== this.lastVideoTime;
    if (hasNewVideoFrame && time - this.lastInference >= interval) {
      this.lastInference = time;
      this.lastVideoTime = this.source.currentTime;
      const jobs: Promise<void>[] = [];
      const runSegmentation = caps.needsSegmentation && (!caps.needsFaceLandmarks || this.inferenceTurn === "segmentation");
      const runLandmarks = caps.needsFaceLandmarks && (!caps.needsSegmentation || this.inferenceTurn === "faceLandmarks");
      if (caps.needsSegmentation && caps.needsFaceLandmarks) this.inferenceTurn = this.inferenceTurn === "segmentation" ? "faceLandmarks" : "segmentation";
      if (runSegmentation && !this.monitor.isCircuitOpen("segmentation")) jobs.push(this.vision.segment(this.source, time).then((mask) => { if (mask) this.mask = mask; this.monitor.recordSuccess("segmentation"); }).catch((error) => { if (this.monitor.recordFailure("segmentation")) this.mask = undefined; this.onFailure?.("segmentation", error); }));
      if (runLandmarks && !this.monitor.isCircuitOpen("faceLandmarks")) jobs.push(this.vision.landmarks(this.source, time).then((points) => { if (points) this.landmarks = points; this.monitor.recordSuccess("faceLandmarks"); }).catch((error) => { if (this.monitor.recordFailure("faceLandmarks")) this.landmarks = undefined; this.onFailure?.("faceLandmarks", error); }));
      await Promise.all(jobs);
    }
    this.compositor.draw({ source: this.source, selection: this.selection, mask: this.mask, landmarks: this.landmarks, customBackground: this.customBackground, timestamp: time, reducedMotion: this.reducedMotion });
    const nextTier = this.monitor.record(performance.now() - started);
    if (nextTier === "off" && !this.performanceFallbackReported) {
      this.performanceFallbackReported = true;
      this.mask = undefined;
      this.landmarks = undefined;
      this.vision.close();
      this.onFailure?.("processor", "performance");
    }
    const config = TIER_CONFIG[nextTier];
    if (config.width && this.canvas && (this.canvas.width !== config.width || this.canvas.height !== config.height)) this.compositor.resize(config.width, config.height);
  }

  private stopLoop() { this.running = false; if (this.frameHandle) cancelAnimationFrame(this.frameHandle); this.frameHandle = 0; }
}
