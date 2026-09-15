import type { LocalVideoTrack } from "livekit-client";
import { deriveCapabilities, detectEffectCapabilities } from "./effectCapabilities";
import { MinglyVideoProcessor } from "./effectProcessor";
import { getCustomBackground, disposeCustomBackgrounds } from "./customBackground";
import type { EffectSelection, ProcessorRuntime } from "./contracts";
import { DEFAULT_RUNTIME } from "./contracts";

export class VideoEffectController {
  private generation = 0;
  private disposed = false;
  private source?: LocalVideoTrack;
  private processor?: MinglyVideoProcessor;
  private chain: Promise<void> = Promise.resolve();
  private paused = false;

  constructor(private report: (runtime: Partial<ProcessorRuntime>) => void) {}

  reconcile(source: LocalVideoTrack | undefined, selection: EffectSelection, reducedMotion = false) {
    const generation = ++this.generation;
    this.chain = this.chain.then(() => this.apply(generation, source, selection, reducedMotion)).catch(() => undefined);
    return this.chain;
  }

  setPaused(paused: boolean, selection: EffectSelection) {
    this.paused = paused;
    return this.reconcile(paused ? undefined : this.source, selection);
  }

  async destroy() {
    this.disposed = true; ++this.generation;
    await this.chain;
    const source = this.source;
    if (source?.getProcessor()) await source.stopProcessor();
    await this.processor?.destroy();
    this.processor = undefined; this.source = undefined;
    disposeCustomBackgrounds();
    this.report({ ...DEFAULT_RUNTIME, disposed: true });
  }

  private async apply(generation: number, source: LocalVideoTrack | undefined, selection: EffectSelection, reducedMotion: boolean) {
    if (this.disposed || generation !== this.generation) return;
    const required = deriveCapabilities(selection, reducedMotion);
    const supported = detectEffectCapabilities();
    if (!source || this.paused || !required.needsProcessor || !supported.processor) {
      if (this.source?.getProcessor()) await this.source.stopProcessor();
      if (this.disposed || generation !== this.generation) return;
      this.processor = undefined;
      this.source = source;
      this.report({ status: !supported.processor && required.needsProcessor ? "unavailable" : "inactive", ownedGeneration: generation, sourceTrackId: source?.mediaStreamTrack.id, processedTrackId: undefined, lastFallbackReason: !supported.processor && required.needsProcessor ? "unsupported" : undefined });
      return;
    }

    this.report({ status: "loading", ownedGeneration: generation, sourceTrackId: source.mediaStreamTrack.id });
    const changedSource = this.source !== source;
    if (changedSource && this.source?.getProcessor()) await this.source.stopProcessor();
    if (this.disposed || generation !== this.generation) return;
    this.source = source;
    this.processor ??= new MinglyVideoProcessor({ onFailure: (capability) => {
      this.report({ status: "fallback", lastFallbackReason: capability === "processor" ? "runtime" : "runtime" });
    } });
    this.processor.update(selection, getCustomBackground(selection.customBackgroundId), reducedMotion);
    try {
      if (source.getProcessor() !== this.processor) await source.setProcessor(this.processor, true);
      if (this.disposed || generation !== this.generation || this.source !== source) return;
      this.report({ status: "active", ownedGeneration: generation, sourceTrackId: source.mediaStreamTrack.id, processedTrackId: this.processor.processedTrack?.id, disposed: false });
    } catch {
      if (source.getProcessor()) await source.stopProcessor().catch(() => undefined);
      if (this.disposed || generation !== this.generation) return;
      this.processor = undefined;
      this.report({ status: "fallback", lastFallbackReason: "initialization", processedTrackId: undefined });
    }
  }
}
