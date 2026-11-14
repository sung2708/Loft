"use client";

import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  Pencil,
  Reply,
  Trash2,
  Check,
  Copy,
  Crown,
  Flag,
  MessageSquare,
  Music2,
  Mic,
  MicOff,
  Lock,
  Unlock,
  MonitorUp,
  PhoneOff,
  Settings2,
  SunMoon,
  Users,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { FormEvent, memo, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { activeTypers, useChatStore } from "@/stores/useChatStore";
import type { ApiMessage } from "@/types/api";
import { useRoomStore } from "@/stores/useRoomStore";
import { useUIStore } from "@/stores/useUIStore";
import { ConnectingStage, EmptyStage, MediaStage, useRoomSession } from "./RoomSession";
import { MusicDrawer } from "./MusicDrawer";
import { MusicPlayback } from "./MusicPlayback";
import { useReactionStore } from "@/stores/useReactionStore";
import { useMusicPlayerStore } from "@/stores/useMusicPlayerStore";
import { useUIText } from "@/lib/i18n/uiText";
import { useI18nStore } from "@/lib/i18n/useTranslation";
import { KickParticipantDialog } from "@/components/room/KickParticipantDialog";
import { ReportDialog, type ReportTarget } from "@/components/room/ReportDialog";
import {
  ParticipantMenu,
  type ParticipantAction,
} from "@/components/room/ParticipantMenu";
import { LeaveRoomDialog } from "@/components/room/LeaveRoomDialog";
import { SocialActions } from "@/components/room/SocialActions";
import { RoomAtmosphere } from "./RoomAtmosphere";
import { api, ApiError, clearCredential } from "@/lib/api";
import { OFFLINE_MESSAGE } from "@/lib/realtime";
import { useMobileDrawerFocus } from "./useMobileDrawerFocus";
import { useMediaPrefsStore } from "@/stores/useMediaPrefsStore";
import { isEditableTarget } from "./pushToTalk";
import { canNotify, useTabSignals } from "./useTabSignals";
import { useScreenWakeLock } from "./useScreenWakeLock";

const Whiteboard = dynamic(() => import("./Whiteboard"), { ssr: false });
// Settings is opened rarely; keep its ~700 lines out of the room's first load.
const SettingsDrawer = dynamic(
  () => import("./SettingsDrawer").then((module) => module.SettingsDrawer),
  { ssr: false },
);

export function RoomView() {
  const [boardOpen,setBoardOpen]=useState(false);
  const [boardOpened,setBoardOpened]=useState(false);
  const drawer = useUIStore((state) => state.activeDrawer);
  const connection = useRoomStore((state) => state.connectionState);
  const room = useRoomStore((state) => state.room);
  const self = useRoomStore((state) => state.self);
  useTabSignals(self?.identity_type === "user" && self.identity_id === room?.owner_id);
  useScreenWakeLock(connection === "CONNECTED");
  const [musicPlayerSurface, setMusicPlayerSurface] =
    useState<HTMLDivElement | null>(null);
  // Once the room is live, fetch the settings chunk in idle time so the first
  // open is still instant.
  useEffect(() => {
    if (connection !== "CONNECTED") return;
    const load = () => void import("./SettingsDrawer").catch(() => undefined);
    const idle = (window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    });
    if (idle.requestIdleCallback) {
      const id = idle.requestIdleCallback(load, { timeout: 5000 });
      return () => idle.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(load, 2000);
    return () => window.clearTimeout(timer);
  }, [connection]);
  const handleMusicPlayerSurface = useCallback(
    (surface: HTMLDivElement | null) => {
      setMusicPlayerSurface((current) =>
        current === surface ? current : surface,
      );
    },
    [],
  );
  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)]">
      <RoomHeader />
      <ConnectionBadge />
      <GovernanceNotice />
      <div
        className={`relative grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          drawer
            ? "md:grid-cols-[minmax(0,1fr)_24rem]"
            : "md:grid-cols-[minmax(0,1fr)]"
        }`}
      >
        <section className="room-stage-column relative flex min-h-0 min-w-0 flex-col">
          <div className="flex-1 min-h-0">
            {room && connection === "CONNECTED" ? <><div className={boardOpen ? "hidden" : "h-full"}><Stage /></div>{boardOpened && <div className={boardOpen?"h-full":"hidden"}><Whiteboard key={room.id} active={boardOpen} /></div>}</> : <RoomLoading />}
          </div>
          <CallDock boardOpen={boardOpen} toggleBoard={() => {setBoardOpened(true);setBoardOpen(open=>!open)}} />
        </section>
        <>
          {drawer === "chat" && <ChatDrawer />}
          {drawer === "people" && <PeopleDrawer />}
          {drawer === "settings" && <SettingsDrawer />}
          <MusicDrawer
            open={drawer === "music"}
            onClose={() => useUIStore.getState().closeDrawer()}
            onPlayerSurfaceReady={handleMusicPlayerSurface}
          />
        </>
      </div>
      <MusicPlayback surface={musicPlayerSurface} visible={drawer === "music"} />
    </main>
  );
}

