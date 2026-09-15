import { useSfxStore } from "@/stores/useSfxStore";

export type SfxCue =
  | "mute" | "unmute" | "camera-on" | "camera-off"
  | "screen-start" | "screen-end" | "error"
  | "room-enter" | "participant-join" | "participant-leave"
  | "reconnect" | "disconnect" | "remove-from-room"
  | "host-transfer" | "raise-hand";

type SfxCategory = "ui" | "room";

export const sfxManifest: Record<SfxCue, { src: string; category: SfxCategory; gain: number }> = {
  mute: { src: "/sfx/mute.wav", category: "ui", gain: 0.5 },
  unmute: { src: "/sfx/unmute.wav", category: "ui", gain: 0.5 },
  "camera-on": { src: "/sfx/cam-on.wav", category: "ui", gain: 0.45 },
  "camera-off": { src: "/sfx/cam-off.wav", category: "ui", gain: 0.45 },
  "screen-start": { src: "/sfx/screen-start.wav", category: "ui", gain: 0.45 },
  "screen-end": { src: "/sfx/screen-end.wav", category: "ui", gain: 0.45 },
  error: { src: "/sfx/error.wav", category: "ui", gain: 0.35 },
  "room-enter": { src: "/sfx/room-enter.wav", category: "room", gain: 0.4 },
  "participant-join": { src: "/sfx/participant-join.wav", category: "room", gain: 0.35 },
  "participant-leave": { src: "/sfx/participant-leave.wav", category: "room", gain: 0.3 },
  reconnect: { src: "/sfx/reconnect.wav", category: "room", gain: 0.35 },
  disconnect: { src: "/sfx/disconnect.wav", category: "room", gain: 0.3 },
  "remove-from-room": { src: "/sfx/remove-from-room.wav", category: "room", gain: 0.35 },
  "host-transfer": { src: "/sfx/host-transfer.wav", category: "room", gain: 0.3 },
  "raise-hand": { src: "/sfx/raise-hand.wav", category: "room", gain: 0.3 },
};

type AudioLike = {
  volume: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
};

type AudioFactory = (src: string) => AudioLike;

export class SfxManager {
  private active = new Set<AudioLike>();
  private unlocked = false;

  constructor(private readonly createAudio: AudioFactory, private readonly maxVoices = 4) {}

  unlock() {
    this.unlocked = true;
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

export const sfx = new SfxManager((src) => new Audio(src));

export function unlockSfx() {
  sfx.unlock();
}

export function playSfx(cue: SfxCue) {
  sfx.play(cue);
}
