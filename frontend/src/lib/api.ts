import { API_URL } from "./config";
import { translateUI } from "./i18n/uiText";
import { useI18nStore } from "./i18n/useTranslation";
import type {
  ApiIdentity,
  ApiMessage,
  ApiRoom,
  ApiRoomPreview,
  RoomCredential,
} from "@/types/api";

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  credential?: RoomCredential | string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null) headers.set("Content-Type", "application/json");
  if (typeof credential === "string")
    headers.set("Authorization", `Bearer ${credential}`);
  else if (credential?.type === "guest")
    headers.set("X-Guest-Token", credential.token);
  else if (credential)
    headers.set("Authorization", `Bearer ${credential.token}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(
      body.error?.code ?? "REQUEST_FAILED",
      translateUI(
        useI18nStore.getState().locale,
        body.error?.message ?? "Request failed",
      ),
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  resolveRoom: (value: string, signal?: AbortSignal) =>
    request<{ room: ApiRoomPreview }>(
      `/api/v1/rooms/resolve?value=${encodeURIComponent(value)}`,
      { signal },
    ),
  room: (id: string) =>
    request<ApiRoomPreview>(`/api/v1/rooms/${encodeURIComponent(id)}`),
  createGuest: (id: string, displayName: string, password = "") =>
    request<{
      token: string;
      guest_id: string;
      display_name: string;
      room_id: string;
    }>(`/api/v1/rooms/${encodeURIComponent(id)}/guest-session`, {
      method: "POST",
      body: JSON.stringify({ display_name: displayName, password }),
    }),
  requestRoomAccess: (token: string, id: string) =>
    request<{ status: "pending" | "approved" | "not_required" }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/join-requests`,
      { method: "POST" },
      token,
    ),
  joinRequests: (token: string, id: string) =>
    request<{
      requests: Array<{
        user_id: string;
        display_name: string;
        avatar_url?: string;
        requested_at: string;
      }>;
    }>(`/api/v1/rooms/${encodeURIComponent(id)}/join-requests`, {}, token),
  resolveJoinRequest: (
    token: string,
    roomID: string,
    userID: string,
    approve: boolean,
  ) =>
    request<{ approved: boolean }>(
      `/api/v1/rooms/${encodeURIComponent(roomID)}/join-requests/${encodeURIComponent(userID)}`,
      { method: "PATCH", body: JSON.stringify({ approve }) },
      token,
    ),
  me: (token: string) => request<ApiIdentity>("/api/v1/users/me", {}, token),
  rooms: (token: string) =>
    request<{ rooms: ApiRoom[] }>("/api/v1/rooms", {}, token),
  createRoom: (
    token: string,
    name: string,
    allowGuests: boolean,
    passwordEnabled = false,
    password = "",
  ) =>
    request<ApiRoom>(
      "/api/v1/rooms",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          allow_guests: allowGuests,
          password_enabled: passwordEnabled,
          password,
        }),
      },
      token,
    ),
  deleteRoom: (token: string, id: string) =>
    request<void>(
      `/api/v1/rooms/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      token,
    ),
  updateRoom: (
    token: string,
    id: string,
    input: {
      expected_version: number;
      name: string;
      allow_guests: boolean;
      password_enabled: boolean;
      password?: string;
      locked: boolean;
    },
  ) =>
    request<ApiRoom>(
      `/api/v1/rooms/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
      token,
    ),
  messages: (id: string, credential: RoomCredential) =>
    request<{ messages: ApiMessage[] }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/messages`,
      {},
      credential,
    ),
  liveKitToken: (id: string, credential: RoomCredential) =>
    request<{ token: string }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/livekit-token`,
      { method: "POST" },
      credential,
    ),
};

export function credentialKey(roomId: string) {
  return `loft.room.${roomId}.credential`;
}
export function saveCredential(roomId: string, credential: RoomCredential) {
  sessionStorage.setItem(credentialKey(roomId), JSON.stringify(credential));
}
export function loadCredential(roomId: string): RoomCredential | null {
  try {
    const value = sessionStorage.getItem(credentialKey(roomId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<RoomCredential>;
    if (
      typeof parsed.token !== "string" ||
      (parsed.type !== "user" && parsed.type !== "guest") ||
      parsed.roomId !== roomId ||
      typeof parsed.displayName !== "string"
    )
      return null;
    return parsed as RoomCredential;
  } catch {
    return null;
  }
}

export function clearCredential(roomId: string) {
  sessionStorage.removeItem(credentialKey(roomId));
}

export function clearRoomCredentials() {
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith("loft.room.") && key.endsWith(".credential")) {
      sessionStorage.removeItem(key);
    }
  }
}
