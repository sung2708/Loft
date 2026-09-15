"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  type TrackReference,
  useLocalParticipant,
  useConnectionState,
  useRoomContext,
  useParticipants,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import { Track, ConnectionState, ConnectionQuality, LocalVideoTrack } from "livekit-client";
import { motion } from "framer-motion";
import { Hand, MicOff } from "lucide-react";
import { api } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import { LIVEKIT_URL } from "@/lib/config";
import { RoomSocket } from "@/lib/realtime";
import { useRoomStore } from "@/stores/useRoomStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUIStore } from "@/stores/useUIStore";
import { useMusicStore } from "@/stores/useMusicStore";
import { useReactionStore } from "@/stores/useReactionStore";
import { useSfxStore } from "@/stores/useSfxStore";
import { useVideoEffectsStore } from "@/stores/useVideoEffectsStore";
import { VideoEffectController } from "./effects/effectController";
import { playSfx, sfx, unlockSfx } from "@/lib/sfx";
import type { RoomCredential } from "@/types/api";
import { RoomView } from "./RoomView";
import { deriveStageLayout } from "./stageLayout";
import { translateUI, useUIText } from "@/lib/i18n/uiText";
import { useI18nStore } from "@/lib/i18n/useTranslation";
import {
  formatDeviceFailure,
  formatMediaError,
  isSecureMediaContext,
} from "./mediaErrors";
import { isFrontCameraSelfView } from "./cameraOrientation";

const currentText = (english: string) => translateUI(useI18nStore.getState().locale, english);

interface SessionValue {
  mediaConnected: boolean;
  sendChat: (content: string) => boolean;
  sendCommand: (
    type:
      | "queue.add"
      | "queue.next"
      | "queue.select"
      | "queue.remove"
      | "queue.clear"
      | "queue.shuffle"
      | "queue.reorder"
      | "media.play"
      | "media.pause"
      | "media.seek"
      | "media.duration"
      | "media.repeat"
      | "reaction.send"
      | "wave.send"
      | "participant.hand.set"
      | "room.lock"
      | "participant.kick"
      | "participant.ban"
      | "host.transfer",
    payload: object,
  ) => boolean;
  leave: () => void;
  mediaError: string | null;
  clearMediaError: () => void;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreen: () => Promise<void>;
}

const noMedia = async () => undefined;
const SessionContext = createContext<SessionValue>({
  mediaConnected: false,
  sendChat: () => false,
  sendCommand: () => false,
  leave: () => undefined,
  mediaError: null,
  clearMediaError: () => undefined,
  micEnabled: false,
  cameraEnabled: false,
  screenEnabled: false,
  toggleMic: noMedia,
  toggleCamera: noMedia,
  toggleScreen: noMedia,
});
export const useRoomSession = () => useContext(SessionContext);