function Stage() {
  const tr = useUIText();
  const reducedMotion = useReducedMotion();
  const media = useRoomSession();
  const reactions = useReactionStore((state) => state.reactions);
  useEffect(() => {
    if (!reactions.length) return;
    const timer = setInterval(
      () => useReactionStore.getState().clearExpired(Date.now()),
      500,
    );
    return () => clearInterval(timer);
  }, [reactions.length]);
  return (
    <RoomAtmosphere screenShare={media.screenShareActive}>
      <div className="relative w-full h-full">
        {media.mediaConnected ? (
          <MediaStage />
        ) : media.mediaConnecting ? (
          <ConnectingStage />
        ) : (
          <EmptyStage />
        )}
        {media.mediaError && (
          <div
            role="alert"
            className="absolute left-1/2 top-4 z-30 flex max-w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-3 py-2 text-center text-[13px] text-[var(--text-loft-primary)] shadow-lg"
          >
            <span>
              {media.mediaError.replace(/\.+$/, "")}.{" "}
              {tr("Chat remains available.")}
            </span>
            <button
              type="button"
              onClick={() => media.clearMediaError?.()}
              className="ml-1 p-1 rounded-[10px] text-[var(--text-loft-primary)] hover-invert hover:bg-[var(--border-loft)] transition-colors"
              aria-label={tr("Close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div
          aria-live="polite"
          className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 gap-2 overflow-hidden"
        >
          {reactions.map((reaction) => (
            <motion.div
              key={reaction.emoji}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -24 }}
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
              className="rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-3 py-1 text-[13px] shadow-lg"
              title={reaction.displayName}
              aria-label={`${reaction.displayName}: ${reaction.emoji}`}
            >
              {reaction.emoji}
              {reaction.count > 1 && (
                <span className="ml-1 text-[13px] font-medium">
                  ×{reaction.count}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </RoomAtmosphere>
  );
}

function RoomLoading() {
  const router = useRouter();
  const tr = useUIText();
  const state = useRoomStore((item) => item.connectionState);
  const error = useRoomStore((item) => item.connectionError);
  const roomId = useRoomStore((item) => item.room?.id);
  const terminalAdmissionFailure = Boolean(
    error &&
    /room is full|room is locked|you were removed|cannot rejoin/i.test(error),
  );
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-7 text-center shadow-[8px_8px_0_color-mix(in_srgb,var(--border-loft)_12%,transparent)]">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-[var(--border-loft)]/20 border-t-[var(--accent-blue)] animate-spin" />
        <h2 className="font-medium">
          {tr(state === "FAILED" ? "Couldn’t join room" : "Joining…")}
        </h2>
        <p className="text-[13px] text-[var(--text-loft-secondary)] mt-2">
          {tr(error ?? "Syncing current room state.")}
        </p>
        {state === "FAILED" && (
          <button
            onClick={() => {
              if (terminalAdmissionFailure) {
                if (roomId) clearCredential(roomId);
                router.replace("/");
              } else {
                location.reload();
              }
            }}
            className="btn-press mt-4 rounded-[10px] bg-[#101113] px-4 py-2 text-[13px] text-white"
          >
            {tr(terminalAdmissionFailure ? "Return home" : "Try again")}
          </button>
        )}
      </div>
    </div>
  );
}

function RoomHeader() {
  const tr = useUIText();
  const room = useRoomStore((state) => state.room);
  const self = useRoomStore((state) => state.self);
  const count = useRoomStore((state) => state.participants.length);
  const { theme, setTheme } = useUIStore();
  const activeDrawer = useUIStore((state) => state.activeDrawer);
  const [copied, setCopied] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!appearanceOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!appearanceRef.current?.contains(event.target as Node)) {
        setAppearanceOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppearanceOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [appearanceOpen]);
  const copy = async () => {
    if (!room) return;
    await navigator.clipboard.writeText(`${location.origin}/join/${room.slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const subtitle = (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate">
        {count} {tr("present")} ·{" "}
        {tr(room?.allow_guests ? "Guests welcome" : "Members only")}
      </span>
      {room?.is_locked ? (
        <span
          className="inline-flex shrink-0 items-center gap-1"
          title={tr("Room locked")}
        >
          <Lock className="h-3 w-3" /> {tr("Locked")}
        </span>
      ) : null}
    </span>
  );
  return (
    <AppHeader
      fixed={false}
      title={room?.name ?? "Mingly"}
      subtitle={subtitle}
      actions={
        <>
          <button
            onClick={copy}
            aria-label={tr("Invite")}
            disabled={!room}
            className="btn-press h-8 px-3 rounded-full border border-[var(--border-loft)] text-[13px] flex items-center gap-2"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-[var(--text-loft-primary)]" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{tr("Invite")}</span>
          </button>
          {Boolean(
            room &&
            ((self?.identity_type === "user" &&
              self.identity_id === room.owner_id) ||
              self?.role === "host"),
          ) && (
            <button
              type="button"
              onClick={() => useUIStore.getState().toggleDrawer("settings")}
              aria-label={tr("Room settings")}
              aria-pressed={activeDrawer === "settings"}
              title={tr("Room settings")}
              className={`btn-press h-8 w-8 rounded-full border border-[var(--border-loft)] flex items-center justify-center transition-colors cursor-pointer ${
                activeDrawer === "settings"
                  ? "bg-[#101113] text-white border-[var(--border-loft)] shadow-sm shadow-[#101113]/30"
                  : "hover-invert hover:bg-[var(--border-loft-light)]"
              }`}
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}
          <div ref={appearanceRef} className="relative">
            <button
              type="button"
              aria-label={tr("Appearance")}
              aria-haspopup="menu"
              aria-expanded={appearanceOpen}
              onClick={() => setAppearanceOpen((open) => !open)}
              className="h-8 w-8 rounded-full border border-[var(--border-loft)] flex items-center justify-center hover-invert hover:bg-[var(--border-loft-light)]"
            >
              <SunMoon className="w-4 h-4" />
            </button>
            {appearanceOpen && (
              <div
                role="menu"
                aria-label={tr("Appearance")}
                className="absolute right-0 top-full mt-2 z-50 min-w-52 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-2 shadow-xl"
              >
                {(["system", "light", "dark"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === option}
                    onClick={() => {
                      setTheme(option);
                      setAppearanceOpen(false);
                    }}
                    className="w-full rounded-[10px] px-3 py-2 text-left text-[13px] capitalize text-[var(--text-loft-primary)] hover-invert hover:bg-[var(--border-loft-light)] flex items-center justify-between gap-3"
                  >
                    {tr(option.charAt(0).toUpperCase() + option.slice(1))}
                    {theme === option && (
                      <Check className="w-3.5 h-3.5 text-[var(--text-loft-primary)]" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div
            title={self?.display_name}
            className="w-8 h-8 rounded-full bg-[#101113]/15 text-[var(--text-loft-primary)] flex items-center justify-center font-medium text-[13px] overflow-hidden"
          >
            {self?.avatar_url ? (
              <img
                src={self.avatar_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              (self?.display_name?.slice(0, 1).toUpperCase() ?? "?")
            )}
          </div>
        </>
      }
    />
  );
}

function ConnectionBadge() {
  const tr = useUIText();
  const socketState = useRoomStore((item) => item.connectionState);
  const offline = useRoomStore((item) => item.networkOffline);
  const { mediaReconnecting } = useRoomSession();
  // The room socket and the call reconnect independently; show whichever is down.
  const state =
    socketState === "CONNECTED" && mediaReconnecting ? "RECONNECTING" : socketState;
  const visible = offline || state !== "CONNECTED";
  if (!visible) return null;
  const failed = state === "FAILED";
  if (offline && !failed) {
    return (
      <div
        role="status"
        className="absolute left-1/2 top-16 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-[#101113] px-3 py-2 text-[13px] text-white shadow-lg"
      >
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{tr(OFFLINE_MESSAGE)}</span>
      </div>
    );
  }
  return (
    <div
      role="status"
      className={`absolute left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2 text-[13px] shadow-lg ${failed ? "bg-[#101113] text-white" : "border border-[var(--border-loft)] bg-[var(--bg-loft-card)]"}`}
    >
      {failed ? (
        <WifiOff className="w-3.5 h-3.5" />
      ) : (
        <Wifi className="w-3.5 h-3.5 animate-pulse" />
      )}
      {tr(
        state === "RESYNCING"
          ? "Resyncing…"
          : state === "RECONNECTING"
            ? "Reconnecting…"
            : failed
              ? "Offline"
              : "Connecting…",
      )}
    </div>
  );
}

function GovernanceNotice() {
  const tr = useUIText();
  const error = useRoomStore((state) => state.governanceError);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="absolute left-1/2 top-24 z-50 flex max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-4 py-2 text-[13px] text-[var(--text-loft-primary)] shadow-lg"
    >
      <span>{tr(error)}</span>
      <button
        type="button"
        onClick={() => useRoomStore.getState().setGovernanceError(null)}
        aria-label={tr("Close")}
        className="shrink-0 p-1 rounded-full hover:bg-[#101113]/10"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function CallDock({boardOpen,toggleBoard}:{boardOpen:boolean;toggleBoard:()=>void}) {
  const tr = useUIText();
  const locale=useI18nStore(state=>state.locale);
  const room=useRoomStore(state=>state.room);
  const pushToTalk=useMediaPrefsStore(state=>state.pushToTalk);
  const [leaving,setLeaving]=useState(false);
  const [ending,setEnding]=useState(false);
  const [endError,setEndError]=useState<string|null>(null);
  const media = useRoomSession();
  const drawer = useUIStore((state) => state.activeDrawer);
  const toggleDrawer = useUIStore((state) => state.toggleDrawer);
  const unread = useChatStore((state) => state.unreadCount);
  const count = useRoomStore((state) => state.participants.length);
  const self = useRoomStore((state) => state.self);

  const owner=self?.identity_type==="user"&&self.identity_id===room?.owner_id;
  const endRoom=async()=>{
   if(!room||!media.credential||ending)return;
   setEnding(true);setEndError(null);
   try {await api.endRoom(room.id,media.credential);media.leave()}
   catch(error){setEndError(tr(error instanceof Error?error.message:"Could not end the room"))}
   finally{setEnding(false)}
  };
  const sendReaction = (emoji: string) =>
    media.sendCommand("reaction.send", { emoji });
  const sendWave = () => media.sendCommand("wave.send", {});
  const toggleHand = () =>
    media.sendCommand("participant.hand.set", {
      raised: !(self?.raised_hand ?? false),
      expected_social_version: self?.social_version ?? 0,
    });
  // Single-key shortcuts (Meet/Zoom style). Never fire while typing.
  const mediaRef = useRef(media);
  useEffect(() => { mediaRef.current = media; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const current = mediaRef.current;
      if (!current.mediaConnected) return;
      if (event.code === "KeyM") { event.preventDefault(); void current.toggleMic(); }
      else if (event.code === "KeyV") { event.preventDefault(); void current.toggleCamera(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const control =
    "room-dock-control btn-press relative shrink-0 !h-10 !w-10 rounded-full flex items-center justify-center border border-[var(--border-loft)]";
  return (<>
   {leaving&&room&&<LeaveRoomDialog locale={locale} name={room.name} pending={ending} error={endError} onClose={()=>setLeaving(false)} onLeave={media.leave} onEnd={()=>void endRoom()}/>}
    <div className="flex shrink-0 justify-center px-2 pb-[calc(.75rem+env(safe-area-inset-bottom))]">
      <div className="room-call-dock relative flex max-w-full items-center gap-1 rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-dock)] p-2 shadow-2xl motion-reduce:transform-none md:[transform:perspective(1200px)_rotateX(1deg)] sm:gap-2">
        <button
          disabled={!media.mediaConnected}
          onClick={() => void media.toggleMic()}
          className={`${control} disabled:opacity-40 disabled:cursor-not-allowed ${media.micEnabled ? "" : "bg-[#101113] text-white"}`}
          title={pushToTalk ? tr("Hold Space to talk") : `${tr("Microphone")} (M)`}
          aria-label={tr("Microphone")}
        >
          {media.micEnabled ? (
            <Mic className="w-4 h-4" />
          ) : (
            <MicOff className="w-4 h-4" />
          )}
        </button>
        <button
          disabled={!media.mediaConnected}
          onClick={() => void media.toggleCamera()}
          className={`${control} disabled:opacity-40 disabled:cursor-not-allowed ${media.cameraEnabled ? "" : "bg-[#101113] text-white"}`}
          title={`${tr("Camera")} (V)`}
          aria-label={tr("Camera")}
        >
          {media.cameraEnabled ? (
            <Video className="w-4 h-4" />
          ) : (
            <VideoOff className="w-4 h-4" />
          )}
        </button>
        <button
          disabled={!media.mediaConnected}
          onClick={() => void media.toggleScreen()}
          className={`${control} disabled:opacity-40 disabled:cursor-not-allowed ${media.screenEnabled ? "bg-[#101113] text-white" : ""}`}
          title={tr("Share screen")}
          aria-label={tr("Share screen")}
        >
          <MonitorUp className="w-4 h-4" />
        </button>
        <span className="room-dock-separator w-px h-6 bg-[var(--border-loft)]" />
        <button onClick={toggleBoard} aria-label={tr("Whiteboard")} title={tr("Whiteboard")} aria-pressed={boardOpen} className={`${control} ${boardOpen ? "bg-[#101113] text-white" : ""}`}><Pencil className="h-4 w-4" /></button>
        <button
          onClick={() => toggleDrawer("chat")}
          className={`${control} ${drawer === "chat" ? "bg-[#101113] text-white" : ""}`}
          title={tr("Chat")}
          aria-label={tr("Chat")}
        >
          <MessageSquare className="w-4 h-4" />
          {unread > 0 && drawer !== "chat" && (
            <b className="absolute -top-1 -right-1 bg-[#101113] text-white rounded-full min-w-4 h-4 text-[13px] flex items-center justify-center">
              {unread}
            </b>
          )}
        </button>
        <button
          onClick={() => toggleDrawer("people")}
          className={`${control} ${drawer === "people" ? "bg-[#101113] text-white" : ""}`}
          title={tr("People")}
          aria-label={tr("People")}
        >
          <Users className="w-4 h-4" />
          <b className="room-dock-count absolute -top-1 -right-1 min-w-4 h-4 rounded-full border text-[13px] flex items-center justify-center">
            {count}
          </b>
        </button>
        <button
          onClick={() => {
            if (drawer !== "music")
              useMusicPlayerStore.getState().requestAudioActivation();
            toggleDrawer("music");
          }}
          className={`${control} ${drawer === "music" ? "bg-[#101113] text-white" : ""}`}
          title={tr("Shared Queue")}
          aria-label={tr("Shared Queue")}
        >
          <Music2 className="w-4 h-4" />
        </button>
        <span className="room-dock-optional room-dock-separator w-px h-6 bg-[var(--border-loft)]" />
        <div className="room-dock-optional contents">
          <SocialActions
            raised={self?.raised_hand ?? false}
            disabled={useRoomStore.getState().connectionState !== "CONNECTED"}
            onReaction={sendReaction}
            onWave={sendWave}
            onToggleHand={toggleHand}
            controlClass={control}
          />
        </div>
        <span className="room-dock-optional room-dock-separator w-px h-6 bg-[var(--border-loft)]" />
        <button
          onClick={()=>{if(owner){setEndError(null);setLeaving(true)}else{media.leave()}}}
          className={`${control} bg-[#101113]/15 text-[var(--text-loft-primary)] hover:bg-[#101113] hover:text-white`}
          title={tr("Leave")}
          aria-label={tr("Leave")}
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  </>);
}

function DrawerFrame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const tr = useUIText();
  const close = useUIStore((state) => state.closeDrawer);
  const { closeButtonRef, isModal, panelRef } = useMobileDrawerFocus(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal={isModal || undefined}
      aria-label={title}
      className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-0 top-14 z-40 flex w-full min-h-0 flex-col border-l border-[var(--border-loft)] bg-[var(--bg-loft-card)] shadow-2xl md:relative md:bottom-auto md:right-auto md:top-auto md:z-auto md:h-full md:w-96 md:shrink-0"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-loft)] px-5">
        <h3 className="font-medium text-[13px]">{title}</h3>
        <button
          ref={closeButtonRef}
          onClick={close}
          aria-label={tr("Close")}
          className="w-8 h-8 rounded-full hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </aside>
  );
}

function renderMessageContent(content: string, isMine?: boolean) {
  const urlRegex =
    /(https?:\/\/[^\s<]+[^<.,:;"')\]!?\s]|www\.[^\s<]+[^<.,:;"')\]!?\s])/gi;
  const parts = content.split(urlRegex);
  if (parts.length <= 1) return content;

  return parts.map((part, index) => {
    if (/^(https?:\/\/|www\.)/i.test(part)) {
      const href = /^https?:\/\//i.test(part) ? part : `https://${part}`;
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`underline underline-offset-2 break-all transition-opacity hover:opacity-80 font-medium ${
            isMine
              ? "text-white hover:text-white/90"
              : "text-[var(--text-loft-primary)] dark:text-[var(--text-loft-primary)]"
          }`}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

const TYPING_SEND_INTERVAL_MS = 3000;
/** Within this distance of the bottom the reader is "following" the chat. */
const CHAT_FOLLOW_THRESHOLD_PX = 96;

const chatAction =
  "flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-loft-muted)] hover:bg-[var(--border-loft-light)] hover:text-[var(--text-loft-primary)]";

type ChatMessageRowProps = {
  message: ApiMessage;
  mine: boolean;
  canDelete: boolean;
  locale: string;
  onReply: (message: ApiMessage) => void;
  onEdit: (message: ApiMessage) => void;
  onDelete: (message: ApiMessage) => void;
};

// Memoized so typing in the composer, typing indicators and unrelated
// messages never re-render the whole history.
const ChatMessageRow = memo(function ChatMessageRow({
  message,
  mine,
  canDelete,
  locale,
  onReply,
  onEdit,
  onDelete,
}: ChatMessageRowProps) {
  const tr = useUIText();
  const isSystem = message.sender_id === "system" || message.sender_id === "";
  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[13px] px-3 py-1 rounded-full bg-[var(--border-loft-light)] text-[var(--text-loft-muted)] border border-[var(--border-loft)] text-center max-w-[90%] break-words">
          {renderMessageContent(message.content)}
        </span>
      </div>
    );
  }
  return (
    <div className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`flex items-center gap-2 mb-1 px-1 text-[13px] text-[var(--text-loft-muted)] ${
          mine ? "flex-row-reverse" : ""
        }`}
      >
        <span className="font-medium text-[var(--text-loft-secondary)]">
          {message.sender_display_name}
        </span>
        <span>·</span>
        <span>
          {new Date(message.created_at).toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {message.edited_at && !message.deleted && <span>· {tr("edited")}</span>}
      </div>
      <div className={`flex max-w-[92%] items-center gap-1 ${mine ? "flex-row-reverse" : ""}`}>
        <div
          className={`min-w-0 px-4 py-2 rounded-[10px] text-[13px] break-words whitespace-pre-wrap leading-relaxed ${
            message.deleted
              ? "border border-dashed border-[var(--border-loft)] text-[var(--text-loft-muted)] italic"
              : mine
                ? "bg-[#101113] text-white rounded-br-[6px] shadow-sm"
                : "border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] text-[var(--text-loft-primary)] rounded-bl-[6px] shadow-sm"
          }`}
        >
          {message.reply_to && !message.deleted && (
            <div
              className={`mb-1.5 border-l-2 pl-2 text-[12px] leading-snug ${mine ? "border-white/40 text-white/70" : "border-[var(--border-loft)] text-[var(--text-loft-muted)]"}`}
            >
              <span className="font-medium">{message.reply_to.sender_display_name}</span>
              <span className="line-clamp-2">
                {message.reply_to.deleted ? tr("Message deleted") : message.reply_to.content}
              </span>
            </div>
          )}
          {message.deleted ? tr("Message deleted") : renderMessageContent(message.content, mine)}
        </div>
        {!message.deleted && (
          <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
            <button type="button" className={chatAction} onClick={() => onReply(message)} aria-label={tr("Reply")} title={tr("Reply")}>
              <Reply className="h-3.5 w-3.5" />
            </button>
            {mine && (
              <button type="button" className={chatAction} onClick={() => onEdit(message)} aria-label={tr("Edit")} title={tr("Edit")}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {canDelete && (
              <button type="button" className={chatAction} onClick={() => onDelete(message)} aria-label={tr("Delete")} title={tr("Delete")}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/** Owns the 1s expiry tick so only this line re-renders while people type. */
function TypingIndicator() {
  const tr = useUIText();
  const typing = useChatStore((state) => state.typing);
  const [now, setNow] = useState(() => Date.now());
  const hasTypers = Object.keys(typing).length > 0;
  useEffect(() => {
    if (!hasTypers) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      useChatStore.getState().pruneTyping();
    }, 1000);
    return () => clearInterval(timer);
  }, [hasTypers]);
  const typers = activeTypers(typing, now);
  return (
    <p aria-live="polite" className="h-5 truncate px-4 text-[12px] text-[var(--text-loft-muted)]">
      {typers.length === 1
        ? `${typers[0]} ${tr("is typing…")}`
        : typers.length > 1
          ? tr("Several people are typing…")
          : ""}
    </p>
  );
}

function ChatDrawer() {
  const tr = useUIText();
  const locale = useI18nStore((state) => state.locale);
  const messages = useChatStore((state) => state.messages);
  const error = useChatStore((state) => state.sendError);
  const self = useRoomStore((state) => state.self);
  const room = useRoomStore((state) => state.room);
  const session = useRoomSession();
  const reduceMotion = useReducedMotion();
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ApiMessage | null>(null);
  const [editing, setEditing] = useState<ApiMessage | null>(null);
  const [unseen, setUnseen] = useState(0);
  const lastTypingSent = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const seen = useRef<{ count: number; lastId: string | null } | null>(null);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const isOwner =
    self?.identity_type === "user" && !!room && self.identity_id === room.owner_id;
  const selfId = self?.identity_id;
  const selfType = self?.identity_type;

  const scrollToBottom = useCallback(
    (smooth: boolean) => {
      const node = scroller.current;
      if (!node) return;
      const top = node.scrollHeight;
      if (typeof node.scrollTo === "function") {
        node.scrollTo({ top, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
      } else {
        node.scrollTop = top;
      }
      following.current = true;
      setUnseen(0);
    },
    [reduceMotion],
  );

  // Follow new messages only when the reader is already at the bottom or just
  // sent one. Edits, deletes and reactions never move the viewport.
  useEffect(() => {
    const last = messages[messages.length - 1];
    const previous = seen.current;
    seen.current = { count: messages.length, lastId: last?.id ?? null };
    if (!previous) {
      scrollToBottom(false);
      return;
    }
    if (!last || last.id === previous.lastId) return;
    const added = Math.max(1, messages.length - previous.count);
    const ownMessage = last.sender_id === selfId && last.sender_type === selfType;
    if (following.current || ownMessage) scrollToBottom(true);
    else setUnseen((count) => count + added);
  }, [messages, scrollToBottom, selfId, selfType]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    following.current = distance <= CHAT_FOLLOW_THRESHOLD_PX;
    if (following.current) setUnseen(0);
  };

  const resetComposer = () => {
    setInput("");
    setReplyTo(null);
    setEditing(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value || value.length > 2000) return;
    if (editing) {
      if (value === editing.content) return resetComposer();
      if (session.sendCommand("chat.edit", { message_id: editing.id, content: value }))
        resetComposer();
      return;
    }
    if (session.sendChat(value, replyTo?.id)) resetComposer();
  };
  const onInput = (value: string) => {
    setInput(value);
    const at = Date.now();
    if (!editing && value.trim() && at - lastTypingSent.current > TYPING_SEND_INTERVAL_MS) {
      lastTypingSent.current = at;
      session.sendCommand("chat.typing", {});
    }
  };
  const startReply = useCallback((message: ApiMessage) => {
    setEditing(null);
    setReplyTo(message);
    inputRef.current?.focus();
  }, []);
  const startEdit = useCallback((message: ApiMessage) => {
    setReplyTo(null);
    setEditing(message);
    setInput(message.content);
    inputRef.current?.focus();
  }, []);
  const remove = useCallback(
    (message: ApiMessage) => {
      if (!window.confirm(tr("Delete this message?"))) return;
      sessionRef.current.sendCommand("chat.delete", { message_id: message.id });
    },
    [tr],
  );

  return (
    <DrawerFrame title={tr("Room chat")}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
        >
          {messages.length === 0 && (
            <p className="text-[13px] text-center text-[var(--text-loft-muted)] mt-10">
              {tr("No messages yet. Say hello.")}
            </p>
          )}
          {messages.map((message) => {
            const mine =
              !!selfId && message.sender_id === selfId && message.sender_type === selfType;
            return (
              <ChatMessageRow
                key={message.id}
                message={message}
                mine={mine}
                canDelete={!message.deleted && (mine || isOwner)}
                locale={locale}
                onReply={startReply}
                onEdit={startEdit}
                onDelete={remove}
              />
            );
          })}
        </div>
        {unseen > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-loft-primary)] shadow-md"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            {unseen === 1 ? tr("1 new message") : `${unseen} ${tr("new messages")}`}
          </button>
        )}
      </div>
      <TypingIndicator />
      {error && (
        <p className="px-4 pb-1 text-[13px] text-[var(--text-loft-primary)]">
          {tr(error)}
        </p>
      )}
      {(replyTo || editing) && (
        <div className="flex items-center gap-2 border-t border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 pt-2 text-[12px] text-[var(--text-loft-muted)]">
          {replyTo ? <Reply className="h-3.5 w-3.5 shrink-0" /> : <Pencil className="h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">
            {replyTo
              ? `${tr("Replying to")} ${replyTo.sender_display_name}: ${replyTo.content}`
              : tr("Editing message")}
          </span>
          <button type="button" onClick={resetComposer} className={chatAction} aria-label={tr("Cancel")} title={tr("Cancel")}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <form
        onSubmit={submit}
        className="flex gap-2 border-t border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3"
      >
        <input
          ref={inputRef}
          value={input}
          maxLength={2000}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && (replyTo || editing)) {
              event.stopPropagation();
              resetComposer();
            }
          }}
          aria-label={tr("Message")}
          placeholder={tr("Send a message…")}
          className="min-w-0 flex-1 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-4 py-3 text-[13px] outline-none focus:border-[var(--accent-blue)]"
        />
        <button
          disabled={!input.trim()}
          className="px-4 rounded-[10px] border border-transparent bg-[#101113] text-white text-[13px] transition-colors disabled:cursor-not-allowed disabled:border-[var(--border-loft)] disabled:bg-[var(--bg-loft-card)] disabled:text-[var(--text-loft-primary)] disabled:opacity-100"
        >
          {tr(editing ? "Save" : "Send")}
        </button>
      </form>
    </DrawerFrame>
  );
}

function PeopleDrawer() {
  const tr = useUIText();
  const people = useRoomStore((state) => state.participants);
  const room = useRoomStore((state) => state.room);
  const self = useRoomStore((state) => state.self);
  const host = useRoomStore((state) => state.host);
  const connection = useRoomStore((state) => state.connectionState);
  const session = useRoomSession();
  const locale = useI18nStore((state) => state.locale);
  const [joinRequests, setJoinRequests] = useState<
    Array<{ user_id: string; display_name: string; avatar_url?: string }>
  >([]);
  const [newJoinRequest, setNewJoinRequest] = useState(false);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | "unsupported">(
    () => (canNotify() ? Notification.permission : "unsupported"),
  );
  // The server-published host authority is authoritative. A participant role
  // is display state and can lag during reconnect/failover.
  const isHost = Boolean(
    self &&
    host &&
    host.state === "connected" &&
    host.connection_id === self.connection_id,
  );
  const [pendingModeration, setPendingModeration] = useState<{
    connectionId: string;
    name: string;
    action: "kick" | "ban";
  } | null>(null);
  const closeKickDialog = useCallback(() => setPendingModeration(null), []);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const closeReport = useCallback(() => setReporting(null), []);
  const lockRoom = () => {
    if (!room) return;
    useRoomStore.getState().setGovernanceError(null);
    session.sendCommand("room.lock", {
      locked: !room.is_locked,
      expected_version: room.version,
    });
  };
  const moderate = () => {
    if (!pendingModeration) return;
    useRoomStore.getState().setGovernanceError(null);
    const sent = session.sendCommand(
      pendingModeration.action === "ban"
        ? "participant.ban"
        : "participant.kick",
      pendingModeration.action === "ban"
        ? { connection_id: pendingModeration.connectionId, duration_hours: 1 }
        : { connection_id: pendingModeration.connectionId },
    );
    if (sent) setPendingModeration(null);
  };
  const handleParticipantAction = (
    person: (typeof people)[number],
    action: ParticipantAction,
  ) => {
    if (action === "report") {
      setReporting({ type: person.identity_type, id: person.identity_id, name: person.display_name });
      return;
    }
    if (action === "transfer") {
      if (room) {
        useRoomStore.getState().setGovernanceError(null);
        session.sendCommand("host.transfer", {
          target_connection_id: person.connection_id,
          expected_authority_version:
            useRoomStore.getState().host?.version ?? 0,
        });
      }
      return;
    }
    setPendingModeration({
      connectionId: person.connection_id,
      name: person.display_name,
      action,
    });
  };
  const roomId = room?.id;
  const isOwner = self?.identity_type === "user" && self.identity_id === room?.owner_id;
  const joinRequestsVersion = useRoomStore((state) => state.joinRequestsVersion);
  const knownRequestCount = useRef(0);
  // The server pushes "room.join_requests_changed" over the socket, so the list
  // is refetched on demand. A slow poll only covers missed signals.
  useEffect(() => {
    if (!isOwner || !roomId || !session.token || connection !== "CONNECTED") return;
    let active = true;
    const token = session.token;
    const refresh = async () => {
      try {
        const { requests } = await api.joinRequests(token, roomId);
        if (!active) return;
        if (requests.length > knownRequestCount.current) setNewJoinRequest(true);
        knownRequestCount.current = requests.length;
        setJoinRequests(requests);
      } catch {
        if (active) setJoinRequests([]);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isOwner, roomId, session.token, connection, joinRequestsVersion]);
  const resolveRequest = async (userID: string, approve: boolean) => {
    if (!room || !session.token) return;
    useRoomStore.getState().setGovernanceError(null);
    try {
      await api.resolveJoinRequest(session.token, room.id, userID, approve);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        useRoomStore.getState().joinRequestsChanged(false);
      } else {
        useRoomStore.getState().setGovernanceError(
          locale === "vi" ? "Không thể xử lý yêu cầu. Hãy thử lại." : "Could not resolve the request. Try again.",
        );
      }
      return;
    }
    setJoinRequests((current) => {
      const next = current.filter((item) => item.user_id !== userID);
      knownRequestCount.current = next.length;
      return next;
    });
  };
  return (
    <>
      <DrawerFrame title={`${tr("People")} · ${people.length}`}>
        {(isHost || isOwner) && room && (
          <div className="border-b border-[var(--border-loft)] bg-[var(--bg-loft-surface)] px-4 pb-4 pt-4">
            {isOwner && !room.allow_guests && notifyPermission === "default" && (
              <button
                type="button"
                onClick={() =>
                  void Notification.requestPermission()
                    .then(setNotifyPermission)
                    .catch(() => undefined)
                }
                className="mb-3 w-full rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-3 py-2 text-left text-[13px] text-[var(--text-loft-secondary)] hover-invert"
              >
                {tr("Notify me when someone asks to join")}
              </button>
            )}
            {isOwner && newJoinRequest && joinRequests.length > 0 && (
              <button
                type="button"
                onClick={() => setNewJoinRequest(false)}
                className="mb-3 w-full rounded-[10px] border border-[var(--accent-blue)] bg-[var(--bg-loft-card)] px-3 py-2 text-left text-[13px] font-medium text-[var(--text-loft-primary)] shadow-sm"
              >
                {locale === "vi"
                  ? "Có yêu cầu tham gia mới"
                  : "New join request"}
              </button>
            )}
            {isHost && <button
              type="button"
              onClick={lockRoom}
              disabled={connection !== "CONNECTED"}
              aria-pressed={room.is_locked}
              className="btn-press flex w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-3 py-2 text-[13px] font-medium hover-invert disabled:opacity-50"
            >
              {room.is_locked ? (
                <Unlock className="w-4 h-4" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              {tr(room.is_locked ? "Unlock room" : "Lock room")}
            </button>}
            {isOwner && !room.allow_guests && joinRequests.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[13px] font-medium text-[var(--text-loft-secondary)]">
                  {locale === "vi"
                    ? `Yêu cầu tham gia · ${joinRequests.length}`
                    : `Join requests · ${joinRequests.length}`}
                </p>
                {joinRequests.map((request) => (
                  <div
                    key={request.user_id}
                    className="flex items-center gap-2 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-2 text-[13px] shadow-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {request.display_name}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void resolveRequest(request.user_id, false)
                      }
                      className="rounded-[5px] px-2 py-1 text-[var(--text-loft-secondary)] hover-invert"
                    >
                      {locale === "vi" ? "Từ chối" : "Decline"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void resolveRequest(request.user_id, true)}
                      className="btn-press rounded-[5px] bg-[#101113] px-2 py-1 text-white"
                    >
                      {locale === "vi" ? "Duyệt" : "Approve"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {people.map((person) => (
            <div
              key={person.connection_id}
              className="flex items-center gap-3 rounded-[10px] border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-3 shadow-sm transition-colors hover:bg-[var(--bg-loft-card)]"
            >
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[var(--border-loft)] bg-[var(--border-loft-light)] font-medium text-[var(--text-loft-primary)]">
                {person.avatar_url ? (
                  <img
                    src={person.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  person.display_name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">
                  {person.display_name}
                </div>
                <div className="text-[13px] text-[var(--text-loft-muted)] capitalize">
                  {tr(person.identity_type === "guest" ? "Guest" : "User")}
                </div>
              </div>
              {person.role === "host" && (
                <span
                  title={tr("Host")}
                  className="flex items-center gap-1 rounded-full border border-[var(--border-loft)] bg-[var(--bg-loft-card)] px-2 py-1 text-[13px] text-[var(--text-loft-secondary)]"
                >
                  <Crown className="w-3.5 h-3.5" /> {tr("Host")}
                </span>
              )}
              {person.connection_id !== self?.connection_id &&
                person.identity_id !== self?.identity_id && (
                  <ParticipantMenu
                    participant={person}
                    canModerate={isHost && person.role !== "host"}
                    canTransfer={Boolean(
                      room && person.identity_type === "user",
                    )}
                    disabled={isHost && connection !== "CONNECTED"}
                    onAction={(action) =>
                      handleParticipantAction(person, action)
                    }
                  />
                )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--border-loft)] bg-[var(--bg-loft-surface)] p-4 text-[13px] text-[var(--text-loft-secondary)]">
          <Settings2 className="w-4 h-4 shrink-0" />
          <span className="min-w-0 flex-1">{tr("Presence follows active browser connections.")}</span>
          {room && session.credential && (
            <button
              type="button"
              onClick={() => setReporting({ type: "room", id: room.id, name: room.name })}
              className="btn-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] hover-invert"
            >
              <Flag className="h-4 w-4" aria-hidden="true" /> {tr("Report room")}
            </button>
          )}
        </div>
      </DrawerFrame>
      {reporting && room && session.credential && (
        <ReportDialog roomId={room.id} credential={session.credential} target={reporting} onClose={closeReport} />
      )}
      {pendingModeration && (
        <KickParticipantDialog
          name={pendingModeration.name}
          action={pendingModeration.action}
          onCancel={closeKickDialog}
          onConfirm={moderate}
        />
      )}
    </>
  );
}
