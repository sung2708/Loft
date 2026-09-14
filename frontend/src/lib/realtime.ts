import { WS_URL } from "./config";
import type { ConnectionState, RoomCredential, ServerEvent } from "@/types/api";

interface Callbacks {
  getCredential?: () => Promise<RoomCredential>;
  onEvent: (event: ServerEvent) => void;
  onState: (state: ConnectionState, error?: string) => void;
}

export function reconnectDelay(retry: number, random = Math.random()) {
  const base = Math.min(15_000, 500 * 2 ** Math.max(0, retry - 1));
  return base * (0.75 + random * 0.5);
}

function tabSessionID(roomId: string): string {
  const key = `loft.room.tab-session.${roomId}`;
  const navigation = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  const isReload = navigation?.type === "reload";
  const saved = isReload ? sessionStorage.getItem(key) : null;
  if (saved) return saved;

  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

export class RoomSocket {
  private socket: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private attempt = 0;
  private ready = false;
  private lastReceived = 0;
  private retryError: string | undefined;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly tabSessionId: string;
  constructor(
    private credential: RoomCredential,
    private readonly callbacks: Callbacks,
  ) {
    this.tabSessionId = tabSessionID(credential.roomId);
  }

  async connect() {
    if (this.stopped) return;
    const attempt = ++this.attempt;
    this.ready = false;
    this.callbacks.onState(this.retry ? "RECONNECTING" : "CONNECTING");
    try {
      const credential = await this.callbacks.getCredential?.();
      if (this.stopped || attempt !== this.attempt) return;
      if (credential) this.credential = credential;
    } catch {
      if (!this.stopped && attempt === this.attempt) this.scheduleReconnect();
      return;
    }
    const socket = new WebSocket(`${WS_URL}/ws`);
    this.socket = socket;
    this.deadline = setTimeout(() => this.expire(socket), 15_000);
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      this.lastReceived = Date.now();
      this.callbacks.onState(this.retry ? "RESYNCING" : "CONNECTING");
      socket.send(
        JSON.stringify({
          type: "connection.auth",
          version: 1,
          event_id: crypto.randomUUID(),
          room_id: this.credential.roomId,
          payload: {
            token: this.credential.token,
            room_id: this.credential.roomId,
            tab_session_id: this.tabSessionId,
          },
        }),
      );
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastReceived > 45_000) this.expire(socket);
        else this.send("connection.ping", { client_time: Date.now() });
      }, 10_000);
      this.send("connection.ping", { client_time: Date.now() });
    };
    socket.onmessage = (message) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const event = JSON.parse(String(message.data)) as ServerEvent;
        this.lastReceived = Date.now();
        if (event.type === "room.snapshot") {
          this.retry = 0;
          this.retryError = undefined;
          this.ready = true;
          if (this.deadline) clearTimeout(this.deadline);
          this.deadline = null;
        }
        if (event.type === "error" && event.payload.code === "ROOM_FULL") {
          this.close();
          this.callbacks.onState("FAILED", "Room is full. Try again after someone leaves.");
          return;
        }
        if (event.type === "error" && event.payload.code === "DUPLICATE_SESSION") {
          this.retryError = "This room is open in another tab. Close that tab to join here.";
          this.callbacks.onState("RECONNECTING", this.retryError);
          return;
        }
        this.callbacks.onEvent(event);
      } catch {
        this.callbacks.onState(
          "FAILED",
          "Server sent an invalid realtime event",
        );
      }
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.clearHeartbeat();
      this.ready = false;
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private expire(socket: WebSocket) {
    if (this.stopped || this.socket !== socket) return;
    this.socket = null;
    this.ready = false;
    this.clearHeartbeat();
    socket.close();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
      this.retry += 1;
      if (this.retry > 8) {
        this.callbacks.onState(
          "FAILED",
          this.retryError ?? "Could not reconnect. Check your connection.",
        );
        return;
      }
      this.callbacks.onState("RECONNECTING", this.retryError);
      this.timer = setTimeout(() => this.connect(), reconnectDelay(this.retry));
  }

  send(
    type:
      | "chat.send"
      | "connection.ping"
      | "room.leave"
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
      | "reaction.send",
    payload: object,
  ) {
    if (this.socket?.readyState !== WebSocket.OPEN || (!this.ready && type !== "connection.ping" && type !== "room.leave")) return false;
    this.socket.send(
      JSON.stringify({
        type,
        version: 1,
        event_id: crypto.randomUUID(),
        room_id: this.credential.roomId,
        payload,
      }),
    );
    return true;
  }

  close(explicit = false) {
    if (explicit) {
      this.send("room.leave", {});
    }
    this.stopped = true;
    this.attempt += 1;
    this.ready = false;
    if (this.timer) clearTimeout(this.timer);
    this.clearHeartbeat();
    this.socket?.close(1000, "leaving room");
    this.socket = null;
  }

  private clearHeartbeat() {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