export function RoomSession({ credential }: { credential: RoomCredential }) {
  const socketRef = useRef<RoomSocket | null>(null);
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const activeDrawer = useUIStore((state) => state.activeDrawer);
  const connectionState = useRoomStore((state) => state.connectionState);
  const enteredRoom = useRef(false);
  const previousConnectionState = useRef(connectionState);

  useEffect(() => {
    useSfxStore.getState().hydrate();
    const unlock = () => unlockSfx();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      sfx.stopAll();
    };
  }, []);

  useEffect(() => {
    const previous = previousConnectionState.current;
    if (connectionState === "RECONNECTING" && previous === "CONNECTED") playSfx("disconnect");
    if (connectionState === "CONNECTED" && (previous === "RECONNECTING" || previous === "RESYNCING")) playSfx("reconnect");
    previousConnectionState.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    let disposed = false;
    let mediaRequested = false;
    let currentCredential = credential;
    const socket = new RoomSocket(credential, {
      getCredential: async () => {
        if (credential.type === "user") {
          const session = (await getSupabase()?.auth.getSession())?.data.session;
          if (!session) throw new Error("Sign in again to reconnect.");
          currentCredential = { ...credential, token: session.access_token };
        }
        return currentCredential;
      },
      onState: (state, error) => {
        if (state === "FAILED" && error && (error.includes("removed") || error.includes("rejoin"))) {
          playSfx("remove-from-room");
        }
        useRoomStore.getState().setConnectionState(state, error);
      },
      onEvent: (event) => {
        if (event.type === "room.snapshot") {
          useRoomStore.getState().applySnapshot(event.payload);
          useChatStore.getState().replace(event.payload.messages);
          useMusicStore.getState().replaceMedia(event.payload.media);
          if (!enteredRoom.current) {
            enteredRoom.current = true;
            playSfx("room-enter");
          }
          // Admission must succeed before a second tab can connect to LiveKit
          // with the same identity and displace the active participant.
          if (!mediaRequested) {
            mediaRequested = true;
            void api.liveKitToken(credential.roomId, currentCredential)
              .then(({ token }) => { if (!disposed) setLiveKitToken(token); })
              .catch(() => {
                mediaRequested = false;
                if (!disposed) setMediaError(currentText("Unable to connect to media server."));
              });
          }
        } else if (event.type === "participant.joined") {
          useRoomStore.getState().participantJoined(event.payload);
          playSfx("participant-join");
        }
        else if (event.type === "participant.left") {
          useRoomStore.getState().participantLeft(event.payload.connection_id);
          playSfx("participant-leave");
        }
        else if (event.type === "host.changed") {
          useRoomStore.getState().hostChanged(event.payload.host);
          playSfx("host-transfer");
        }
        else if (event.type === "room.locked")
          useRoomStore.getState().roomLocked(event.payload.locked, event.payload.version);
        else if (event.type === "chat.message")
          useChatStore
            .getState()
            .append(
              event.payload,
              useUIStore.getState().activeDrawer === "chat",
            );
        else if (event.type === "media.state")
          useMusicStore.getState().setMedia(event.payload);
        else if (event.type === "connection.pong" && event.payload.client_time > 0)
          useMusicStore.getState().setClockOffset(event.payload.server_time - (event.payload.client_time + Date.now()) / 2);
        else if (event.type === "reaction.sent") {
          useReactionStore.getState().append({ displayName: event.payload.display_name, emoji: event.payload.emoji });
        }
        else if (event.type === "wave.sent") {
          useReactionStore.getState().appendWave(event.payload.display_name);
        }
        else if (event.type === "participant.hand_changed") {
          useRoomStore.getState().handChanged(event.payload.connection_id, event.payload.raised, event.payload.social_version);
          if (event.payload.raised) playSfx("raise-hand");
        }
        else if (event.type === "error") {
          if (event.payload.code === "MEDIA_COMMAND_REJECTED" || event.payload.code === "MEDIA_RATE_LIMITED") useMusicStore.getState().setError(event.payload.message);
          else if (event.payload.code === "ROOM_COMMAND_REJECTED") useRoomStore.getState().setGovernanceError(event.payload.message);
          else if (event.payload.code === "REACTION_RATE_LIMITED" || event.payload.code === "WAVE_RATE_LIMITED") return;
          else useChatStore.getState().setSendError(event.payload.message);
        }
      },
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      disposed = true;
      socket.close();
      socketRef.current = null;
      useRoomStore.getState().reset();
      useChatStore.getState().reset();
      useMusicStore.getState().reset();
      useReactionStore.getState().reset();
      enteredRoom.current = false;
    };
  }, [credential]);

  useEffect(() => {
    if (activeDrawer === "chat") useChatStore.getState().clearUnread();
  }, [activeDrawer]);
  const sendChat = useCallback((content: string) => {
    useChatStore.getState().setSendError(null);
    const sent = socketRef.current?.send("chat.send", { content }) ?? false;
    if (!sent)
      useChatStore
        .getState()
        .setSendError(currentText("Still reconnecting. Try again in a moment."));
    return sent;
  }, []);
  const sendCommand: SessionValue["sendCommand"] = useCallback((type, payload) => {
    const sent = socketRef.current?.send(type, payload) ?? false;
    if (!sent) {
      if (type === "room.lock" || type === "participant.kick" || type === "participant.ban" || type === "host.transfer") {
        useRoomStore.getState().setGovernanceError(currentText("Still reconnecting. Try again shortly."));
      } else if (type !== "reaction.send" && type !== "wave.send" && type !== "participant.hand.set") {
        useMusicStore.getState().setError(currentText("Still reconnecting. Try again shortly."));
      }
    }
    return sent;
  }, []);
  const leave = useCallback(() => {
    socketRef.current?.close(true);
    window.location.assign("/");
  }, []);

  // A kicked or otherwise permanently rejected application session must also
  // tear down the LiveKit tree. Keeping the media provider mounted while the
  // WebSocket is FAILED leaves the removed participant's audio/video alive and
  // makes the kick appear to have had no effect until a full page reload.
  if (liveKitToken && connectionState !== "FAILED" && LIVEKIT_URL) {
    return (
      <LiveKitRoom
        token={liveKitToken}
        serverUrl={LIVEKIT_URL}
        connect
        audio={false}
        video={false}
        options={{
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: { width: 1280, height: 720, frameRate: 30 },
          },
          publishDefaults: {
            simulcast: true,
            degradationPreference: "maintain-framerate",
          },
        }}
        onError={(error) => setMediaError(formatMediaError(error, "general"))}
        onMediaDeviceFailure={(failure) =>
          setMediaError(formatDeviceFailure(failure))
        }
      >
        <LiveMediaContext
          sendChat={sendChat}
          sendCommand={sendCommand}
          leave={leave}
          mediaError={mediaError}
          setMediaError={setMediaError}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    );
  }
  const value: SessionValue = {
    mediaConnected: false,
    sendChat,
    sendCommand,
    leave,
    mediaError,
    clearMediaError: () => setMediaError(null),
    micEnabled: false,
    cameraEnabled: false,
    screenEnabled: false,
    toggleMic: noMedia,
    toggleCamera: noMedia,
    toggleScreen: noMedia,
  };
  return (
    <SessionContext.Provider value={value}>
      <RoomView />
    </SessionContext.Provider>
  );
}

