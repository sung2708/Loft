"use client";

import { finishRoomCapture, stopPublishedTracks } from "./roomCapture";
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
import { Track, ConnectionState, ConnectionQuality, RoomEvent } from "livekit-client";
import {
  finishCallStats,
  noteCallReconnect,
  sampleCallQuality,
  startCallStats,
  type QualitySample,
} from "@/lib/callStats";
import { motion } from "framer-motion";
import { Hand, MicOff } from "lucide-react";
import { api, clearCredential } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LIVEKIT_URL } from "@/lib/config";
import { RoomSocket } from "@/lib/realtime";
import { useRoomStore } from "@/stores/useRoomStore";
import { useBoardStore } from "@/stores/useBoardStore";
import { useChatStore } from "@/stores/useChatStore";
import { useUIStore } from "@/stores/useUIStore";
import { useMusicStore } from "@/stores/useMusicStore";
import { useYouTubePicksStore } from "@/stores/useYouTubePicksStore";
import { useReactionStore } from "@/stores/useReactionStore";
import { useSfxStore } from "@/stores/useSfxStore";
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
import { hasActiveScreenShare } from "./screenShare";
import { ScreenShareViewport } from "./ScreenShareViewport";
import type { RoomCommandType } from "@/types/room";
import { useMediaPrefsStore } from "@/stores/useMediaPrefsStore";
import type { JoinMedia } from "./PreJoin";
import { usePushToTalk } from "./pushToTalk";

const currentText = (english: string) =>
  translateUI(useI18nStore.getState().locale, english);

