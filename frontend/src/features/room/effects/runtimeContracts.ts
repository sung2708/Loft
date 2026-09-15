import type { LocalVideoTrack, Track, TrackProcessor, VideoProcessorOptions } from "livekit-client";
import type { EffectSelection, ProcessorRuntime, QualityTier } from "./contracts";

export interface FrameScheduler {
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

export interface SegmentationMask {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface VisionResult {
  mask?: SegmentationMask;
  landmarks?: ReadonlyArray<{ x: number; y: number; z?: number }>;
}

export interface VisionRuntime {
  segment(source: TexImageSource, timestamp: number): Promise<SegmentationMask | undefined>;
  landmarks(source: TexImageSource, timestamp: number): Promise<VisionResult["landmarks"]>;
  closeSegmentation(): void;
  closeLandmarks(): void;
  close(): void;
}

export interface ProcessorView {
  selection: EffectSelection;
  runtime: ProcessorRuntime;
}

export interface EffectProcessorHost {
  setProcessor(processor: TrackProcessor<Track.Kind.Video, VideoProcessorOptions>, showProcessedStreamLocally?: boolean): Promise<void>;
  stopProcessor(keepElement?: boolean): Promise<void>;
  getProcessor(): TrackProcessor<Track.Kind.Video, VideoProcessorOptions> | undefined;
}

export interface ControllerSnapshot {
  selection: EffectSelection;
  runtime: ProcessorRuntime;
  source?: LocalVideoTrack;
  reducedMotion: boolean;
  tier: QualityTier;
}
