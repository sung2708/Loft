import { useSfxStore } from "@/stores/useSfxStore";
import { useMediaPrefsStore } from "@/stores/useMediaPrefsStore";

export type SfxCue =
  | "mute" | "unmute" | "camera-on" | "camera-off"
  | "screen-start" | "screen-end" | "error"
  | "room-enter" | "participant-join" | "participant-leave"
  | "reconnect" | "disconnect" | "remove-from-room"
  | "host-transfer" | "raise-hand";

type SfxCategory = "ui" | "room";

export const sfxManifest: Record<SfxCue, { src: string; category: SfxCategory; gain: number }> = {
  mute: { src: "/sfx/mute.mp3", category: "ui", gain: 0.9 },
  unmute: { src: "/sfx/unmute.mp3", category: "ui", gain: 0.9 },
  "camera-on": { src: "/sfx/cam-on.mp3", category: "ui", gain: 0.85 },
  "camera-off": { src: "/sfx/cam-off.mp3", category: "ui", gain: 0.85 },
  "screen-start": { src: "/sfx/screen-start.mp3", category: "ui", gain: 0.85 },
  "screen-end": { src: "/sfx/screen-end.mp3", category: "ui", gain: 0.85 },
  error: { src: "/sfx/error.mp3", category: "ui", gain: 0.8 },
  "room-enter": { src: "/sfx/room-enter.mp3", category: "room", gain: 0.85 },
  "participant-join": { src: "/sfx/participant-join.mp3", category: "room", gain: 0.8 },
  "participant-leave": { src: "/sfx/participant-leave.mp3", category: "room", gain: 0.75 },
  reconnect: { src: "/sfx/reconnect.mp3", category: "room", gain: 0.8 },
  disconnect: { src: "/sfx/disconnect.mp3", category: "room", gain: 0.75 },
  "remove-from-room": { src: "/sfx/remove-from-room.mp3", category: "room", gain: 0.8 },
  "host-transfer": { src: "/sfx/host-transfer.mp3", category: "room", gain: 0.8 },
  "raise-hand": { src: "/sfx/raise-hand.mp3", category: "room", gain: 0.8 },
};

type AudioLike = {
  volume: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
};

type AudioFactory = (src: string) => AudioLike;
type Warmer = (src: string) => void;

export class SfxManager {
  private active = new Set<AudioLike>();
  private unlocked = false;
  private warmed = false;

  constructor(
    private readonly createAudio: AudioFactory,
    private readonly maxVoices = 4,
    private readonly warm?: Warmer,
  ) {}

  unlock() {
    this.unlocked = true;
    this.preload();
  }

  /** Pulls every cue into the HTTP cache once so the first play has no network delay. */
  preload() {
    if (this.warmed || !this.warm) return;
    this.warmed = true;
    const sources = new Set(Object.values(sfxManifest).map((item) => item.src));
    for (const src of sources) {
      try {
        this.warm(src);
      } catch {
        // Warming is best effort.
      }
    }
  }

  play(cue: SfxCue) {
    const item = sfxManifest[cue];
    const preferences = useSfxStore.getState();
    if (!this.unlocked || preferences.volume <= 0 ||
        (item.category === "ui" && !preferences.soundEffectsEnabled) ||
        (item.category === "room" && !preferences.roomSoundsEnabled) ||
        this.active.size >= this.maxVoices) return;
    try {
      const audio = this.createAudio(item.src);
      audio.volume = (preferences.volume / 100) * item.gain;
      const done = () => this.active.delete(audio);
      audio.addEventListener("ended", done, { once: true });
      audio.addEventListener("error", done, { once: true });
      this.active.add(audio);
      void audio.play().catch(done);
    } catch {
      // SFX is optional presentation.
    }
  }

  stopAll() {
    for (const audio of this.active) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.active.clear();
  }

  get activeVoices() {
    return this.active.size;
  }
}

function warmSfx(src: string) {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const run = () => void fetch(src, { priority: "low" } as RequestInit).catch(() => undefined);
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (idle) idle(run);
  else window.setTimeout(run, 200);
}

/** Sound cues follow the speaker chosen on the pre-join screen. */
function createCueAudio(src: string) {
  const audio = new Audio(src) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  const output = useMediaPrefsStore.getState().audioOutputDeviceId;
  if (output && typeof audio.setSinkId === "function") {
    void audio.setSinkId(output).catch(() => undefined);
  }
  return audio;
}

export const sfx = new SfxManager(createCueAudio, 4, warmSfx);

export function preloadSfx() {
  sfx.preload();
}

export function unlockSfx() {
  sfx.unlock();
}

export function playSfx(cue: SfxCue) {
  sfx.play(cue);
}