interface SessionValue {
  token?: string;
  credential?: RoomCredential;
  mediaConnected: boolean;
  /** LiveKit is re-establishing voice/video (separate from the room socket). */
  mediaReconnecting: boolean;
  screenShareActive: boolean;
  sendChat: (content: string, replyToId?: string) => boolean;
  sendCommand: (type: RoomCommandType, payload: object) => boolean;
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
  mediaReconnecting: false,
  screenShareActive: false,
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

export function RoomSession({ credential, joinMedia }: { credential: RoomCredential; joinMedia: JoinMedia }) {
  const pendingJoinMedia = useRef<JoinMedia | null>(joinMedia);
  const consumeJoinMedia = useCallback(() => {
    const media = pendingJoinMedia.current;
    pendingJoinMedia.current = null;
    return media;
  }, []);
  const router = useRouter();
  const socketRef = useRef<RoomSocket | null>(null);
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const activeDrawer = useUIStore((state) => state.activeDrawer);
  const connectionState = useRoomStore((state) => state.connectionState);
  const enteredRoom = useRef(false);
  // Snapshot once: LiveKitRoom builds its Room from the first options only.
  const [capture] = useState(() => {
    const prefs = useMediaPrefsStore.getState();
    prefs.hydrate();
    const { audioDeviceId, videoDeviceId } = useMediaPrefsStore.getState();
    return {
      audioDeviceId: audioDeviceId || undefined,
      videoDeviceId: videoDeviceId || undefined,
    };
  });
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
    if (connectionState === "RECONNECTING" && previous === "CONNECTED")
      playSfx("disconnect");
    if (
      connectionState === "CONNECTED" &&
      (previous === "RECONNECTING" || previous === "RESYNCING")
    )
      playSfx("reconnect");
    previousConnectionState.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    let disposed = false;
    let mediaRequested = false;
    let currentCredential = credential;
    const socket = new RoomSocket(credential, {
      getCredential: async () => {
        if (credential.type === "user") {
          const session = (await getSupabase()?.auth.getSession())?.data
            .session;
          if (!session) throw new Error("Sign in again to reconnect.");
          currentCredential = { ...credential, token: session.access_token };
        }
        return currentCredential;
      },
      onState: (state, error) => {
        if (state === "FAILED") {
          if (
            error &&
            (error.includes("removed") || error.includes("rejoin"))
          ) {
            playSfx("remove-from-room");
          }
          if (
            error &&
            /room is full|room is locked|you were removed|cannot rejoin|unauthorized/i.test(
              error,
            )
          ) {
            clearCredential(credential.roomId);
          }
        }
        useRoomStore.getState().setConnectionState(state, error);
      },
      onEvent: (event) => {
        if(event.type === "room.ended") {
          setLiveKitToken(null);
          clearCredential(credential.roomId);
          router.replace(`/join/${encodeURIComponent(credential.roomId)}`);
        }
        else if (event.type === "board.changed") {
          useBoardStore
            .getState()
            .changed(
              event.payload.version,
              event.payload.put,
              event.payload.remove,
            );
        }
        else if (event.type === "board.cursor") { useBoardStore.getState().cursor(event.payload); }
        else if (event.type === "room.snapshot") {
          useRoomStore.getState().applySnapshot(event.payload);
          useChatStore.getState().replace(event.payload.messages);
          useMusicStore.getState().replaceMedia(event.payload.media);
          useYouTubePicksStore.getState().replace(event.payload.picks ?? []);
          if (!enteredRoom.current) {
            enteredRoom.current = true;
            playSfx("room-enter");
          }
          // Admission must succeed before a second tab can connect to LiveKit
          // with the same identity and displace the active participant.
          if (!mediaRequested) {
            mediaRequested = true;
            void api
              .liveKitToken(credential.roomId, currentCredential)
              .then(({ token }) => {
                if (!disposed) setLiveKitToken(token);
              })
              .catch(() => {
                mediaRequested = false;
                if (!disposed)
                  setMediaError(
                    currentText(
                      "Voice and video couldn’t connect. Check your connection and try again.",
                    ),
                  );
              });
          }
        } else if (event.type === "participant.joined") {
          useRoomStore.getState().participantJoined(event.payload);
          playSfx("participant-join");
        } else if (event.type === "participant.avatar") {
          useRoomStore.getState().participantAvatar(event.payload.connection_id, event.payload.avatar_url);
        } else if (event.type === "participant.left") {
          useRoomStore.getState().participantLeft(event.payload.connection_id);
          playSfx("participant-leave");
        } else if (event.type === "host.changed") {
          useRoomStore.getState().hostChanged(event.payload.host);
          playSfx("host-transfer");
        } else if (event.type === "room.locked")
          useRoomStore
            .getState()
            .roomLocked(event.payload.locked, event.payload.version);
        else if (event.type === "room.access_changed")
          useRoomStore.getState().roomUpdated(event.payload);
        else if (event.type === "room.appearance.updated")
          useRoomStore.getState().roomAppearanceUpdated(event.payload);
        else if (event.type === "chat.updated")
          useChatStore.getState().update(event.payload);
        else if (event.type === "chat.typing")
          useChatStore
            .getState()
            .setTyping(event.payload.connection_id, event.payload.display_name);
        else if (event.type === "chat.message")
          useChatStore
            .getState()
            .append(
              event.payload,
              useUIStore.getState().activeDrawer === "chat",
            );
        else if (event.type === "media.state")
          useMusicStore.getState().setMedia(event.payload);
        else if (
          event.type === "youtube.pick.created" ||
          event.type === "youtube.pick.voted"
        )
          useYouTubePicksStore.getState().upsert(event.payload);
        else if (event.type === "youtube.pick.promoted")
          useYouTubePicksStore.getState().remove(event.payload.id);
        else if (
          event.type === "connection.pong" &&
          event.payload.client_time > 0
        )
          useMusicStore
            .getState()
            .setClockOffset(
              event.payload.server_time -
                (event.payload.client_time + Date.now()) / 2,
            );
        else if (event.type === "reaction.sent") {
          useReactionStore
            .getState()
            .append({
              displayName: event.payload.display_name,
              emoji: event.payload.emoji,
            });
        } else if (event.type === "wave.sent") {
          useReactionStore.getState().appendWave(event.payload.display_name);
        } else if (event.type === "participant.hand_changed") {
          useRoomStore
            .getState()
            .handChanged(
              event.payload.connection_id,
              event.payload.raised,
              event.payload.social_version,
            );
          if (event.payload.raised) playSfx("raise-hand");
        } else if (event.type === "error") {
          if (
            event.payload.code === "MEDIA_COMMAND_REJECTED" ||
            event.payload.code === "MEDIA_RATE_LIMITED"
          )
            useMusicStore.getState().setError(event.payload.message);
          else if (event.payload.code === "ROOM_COMMAND_REJECTED")
            useRoomStore.getState().setGovernanceError(event.payload.message);
          else if (
            event.payload.code === "REACTION_RATE_LIMITED" ||
            event.payload.code === "WAVE_RATE_LIMITED"
          )
            return;
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
      useYouTubePicksStore.getState().reset();
      useReactionStore.getState().reset();
      enteredRoom.current = false;
      useBoardStore.getState().reset();
    };
  }, [credential, router]);

  useEffect(() => {
    if (activeDrawer === "chat") useChatStore.getState().clearUnread();
  }, [activeDrawer]);
  const sendChat = useCallback((content: string, replyToId?: string) => {
    useChatStore.getState().setSendError(null);
    const sent =
      socketRef.current?.send(
        "chat.send",
        replyToId ? { content, reply_to_id: replyToId } : { content },
      ) ?? false;
    if (!sent)
      useChatStore
        .getState()
        .setSendError(
          currentText("Still reconnecting. Try again in a moment."),
        );
    return sent;
  }, []);
  const sendCommand: SessionValue["sendCommand"] = useCallback(
    (type, payload) => {
      const sent = socketRef.current?.send(type, payload) ?? false;
      if (!sent) {
        if (
          type === "room.lock" ||
          type === "room.appearance.update" ||
          type === "participant.kick" ||
          type === "participant.ban" ||
          type === "host.transfer"
        ) {
          useRoomStore
            .getState()
            .setGovernanceError(
              currentText("Still reconnecting. Try again shortly."),
            );
        } else if (
          type !== "reaction.send" &&
          type !== "wave.send" &&
          type !== "participant.hand.set" &&
          type !== "board.cursor"
        ) {
          useMusicStore
            .getState()
            .setError(currentText("Still reconnecting. Try again shortly."));
        }
      }
      return sent;
    },
    [],
  );
  const leave = useCallback(() => {
    finishCallStats(credential);
    socketRef.current?.close(true);
    clearCredential(credential.roomId);
    router.replace(credential.type === "user" ? "/home" : "/");
  }, [credential, router]);

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
            deviceId: capture.videoDeviceId ? { ideal: capture.videoDeviceId } : undefined,
          },
          audioCaptureDefaults: {
            deviceId: capture.audioDeviceId ? { ideal: capture.audioDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          publishDefaults: {
            simulcast: true,
            // VP9 (SVC) cuts bandwidth, especially for screen share; browsers
            // that cannot decode it receive the VP8 backup layers instead.
            videoCodec: "vp9",
            backupCodec: true,
            degradationPreference: "maintain-framerate",
          },
        }}
        onError={(error) => setMediaError(formatMediaError(error, "general"))}
        onMediaDeviceFailure={(failure) =>
          setMediaError(formatDeviceFailure(failure))
        }
      >
        <LiveMediaContext
          consumeJoinMedia={consumeJoinMedia}
          sendChat={sendChat}
          sendCommand={sendCommand}
          leave={leave}
          mediaError={mediaError}
          setMediaError={setMediaError}
          token={credential.token}
          credential={credential}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    );
  }
  const value: SessionValue = {
    token: credential.token,
    credential,
    mediaConnected: false,
    mediaReconnecting: false,
    screenShareActive: false,
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
  consumeJoinMedia,
  sendChat,
  sendCommand,
  leave,
  mediaError,
  setMediaError,
  token,
  credential,
}: Pick<
  SessionValue,
  "sendChat" | "sendCommand" | "leave" | "mediaError" | "token" | "credential"