function LiveMediaContext({
  sendChat,
  sendCommand,
  leave,
  mediaError,
  setMediaError,
}: Pick<SessionValue, "sendChat" | "sendCommand" | "leave" | "mediaError"> & {
  setMediaError: (message: string | null) => void;
}) {
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();
  const connectionState = useConnectionState();
  const liveRoom = useRoomContext();
  const initialized = useRef(false);
  const isTogglingMic = useRef(false);
  const isTogglingCamera = useRef(false);
  const isTogglingScreen = useRef(false);
  const effectSelection = useVideoEffectsStore((state) => state.selection);
  const effectController = useRef<VideoEffectController | null>(null);

  useEffect(() => {
    const controller = new VideoEffectController((runtime) => useVideoEffectsStore.getState().setRuntime(runtime));
    effectController.current = controller;
    return () => {
      effectController.current = null;
      void controller.destroy();
      useVideoEffectsStore.getState().reset();
    };
  }, []);

  useEffect(() => {
    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    const source = publication?.track instanceof LocalVideoTrack && isCameraEnabled ? publication.track : undefined;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    void effectController.current?.reconcile(source, effectSelection, reducedMotion);
  }, [localParticipant, isCameraEnabled, connectionState, effectSelection]);

  useEffect(() => {
    const reconcileVisibility = () => {
      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const source = !document.hidden && publication?.track instanceof LocalVideoTrack && isCameraEnabled ? publication.track : undefined;
      void effectController.current?.reconcile(source, useVideoEffectsStore.getState().selection, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    };
    document.addEventListener("visibilitychange", reconcileVisibility);
    return () => document.removeEventListener("visibilitychange", reconcileVisibility);
  }, [localParticipant, isCameraEnabled]);

  useEffect(() => {
    if (initialized.current || connectionState !== ConnectionState.Connected) return;
    initialized.current = true;
    if (!isSecureMediaContext()) {
      sessionStorage.removeItem("loft.room.media");
      return;
    }
    try {
      const preferences = JSON.parse(
        sessionStorage.getItem("loft.room.media") ?? "{}",
      ) as { mic?: boolean; camera?: boolean };
      if (preferences.mic) {
        void localParticipant.setMicrophoneEnabled(true).catch((error) => {
          sessionStorage.removeItem("loft.room.media");
          setMediaError(formatMediaError(error, "mic"));
        });
      }
      if (preferences.camera) {
        void localParticipant.setCameraEnabled(true).catch((error) => {
          sessionStorage.removeItem("loft.room.media");
          setMediaError(formatMediaError(error, "camera"));
        });
      }
    } catch {
      /* use safe media defaults */
    }
  }, [localParticipant, connectionState, setMediaError]);

  const value = useMemo<SessionValue>(
    () => ({
      mediaConnected: connectionState === ConnectionState.Connected,
      sendChat,
      sendCommand,
      leave: () => { void liveRoom.disconnect().then(leave, leave); },
      mediaError,
      clearMediaError: () => setMediaError(null),
      micEnabled: isMicrophoneEnabled,
      cameraEnabled: isCameraEnabled,
      screenEnabled: isScreenShareEnabled,
      toggleMic: async () => {
        if (isTogglingMic.current) return;
        isTogglingMic.current = true;
        try {
          if (!isMicrophoneEnabled && !isSecureMediaContext()) {
            setMediaError(
              formatMediaError(
                new DOMException("Insecure context", "SecurityError"),
                "mic",
              ),
            );
            return;
          }
          await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
          playSfx(isMicrophoneEnabled ? "mute" : "unmute");
          setMediaError(null);
        } catch (error) {
          setMediaError(formatMediaError(error, "mic"));
        } finally {
          isTogglingMic.current = false;
        }
      },
      toggleCamera: async () => {
        if (isTogglingCamera.current) return;
        isTogglingCamera.current = true;
        try {
          if (!isCameraEnabled && !isSecureMediaContext()) {
            setMediaError(
              formatMediaError(
                new DOMException("Insecure context", "SecurityError"),
                "camera",
              ),
            );
            return;
          }
          await localParticipant.setCameraEnabled(!isCameraEnabled);
          playSfx(isCameraEnabled ? "camera-off" : "camera-on");
          setMediaError(null);
        } catch (error) {
          setMediaError(formatMediaError(error, "camera"));
        } finally {
          isTogglingCamera.current = false;
        }
      },
      toggleScreen: async () => {
        if (isTogglingScreen.current) return;
        isTogglingScreen.current = true;
        try {
          if (!isScreenShareEnabled && !isSecureMediaContext()) {
            setMediaError(
              formatMediaError(
                new DOMException("Insecure context", "SecurityError"),
                "screen",
              ),
            );
            return;
          }
          await localParticipant.setScreenShareEnabled(!isScreenShareEnabled, {
            audio: true,
            contentHint: "detail",
            resolution: { width: 1920, height: 1080, frameRate: 15 },
          }, {
            degradationPreference: "maintain-resolution",
          });
          playSfx(isScreenShareEnabled ? "screen-end" : "screen-start");
          setMediaError(null);
        } catch (error) {
          setMediaError(formatMediaError(error, "screen"));
        } finally {
          isTogglingScreen.current = false;
        }
      },
    }),
    [
      sendChat,
      connectionState,
      liveRoom,
      sendCommand,
      leave,
      mediaError,
      localParticipant,
      isMicrophoneEnabled,
      isCameraEnabled,
      isScreenShareEnabled,
      setMediaError,
    ],
  );
  return (
    <SessionContext.Provider value={value}>
      <RoomView />
    </SessionContext.Provider>
  );
}

export function MediaStage() {
  const tr = useUIText();
  const participants = useRoomStore((state) => state.participants);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const mediaParticipants = useParticipants();
  const tracks = useTracks([Track.Source.ScreenShare, Track.Source.Camera], {
    onlySubscribed: false,
  });
  const publishedTracks = tracks.filter((track): track is TrackReference =>
    Boolean(track.publication && !track.publication.isMuted),
  );
  const screen = publishedTracks.find(
    (track) => track.source === Track.Source.ScreenShare,
  );
  const cameras = publishedTracks.filter(
    (track) => track.source === Track.Source.Camera,
  );
  const cameraFor = (identity: string) =>
    cameras.find((track) => track.participant.identity === identity);
  const isSpeaking = (identity: string) =>
    Boolean(
      mediaParticipants.find((item) => item.identity === identity)?.isSpeaking,
    );
  const isMuted = (identity: string) => {
    const p = mediaParticipants.find((item) => item.identity === identity);
    return p ? !p.isMicrophoneEnabled : true;
  };
  const qualityFor = (identity: string) =>
    mediaParticipants.find((item) => item.identity === identity)?.connectionQuality ?? ConnectionQuality.Unknown;
  const layout = deriveStageLayout(
    participants.length,
    Boolean(screen),
    stageSize.width,
    stageSize.height,
  );
  return (
    <div ref={stageRef} className="w-full h-full min-h-0 p-3 sm:p-6">
      {layout.mode === "screen-share" && screen ? (
        <div className="w-full h-full min-h-0 flex flex-col gap-3">
        <div className="flex-1 min-h-0 rounded-2xl overflow-hidden bg-black shadow-2xl">
          <VideoTrack
            trackRef={screen}
            className="w-full h-full object-contain"
          />
        </div>
        <div className="text-xs text-center text-[var(--text-loft-secondary)]">
          {screen.participant.name || screen.participant.identity} {tr("is sharing")}
        </div>
        <div
          className="flex-none min-h-20 overflow-x-auto flex gap-2 pb-1"
          aria-label={tr("Room participants")}
        >
          {participants.map((participant) => {
            const camera = cameraFor(participant.livekit_identity);
            return (
              <ParticipantMediaTile
                key={participant.connection_id}
                name={participant.display_name}
                avatarUrl={participant.avatar_url}
                compact
                speaking={isSpeaking(participant.livekit_identity)}
                muted={isMuted(participant.livekit_identity)}
                quality={qualityFor(participant.livekit_identity)}
                camera={camera}
                raisedHand={participant.raised_hand ?? false}
              />
            );
          })}
        </div>
        </div>
      ) : layout.mode === "empty" ? (
        <EmptyStage />
      ) : (
        <motion.div
          layout
          transition={{ duration: 0.22 }}
          className="w-full h-full min-h-0 grid gap-3 overflow-y-auto"
          style={{
            gridTemplateColumns: `repeat(${layout.mode === "grid" ? layout.columns : 1}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.mode === "grid" ? layout.rows : 1}, minmax(150px, 1fr))`,
          }}
        >
          {participants.map((participant) => (
            <ParticipantMediaTile
              key={participant.connection_id}
              name={participant.display_name}
              avatarUrl={participant.avatar_url}
              solo={layout.mode === "solo"}
              speaking={isSpeaking(participant.livekit_identity)}
              muted={isMuted(participant.livekit_identity)}
              quality={qualityFor(participant.livekit_identity)}
              camera={cameraFor(participant.livekit_identity)}
              raisedHand={participant.raised_hand ?? false}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}

function ParticipantMediaTile({
  name,
  avatarUrl,
  compact = false,
  solo = false,
  speaking,
  muted = false,
  quality,
  camera,
  raisedHand = false,
}: {
  name: string;
  avatarUrl?: string;
  compact?: boolean;
  solo?: boolean;
  speaking: boolean;
  muted?: boolean;
  quality: ConnectionQuality;
  camera: TrackReference | undefined;
  raisedHand?: boolean;
}) {
  const tr = useUIText();
  const [avatarSize, setAvatarSize] = useState(compact ? 44 : 88);
  const [avatarFailed, setAvatarFailed] = useState(false);
  return (
    <motion.div
      layout
      transition={{ duration: 0.22 }}
      className={`${compact ? "w-32 h-20 shrink-0" : "w-full h-full min-w-0 min-h-0"} rounded-2xl overflow-hidden bg-[var(--bg-loft-card)] shadow-lg relative border-2 transition-shadow duration-150 ${speaking ? "border-[#34c759] speaking-glow" : "border-transparent"}`}
    >
      {raisedHand && (
        <span
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-[#FF9500]/90 px-2 py-1 text-[10px] font-semibold text-black shadow"
          aria-label={tr("Hand raised")}
          title={tr("Hand raised")}
        >
          <Hand className="h-3 w-3" aria-hidden="true" />
          {!compact && tr("Raised")}
        </span>
      )}
      {camera ? (
        <VideoTrack
          trackRef={camera}
          className={`w-full h-full object-cover ${isFrontCameraSelfView(camera) ? "-scale-x-100" : ""}`}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#0066CC]/10">
          {avatarUrl && !avatarFailed ? (
            <img
              src={avatarUrl}
              alt={`${name} avatar`}
              width={128}
              height={128}
              onLoad={(event) => {
                const intrinsic = event.currentTarget.naturalWidth;
                if (intrinsic > 0) {
                  setAvatarSize(Math.min(128, Math.max(1, Math.floor(intrinsic / window.devicePixelRatio))));
                }
              }}
              onError={() => setAvatarFailed(true)}
              style={{ width: compact ? Math.min(48, avatarSize) : avatarSize, height: compact ? Math.min(48, avatarSize) : avatarSize }}
              className="max-w-[40%] max-h-[65%] rounded-full object-cover shrink-0"
            />
          ) : (
            <span className={`${compact ? "w-10 h-10 text-sm" : solo ? "w-24 h-24 text-3xl" : "w-16 h-16 text-xl"} rounded-full bg-[#0066CC]/20 text-[#0066CC] flex items-center justify-center font-semibold shrink-0`}>
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          {solo && (
            <div className="text-center min-w-0 px-3">
              <div className="font-semibold text-base truncate flex items-center justify-center gap-1.5">
                <span>{name}</span>
                {muted && (
                  <span title={tr("Muted")} className="inline-flex">
                    <MicOff className="w-3.5 h-3.5 text-[#FF3B30] shrink-0" />
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--text-loft-secondary)] mt-0.5">{tr("Camera off")}</div>
            </div>
          )}
        </div>
      )}
      {(!solo || camera) && (
        <div className="absolute left-2 bottom-2 max-w-[calc(100%-1rem)] flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-xs text-white text-xs">
          {muted && (
            <span title={tr("Muted")} className="inline-flex">
              <MicOff className="w-3 h-3 text-[#FF3B30] shrink-0" />
            </span>
          )}
          <span className="truncate">{name}</span>
          <span aria-label={`Connection quality: ${quality}`} className={`w-2 h-2 rounded-full ${quality === ConnectionQuality.Excellent ? "bg-[#34c759]" : quality === ConnectionQuality.Good ? "bg-[#ff9500]" : quality === ConnectionQuality.Poor ? "bg-[#ff3b30]" : "bg-white/40"}`} />
        </div>
      )}
    </motion.div>
  );
}

export function EmptyStage() {
  const tr = useUIText();
  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <div className="glass-card rounded-3xl p-8 sm:p-12 text-center max-w-lg">
        <div className="mx-auto w-16 h-16 rounded-full bg-[#0066CC]/15 flex items-center justify-center text-2xl mb-4">
          ⌁
        </div>
        <h2 className="text-xl font-semibold mb-2">{tr("Room is ready")}</h2>
        <p className="text-sm text-[var(--text-loft-secondary)]">
          {tr("Turn on camera, share screen, or settle in with voice. You’re here together.")}
        </p>
      </div>
    </div>
  );
}
