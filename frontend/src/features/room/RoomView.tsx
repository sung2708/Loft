"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  Copy,
  Crown,
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
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { EASE_ENTRANCE } from "@/lib/motion";
import { AppHeader } from "@/components/layout/AppHeader";
import { useChatStore } from "@/stores/useChatStore";
import { useRoomStore } from "@/stores/useRoomStore";
import { useUIStore } from "@/stores/useUIStore";
import { EmptyStage, MediaStage, useRoomSession } from "./RoomSession";
import { MusicDrawer } from "./MusicDrawer";
import { useReactionStore } from "@/stores/useReactionStore";
import { useUIText } from "@/lib/i18n/uiText";
import { useI18nStore } from "@/lib/i18n/useTranslation";
import { KickParticipantDialog } from "@/components/room/KickParticipantDialog";
import { ParticipantMenu, type ParticipantAction } from "@/components/room/ParticipantMenu";
import { SocialActions } from "@/components/room/SocialActions";
import { VideoEffectsPanel } from "@/components/room/VideoEffectsPanel";
import { useVideoEffectsStore } from "@/stores/useVideoEffectsStore";
import { RoomAtmosphere } from "./RoomAtmosphere";
import { SettingsDrawer } from "./SettingsDrawer";

export function RoomView() {
  const drawer = useUIStore((state) => state.activeDrawer);
  const connection = useRoomStore((state) => state.connectionState);
  const room = useRoomStore((state) => state.room);
  return (
    <main className="fixed inset-0 overflow-hidden flex flex-col bg-[var(--bg-loft-base)] text-[var(--text-loft-primary)]">
      <RoomHeader />
      <ConnectionBadge />
      <GovernanceNotice />
      <div className="relative flex-1 min-h-0 flex">
        <motion.section
          layout
          transition={{ duration: 0.5, ease: EASE_ENTRANCE }}
          className={`flex-1 min-w-0 flex flex-col ${drawer ? "" : ""}`}
        >
          <div className="flex-1 min-h-0">
            {room && connection === "CONNECTED" ? <Stage /> : <RoomLoading />}
          </div>
          <CallDock />
        </motion.section>
        <AnimatePresence mode="wait">
          {drawer === "chat" && <ChatDrawer />}
          {drawer === "people" && <PeopleDrawer />}
          {drawer === "settings" && <SettingsDrawer />}
        </AnimatePresence>
        <MusicDrawer open={drawer === "music"} onClose={() => useUIStore.getState().closeDrawer()} />
      </div>
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
    const timer = setInterval(() => useReactionStore.getState().clearExpired(Date.now()), 500);
    return () => clearInterval(timer);
  }, [reactions.length]);
  return (
    <RoomAtmosphere screenShare={media.screenEnabled}>
      <div className="relative w-full h-full">
        {media.mediaConnected ? <MediaStage /> : <EmptyStage />}
        {media.mediaError && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-[6px] bg-[#101113]/15 border border-[var(--border-loft)]/30 text-[var(--text-loft-primary)] text-[11px] z-50 flex items-center gap-2 max-w-[90vw] text-center shadow-lg backdrop-blur-md">
            <span>{media.mediaError.replace(/\.+$/, "")}. {tr("Chat remains available.")}</span>
            <button
              type="button"
              onClick={() => media.clearMediaError?.()}
              className="ml-1 p-1 rounded-[6px] text-[var(--text-loft-primary)] hover-invert hover:bg-[var(--border-loft)] transition-colors"
              aria-label={tr("Close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div aria-live="polite" className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 max-w-[90%] overflow-hidden">
          {reactions.map((reaction) => <motion.div key={reaction.emoji} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -24 }} transition={{ duration: reducedMotion ? 0.2 : 0.2 }} className="rounded-full bg-[var(--bg-loft-card)]/90 border border-[var(--border-loft)] shadow-lg px-3 py-1 text-[11px]" title={reaction.displayName} aria-label={`${reaction.displayName}: ${reaction.emoji}`}>{reaction.emoji}{reaction.count > 1 && <span className="ml-1 text-[11px] font-medium">×{reaction.count}</span>}</motion.div>)}
        </div>
      </div>
    </RoomAtmosphere>
  );
}

function RoomLoading() {
  const tr = useUIText();
  const state = useRoomStore((item) => item.connectionState);
  const error = useRoomStore((item) => item.connectionError);
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="glass-card rounded-[6px] p-8 text-center max-w-sm">
        <div className="w-10 h-10 rounded-full border-2 border-[var(--border-loft)]/20 border-t-[#101113] animate-spin mx-auto mb-4" />
        <h2 className="font-medium">
          {tr(state === "FAILED" ? "Couldn’t join room" : "Opening your Mingly room…")}
        </h2>
        <p className="text-[11px] text-[var(--text-loft-secondary)] mt-2">
          {tr(error ?? "Syncing current room state.")}
        </p>
        {state === "FAILED" && (
          <button
            onClick={() => location.reload()}
            className="mt-4 px-4 py-2 rounded-[6px] bg-[#101113] text-white text-[11px]"
          >
            {tr("Try again")}
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
        {count} {tr("present")} · {tr(room?.allow_guests ? "Guests welcome" : "Members only")}
      </span>
      {room?.is_locked ? (
        <span className="inline-flex shrink-0 items-center gap-1" title={tr("Room locked")}>
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
          className="btn-press h-8 px-3 rounded-full border border-[var(--border-loft)] text-[11px] flex items-center gap-2"
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
            ((self?.identity_type === "user" && self.identity_id === room.owner_id) ||
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
              className="absolute right-0 top-full mt-2 z-50 min-w-52 rounded-[6px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-2 shadow-xl"
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
                  className="w-full rounded-[6px] px-3 py-2 text-left text-[11px] capitalize text-[var(--text-loft-primary)] hover-invert hover:bg-[var(--border-loft-light)] flex items-center justify-between gap-3"
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
          className="w-8 h-8 rounded-full bg-[#101113]/15 text-[var(--text-loft-primary)] flex items-center justify-center font-medium text-[11px] overflow-hidden"
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
  const state = useRoomStore((item) => item.connectionState);
  const visible = state !== "CONNECTED";
  if (!visible) return null;
  const failed = state === "FAILED";
  return (
    <div
      className={`absolute top-16 left-1/2 -translate-x-1/2 z-50 px-3 py-2 rounded-full shadow-lg text-[11px] flex items-center gap-2 ${failed ? "bg-[#101113] text-white" : "bg-[var(--bg-loft-card)] border border-[var(--border-loft)]"}`}
    >
      {failed ? (
        <WifiOff className="w-3.5 h-3.5" />
      ) : (
        <Wifi className="w-3.5 h-3.5 animate-pulse" />
      )}
      {tr(state === "RESYNCING"
        ? "Resyncing…"
        : state === "RECONNECTING"
          ? "Reconnecting…"
          : failed
            ? "Offline"
            : "Connecting…")}
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
      className="absolute top-24 left-1/2 -translate-x-1/2 z-50 max-w-[min(32rem,calc(100vw-2rem))] px-4 py-2 rounded-[6px] bg-[#101113]/15 border border-[var(--border-loft)]/30 text-[var(--text-loft-primary)] text-[11px] flex items-center gap-3 shadow-lg backdrop-blur-md"
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

function CallDock() {
  const tr = useUIText();
  const media = useRoomSession();
  const drawer = useUIStore((state) => state.activeDrawer);
  const toggleDrawer = useUIStore((state) => state.toggleDrawer);
  const unread = useChatStore((state) => state.unreadCount);
  const count = useRoomStore((state) => state.participants.length);
  const self = useRoomStore((state) => state.self);
  const effectsOpen = useVideoEffectsStore((state) => state.panelOpen);
  const setEffectsOpen = useVideoEffectsStore((state) => state.setPanelOpen);
  const effectsTriggerRef = useRef<HTMLButtonElement>(null);

  const sendReaction = (emoji: string) => media.sendCommand("reaction.send", { emoji });
  const sendWave = () => media.sendCommand("wave.send", {});
  const toggleHand = () => media.sendCommand("participant.hand.set", {
    raised: !(self?.raised_hand ?? false),
    expected_social_version: self?.social_version ?? 0,
  });
  const control =
    "btn-press relative w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border border-[var(--border-loft)]";
  return (
    <div className="flex-shrink-0 pb-[calc(.75rem+env(safe-area-inset-bottom))] px-2 flex justify-center">
      <div className="relative glass-dock rounded-full shadow-2xl p-2 flex items-center gap-1 sm:gap-2">
        <button
          disabled={!media.mediaConnected}
          onClick={() => void media.toggleMic()}
          className={`${control} disabled:opacity-40 disabled:cursor-not-allowed ${media.micEnabled ? "" : "bg-[#101113] text-white"}`}
          title={tr("Microphone")}
        >
          {media.micEnabled ? (
            <Mic className="w-4 h-4" />
          ) : (
            <MicOff className="w-4 h-4" />
          )}
        </button>
        <button
          ref={effectsTriggerRef}
          disabled={!media.mediaConnected}
          onClick={() => setEffectsOpen(!effectsOpen)}
          aria-expanded={effectsOpen}
          aria-haspopup="dialog"
          className={`${control} disabled:opacity-40 disabled:cursor-not-allowed ${effectsOpen ? "bg-[#101113] text-white" : ""}`}
          title={tr("Video effects")}
          aria-label={tr("Video effects")}
        >
          <Sparkles className="w-4 h-4" />
        </button>
        {effectsOpen && <VideoEffectsPanel cameraEnabled={media.cameraEnabled} triggerRef={effectsTriggerRef} />}
        <button
          disabled={!media.mediaConnected}
          onClick={() => void media.toggleCamera()}
          className={`${control} disabled:opacity-40 disabled:cursor-not-allowed ${media.cameraEnabled ? "" : "bg-[#101113] text-white"}`}
          title={tr("Camera")}
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
        >
          <MonitorUp className="w-4 h-4" />
        </button>
        <span className="w-px h-6 bg-[var(--border-loft)]" />
        <button
          onClick={() => toggleDrawer("chat")}
          className={`${control} ${drawer === "chat" ? "bg-[#101113] text-white" : ""}`}
          title={tr("Chat")}
        >
          <MessageSquare className="w-4 h-4" />
          {unread > 0 && drawer !== "chat" && (
            <b className="absolute -top-1 -right-1 bg-[#101113] text-white rounded-full min-w-4 h-4 text-[11px] flex items-center justify-center">
              {unread}
            </b>
          )}
        </button>
        <button
          onClick={() => toggleDrawer("people")}
          className={`${control} ${drawer === "people" ? "bg-[#101113] text-white" : ""}`}
          title={tr("People")}
        >
          <Users className="w-4 h-4" />
          <b className="absolute -top-1 -right-1 bg-[var(--bg-loft-card)] border border-[var(--border-loft)] rounded-full min-w-4 h-4 text-[11px] flex items-center justify-center">
            {count}
          </b>
        </button>
        <button onClick={() => toggleDrawer("music")} className={`${control} ${drawer === "music" ? "bg-[#101113] text-white" : ""}`} title={tr("Shared Queue")} aria-label={tr("Shared Queue")}><Music2 className="w-4 h-4" /></button>
        <span className="w-px h-6 bg-[var(--border-loft)]" />
        <SocialActions
          raised={self?.raised_hand ?? false}
          disabled={useRoomStore.getState().connectionState !== "CONNECTED"}
          onReaction={sendReaction}
          onWave={sendWave}
          onToggleHand={toggleHand}
          controlClass={control}
        />
        <span className="w-px h-6 bg-[var(--border-loft)]" />
        <button
          onClick={media.leave}
          className={`${control} bg-[#101113]/15 text-[var(--text-loft-primary)] hover:bg-[#101113] hover:text-white`}
          title={tr("Leave")}
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  return (
    <motion.aside
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.5, ease: EASE_ENTRANCE }}
      className="fixed top-14 right-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-0 w-full md:w-96 glass-drawer shadow-2xl z-40 flex flex-col"
    >
      <div className="h-14 px-5 flex items-center justify-between border-b border-[var(--border-loft)]">
        <h3 className="font-medium text-[11px]">{title}</h3>
        <button
          onClick={close}
          aria-label={tr("Close")}
          className="w-8 h-8 rounded-full hover-invert hover:bg-[var(--border-loft)] hover:text-[var(--bg-loft-base)] flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </motion.aside>
  );
}

function renderMessageContent(content: string, isMine?: boolean) {
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]!?\s]|www\.[^\s<]+[^<.,:;"')\]!?\s])/gi;
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

function ChatDrawer() {
  const tr = useUIText();
  const locale = useI18nStore((state) => state.locale);
  const messages = useChatStore((state) => state.messages);
  const error = useChatStore((state) => state.sendError);
  const self = useRoomStore((state) => state.self);
  const session = useRoomSession();
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value || value.length > 2000) return;
    if (session.sendChat(value)) setInput("");
  };
  return (
    <DrawerFrame title={tr("Room chat")}>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-[11px] text-center text-[var(--text-loft-muted)] mt-10">
            {tr("No messages yet. Say hello.")}
          </p>
        )}
        {messages.map((message) => {
          const isSystem = message.sender_id === "system" || message.sender_id === "";
          if (isSystem) {
            return (
              <div key={message.id} className="flex justify-center my-2">
                <span className="text-[11px] px-3 py-1 rounded-full bg-[var(--border-loft-light)] text-[var(--text-loft-muted)] border border-[var(--border-loft)] text-center max-w-[90%] break-words">
                  {renderMessageContent(message.content)}
                </span>
              </div>
            );
          }

          const mine = message.sender_id === self?.identity_id;
          return (
            <div
              key={message.id}
              className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
            >
              <div
                className={`flex items-center gap-2 mb-1 px-1 text-[11px] text-[var(--text-loft-muted)] ${
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
              </div>
              <div
                className={`max-w-[85%] px-4 py-2 rounded-[6px] text-[11px] break-words whitespace-pre-wrap leading-relaxed ${
                  mine
                    ? "bg-[#101113] text-white rounded-br-[6px] shadow-xs"
                    : "bg-[var(--bg-loft-card)] text-[var(--text-loft-primary)] border border-[var(--border-loft)] rounded-bl-[6px] shadow-xs"
                }`}
              >
                {renderMessageContent(message.content, mine)}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {error && <p className="px-4 pb-1 text-[11px] text-[var(--text-loft-primary)]">{tr(error)}</p>}
      <form
        onSubmit={submit}
        className="p-3 border-t border-[var(--border-loft)] flex gap-2"
      >
        <input
          value={input}
          maxLength={2000}
          onChange={(event) => setInput(event.target.value)}
          aria-label={tr("Message")}
          placeholder={tr("Send a message…")}
          className="flex-1 min-w-0 px-4 py-3 rounded-[6px] bg-[var(--border-loft-light)] border border-[var(--border-loft)] outline-none focus:border-[var(--border-loft)] text-[11px]"
        />
        <button
          disabled={!input.trim()}
          className="px-4 rounded-[6px] bg-[#101113] hover:bg-[#101113] text-white text-[11px] disabled:opacity-40 transition-colors"
        >
          {tr("Send")}
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
  const connection = useRoomStore((state) => state.connectionState);
  const session = useRoomSession();
  const isHost = self?.role === "host";
  const [pendingModeration, setPendingModeration] = useState<{ connectionId: string; name: string; action: "kick" | "ban" } | null>(null);
  const closeKickDialog = useCallback(() => setPendingModeration(null), []);
  const lockRoom = () => {
    if (!room) return;
    useRoomStore.getState().setGovernanceError(null);
    session.sendCommand("room.lock", { locked: !room.is_locked, expected_version: room.version });
  };
  const moderate = () => {
    if (!pendingModeration) return;
    useRoomStore.getState().setGovernanceError(null);
    const sent = session.sendCommand(
      pendingModeration.action === "ban" ? "participant.ban" : "participant.kick",
      pendingModeration.action === "ban"
        ? { connection_id: pendingModeration.connectionId, duration_hours: 1 }
        : { connection_id: pendingModeration.connectionId },
    );
    if (sent) setPendingModeration(null);
  };
  const handleParticipantAction = (person: (typeof people)[number], action: ParticipantAction) => {
    if (action === "transfer") {
      if (room) {
        useRoomStore.getState().setGovernanceError(null);
        session.sendCommand("host.transfer", {
          target_connection_id: person.connection_id,
          expected_authority_version: useRoomStore.getState().host?.version ?? 0,
        });
      }
      return;
    }
    setPendingModeration({ connectionId: person.connection_id, name: person.display_name, action });
  };
  return (
    <>
      <DrawerFrame title={`${tr("People")} · ${people.length}`}>
        {isHost && room && (
          <div className="px-4 pt-4">
            <button
              type="button"
              onClick={lockRoom}
              disabled={connection !== "CONNECTED"}
              aria-pressed={room.is_locked}
              className="w-full flex items-center justify-center gap-2 rounded-[6px] border border-[var(--border-loft)] bg-[var(--border-loft-light)] px-3 py-2 text-[11px] font-medium hover:bg-[var(--bg-loft-card)] disabled:opacity-50"
            >
              {room.is_locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {tr(room.is_locked ? "Unlock room" : "Lock room")}
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {people.map((person) => (
            <div
              key={person.connection_id}
              className="p-3 rounded-[6px] border border-[var(--border-loft)] bg-[var(--border-loft-light)] flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-full bg-[#101113]/15 text-[var(--text-loft-primary)] overflow-hidden flex items-center justify-center font-medium">
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
                <div className="text-[11px] font-medium truncate">
                  {person.display_name}
                </div>
                <div className="text-[11px] text-[var(--text-loft-muted)] capitalize">
                  {tr(person.identity_type === "guest" ? "Guest" : "User")}
                </div>
              </div>
              {person.role === "host" && (
                <span
                  title={tr("Host")}
                  className="flex items-center gap-1 text-[11px] text-[var(--text-loft-secondary)]"
                >
                  <Crown className="w-3.5 h-3.5" /> {tr("Host")}
                </span>
              )}
              {isHost && person.role !== "host" && person.connection_id !== self?.connection_id && (
                <ParticipantMenu
                  participant={person}
                  canTransfer={Boolean(room && person.identity_type === "user")}
                  disabled={connection !== "CONNECTED"}
                  onAction={(action) => handleParticipantAction(person, action)}
                />
              )}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-[var(--border-loft)] text-[11px] text-[var(--text-loft-secondary)] flex items-center gap-2">
          <Settings2 className="w-4 h-4" /> {tr("Presence follows active browser connections.")}
        </div>
      </DrawerFrame>
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