> & {
  consumeJoinMedia: () => JoinMedia | null;
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
  const captureLifetime = useRef(new AbortController());
  const stopLocalTracks = useCallback(() => {
    stopPublishedTracks(liveRoom.localParticipant.trackPublications.values());
  }, [liveRoom]);
  const runCapture = useCallback(
    (capture: Parameters<typeof finishRoomCapture>[1]) =>
      finishRoomCapture(captureLifetime.current.signal, capture, stopLocalTracks),
    [stopLocalTracks],
  );
  const releaseCapture = useCallback(() => {
    captureLifetime.current.abort();
    stopLocalTracks();
  }, [stopLocalTracks]);
  useEffect(() => {
    captureLifetime.current = new AbortController();
    return releaseCapture;
  }, [releaseCapture]);
  const initialized = useRef(false);
  const isTogglingMic = useRef(false);
  const isTogglingCamera = useRef(false);
  const isTogglingScreen = useRef(false);
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const screenShareActive = hasActiveScreenShare(tracks);
  const pushToTalk = useMediaPrefsStore((state) => state.pushToTalk);
  const connected = connectionState === ConnectionState.Connected;

  const setPushToTalkMic = useCallback(
    async (enabled: boolean) => {
      try {
        await runCapture(() => localParticipant.setMicrophoneEnabled(enabled));
      } catch (error) {
        setMediaError(formatMediaError(error, "mic"));
        throw error;
      }
    },
    [runCapture, localParticipant, setMediaError],
  );
  usePushToTalk({
    enabled: pushToTalk && connected && isSecureMediaContext(),
    micEnabled: isMicrophoneEnabled,
    setMic: setPushToTalkMic,
  });

  // Coarse call-quality sampling for the post-call rating (no raw stats).
  useEffect(() => {
    if (!connected || !credential) return;
    startCallStats(credential.roomId);
    const timer = setInterval(
      () => sampleCallQuality(localParticipant.connectionQuality as QualitySample),
      5000,
    );
    liveRoom.on(RoomEvent.Reconnecting, noteCallReconnect);
    return () => {
      clearInterval(timer);
      liveRoom.off(RoomEvent.Reconnecting, noteCallReconnect);
    };
  }, [connected, credential, liveRoom, localParticipant]);

  useEffect(() => {
    if (initialized.current || connectionState !== ConnectionState.Connected)
      return;
    initialized.current = true;
    const preferences = consumeJoinMedia();
    if (!preferences || !isSecureMediaContext()) return;
    if (preferences.mic && !useMediaPrefsStore.getState().pushToTalk) {
      void runCapture(() => localParticipant.setMicrophoneEnabled(true)).catch((error) => {
        setMediaError(formatMediaError(error, "mic"));
      });
    }
    if (preferences.camera) {
      void runCapture(() => localParticipant.setCameraEnabled(true)).catch((error) => {
        setMediaError(formatMediaError(error, "camera"));
      });
    }
  }, [consumeJoinMedia, runCapture, localParticipant, connectionState, setMediaError]);

  const value = useMemo<SessionValue>(
    () => ({
      token: token ?? credential?.token,
      credential,
      mediaConnected: connectionState === ConnectionState.Connected,
      mediaReconnecting:
        connectionState === ConnectionState.Reconnecting ||
        connectionState === ConnectionState.SignalReconnecting,
      screenShareActive,
      sendChat,
      sendCommand,
      leave: () => {
        releaseCapture();
        void liveRoom.disconnect(true).catch(() => undefined);
        leave();
      },
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
          await runCapture(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled));
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
          await runCapture(() => localParticipant.setCameraEnabled(!isCameraEnabled));
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
          const motion =
            useMediaPrefsStore.getState().screenShareMode === "motion";
          await runCapture(() => localParticipant.setScreenShareEnabled(
            !isScreenShareEnabled,
            {
              audio: true,
              contentHint: motion ? "motion" : "detail",
              resolution: {
                width: 1920,
                height: 1080,
                frameRate: motion ? 30 : 15,
              },
            },
            {
              degradationPreference: motion
                ? "maintain-framerate"
                : "maintain-resolution",
              // One full-resolution layer: simulcast lets small tiles pull a
              // 540p layer, which makes shared text unreadable.
              simulcast: false,
            },
          ));
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
      runCapture,
      releaseCapture,
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
      screenShareActive,
      setMediaError,
      token,
      credential,
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
  const [stripHidden, setStripHidden] = useState(false);
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
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
    mediaParticipants.find((item) => item.identity === identity)
      ?.connectionQuality ?? ConnectionQuality.Unknown;
  const layout = deriveStageLayout(
    participants.length,
    Boolean(screen),
    stageSize.width,
    stageSize.height,
  );
  return (
    <div ref={stageRef} className={`w-full h-full min-h-0 ${screen ? "p-1 sm:p-2" : "p-3 sm:p-6"}`}>
      {layout.mode === "screen-share" && screen ? (
        <div data-testid="screen-share-stage" className={`grid h-full min-h-0 min-w-0 w-full grid-cols-1 ${stripHidden ? "grid-rows-[minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)_88px] gap-2 sm:grid-rows-[minmax(0,1fr)_104px] sm:gap-3"}`}>
          <ScreenShareViewport
            track={screen}
            stripHidden={stripHidden}
            onToggleStrip={() => setStripHidden((hidden) => !hidden)}
          />
          {!stripHidden && (<div
            className="min-h-0 min-w-0 overflow-x-auto overflow-y-hidden rounded-[10px] pb-1"
            role="region"
            tabIndex={0}
            aria-label={tr("Room participants")}
          >
            <div className="mx-auto flex h-full w-max min-w-full items-center justify-center gap-2 px-1">
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
          </div>)}
        </div>
      ) : layout.mode === "empty" ? (
        <EmptyStage />
      ) : (
        <motion.div
          layout
          transition={{ duration: 0.2 }}
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
      transition={{ duration: 0.2 }}
      className={`${compact ? "w-28 h-16 shrink-0 sm:w-36 sm:h-20" : "w-full h-full min-w-0 min-h-0"} rounded-[10px] overflow-hidden bg-[var(--bg-loft-card)] shadow-lg relative border-2 transition-shadow duration-200 ${speaking ? "border-[var(--border-loft)] speaking-glow" : "border-transparent"}`}
    >
      {raisedHand && (
        <span
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-[#101113]/90 px-2 py-1 text-[13px] font-medium text-white shadow"
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
        <div className={`w-full h-full flex flex-col items-center bg-[#101113]/10 ${compact ? "justify-start gap-0 pt-1 sm:pt-2" : "justify-center gap-3"}`}>
          {avatarUrl && !avatarFailed ? (
            <img
              src={avatarUrl}
              alt={`${name} avatar`}
              width={128}
              height={128}
              onLoad={(event) => {
                const intrinsic = event.currentTarget.naturalWidth;
                if (intrinsic > 0) {
                  setAvatarSize(
                    Math.min(
                      128,
                      Math.max(
                        1,
                        Math.floor(intrinsic / window.devicePixelRatio),
                      ),
                    ),
                  );
                }
              }}
              onError={() => setAvatarFailed(true)}
              style={{
                width: compact ? Math.min(32, avatarSize) : avatarSize,
                height: compact ? Math.min(32, avatarSize) : avatarSize,
              }}
              className="max-w-[40%] max-h-[65%] rounded-full object-cover shrink-0"
            />
          ) : (
            <span
              className={`${compact ? "w-8 h-8 text-[13px]" : solo ? "w-24 h-24 text-[13px]" : "w-16 h-16 text-[13px]"} rounded-full bg-[#101113]/20 text-[var(--text-loft-primary)] flex items-center justify-center font-medium shrink-0`}
            >
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          {solo && (
            <div className="text-center min-w-0 px-3">
              <div className="font-medium text-[13px] truncate flex items-center justify-center gap-2">
                <span>{name}</span>
                {muted && (
                  <span title={tr("Muted")} className="inline-flex">
                    <MicOff className="w-3.5 h-3.5 text-[var(--text-loft-primary)] shrink-0" />
                  </span>
                )}
              </div>
              <div className="text-[13px] text-[var(--text-loft-secondary)] mt-1">
                {tr("Camera off")}
              </div>
            </div>
          )}
        </div>
      )}
      {(!solo || camera) && (
        <div className={`absolute flex items-center rounded-[10px] bg-[#101113]/60 backdrop-blur-xs text-white ${compact ? "left-1 bottom-1 max-w-[calc(100%-0.5rem)] gap-1 px-1.5 py-0.5 text-[12px] leading-4" : "left-2 bottom-2 max-w-[calc(100%-1rem)] gap-2 px-2 py-1 text-[13px]"}`}>
          {muted && (
            <span title={tr("Muted")} className="inline-flex">
              <MicOff className="w-3 h-3 text-[var(--text-loft-primary)] shrink-0" />
            </span>
          )}
          <span className="truncate">{name}</span>
          <SignalBars quality={quality} />
        </div>
      )}
    </motion.div>
  );
}

const SIGNAL_LEVEL: Partial<Record<ConnectionQuality, number>> = {
  [ConnectionQuality.Excellent]: 3,
  [ConnectionQuality.Good]: 2,
  [ConnectionQuality.Poor]: 1,
};

/** Monochrome signal bars: the level is carried by how many bars are lit, not by hue. */
export function SignalBars({ quality }: { quality: ConnectionQuality }) {
  const level = SIGNAL_LEVEL[quality] ?? 0;
  return (
    <span
      role="img"
      aria-label={`Connection quality: ${quality}`}
      title={quality}
      data-level={level}
      className="inline-flex h-2.5 shrink-0 items-end gap-[2px]"
    >
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={`w-[3px] rounded-[1px] ${bar <= level ? "bg-white" : "bg-white/25"}`}
          style={{ height: `${bar * 33}%` }}
        />
      ))}
    </span>
  );
}

export function EmptyStage() {
  const tr = useUIText();
  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <div className="glass-card rounded-[10px] p-8 sm:p-12 text-center max-w-lg">
        <div className="mx-auto w-16 h-16 rounded-full bg-[#101113]/15 flex items-center justify-center text-[13px] mb-4">
          ⌁
        </div>
        <h2 className="text-[13px] font-medium mb-2">{tr("Room is ready")}</h2>
        <p className="text-[13px] text-[var(--text-loft-secondary)]">
          {tr(
            "Turn on camera, share screen, or settle in with voice. You’re here together.",
          )}
        </p>
      </div>
    </div>
  );
}
