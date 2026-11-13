import { getSupabase } from "./supabase/client";
import { API_URL } from "./config";
import { translateUI } from "./i18n/uiText";
import { useI18nStore } from "./i18n/useTranslation";
import type {
  AccountProfile,
  AccountSuspension,
  AdminAuditFilter,
  AdminReport,
  AdminUserDetail,
  AdminUserStatus,
  LiveCounts,
  ModerationReason,
  OwnSuspension,
  RecentRoom,
  ReportStatus,
  ReportTargetType,
  CallFeedbackPayload,
  CallQualitySummary,
  AdminAuditEntry,
  AdminOverview,
  AdminPage,
  AdminRoom,
  AdminUser,
  ApiIdentity,
  ApiMessage,
  ApiRoom,
  ApiRoomPreview,
  RoomCredential,
} from "@/types/api";

interface ApiErrorBody {
  error?: { code?: string; message?: string; suspension?: OwnSuspension };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    /** Present on ACCOUNT_SUSPENDED: the member's own suspension. */
    public readonly suspension?: OwnSuspension,
  ) {
    super(message);
  }
}

const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  ).toString();

/** Downloads an authenticated response as a file, keeping the server's name. */
async function download(path: string, token: string, fallbackName: string) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(
      body.error?.code ?? "REQUEST_FAILED",
      translateUI(useI18nStore.getState().locale, body.error?.message ?? "Request failed"),
      response.status,
    );
  }
  const name =
    /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ??
    fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  credential?: RoomCredential | string,
): Promise<T> {
  // Room credentials may outlive a Supabase access token; read its refreshed session.
  if (typeof credential === "object" && credential?.type === "user") {
    const supabase = getSupabase();
    if (supabase) {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) throw new ApiError("UNAUTHORIZED", "Sign in again to continue", 401);
      credential = { ...credential, token: session.access_token };
    }
  }
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
  if (response.status === 304) return undefined as T;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(
      body.error?.code ?? "REQUEST_FAILED",
      translateUI(
        useI18nStore.getState().locale,
        body.error?.message ?? "Request failed",
      ),
      response.status,
      body.error?.suspension,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  adminEndRoom: (token: string, id: string, reason: string, note: string) => request<void>(`/api/v1/admin/rooms/${encodeURIComponent(id)}/end`, { method: "POST", body: JSON.stringify({ reason, note }) }, token),
  adminSuspendUser: (token: string, id: string, reason: string, note: string, days: number) =>
    request<AccountSuspension>(`/api/v1/admin/users/${encodeURIComponent(id)}/suspension`, { method: "POST", body: JSON.stringify({ reason, note, days }) }, token),
  adminLiftSuspension: (token: string, id: string) =>
    request<void>(`/api/v1/admin/users/${encodeURIComponent(id)}/suspension`, { method: "DELETE" }, token),
  adminAudit: (token: string, filter: AdminAuditFilter = {}, limit = 25, offset = 0) =>
    request<AdminPage<AdminAuditEntry>>(`/api/v1/admin/audit?${query({ ...filter, limit, offset })}`, {}, token),
  adminAuditExport: (token: string, filter: AdminAuditFilter = {}) =>
    download(`/api/v1/admin/audit/export?${query({ ...filter })}`, token, "mingly-audit.csv"),
  adminReports: (token: string, status: ReportStatus = "open", limit = 25, offset = 0) =>
    request<AdminPage<AdminReport>>(`/api/v1/admin/reports?${query({ status, limit, offset })}`, {}, token),
  adminResolveReport: (token: string, id: number, status: Exclude<ReportStatus, "open">, note = "") =>
    request<AdminReport>(`/api/v1/admin/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status, note }) }, token),
  adminUser: (token: string, id: string) =>
    request<AdminUserDetail>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {}, token),
  adminCallQuality: (token: string) =>
    request<CallQualitySummary>("/api/v1/admin/call-quality", {}, token),
  adminOverview: (token: string) =>
    request<AdminOverview>("/api/v1/admin/overview", {}, token),
  adminUsers: (token: string, q = "", limit = 25, offset = 0, status: AdminUserStatus = "") =>
    request<AdminPage<AdminUser>>(`/api/v1/admin/users?${query({ q, limit, offset, status })}`, {}, token),
  adminRooms: (token: string, query = "", limit = 25, offset = 0, status = "", owner = "") =>
    request<AdminPage<AdminRoom>>(
      `/api/v1/admin/rooms?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&status=${encodeURIComponent(status)}&owner=${encodeURIComponent(owner)}`,
      {},
      token,
    ),
 endRoom: (id:string,credential:RoomCredential)=>request<void>(`/api/v1/rooms/${encodeURIComponent(id)}/end`,{method:"POST"},credential),
 board: (id:string,credential:RoomCredential,signal?:AbortSignal,version?:number) => request<import("./whiteboard").BoardSnapshot | undefined>(`/api/v1/rooms/${encodeURIComponent(id)}/whiteboard`,{signal,headers:version === undefined ? undefined : {"If-None-Match": `"board-${version}"`}},credential),
 saveBoard: (id:string,credential:RoomCredential,patch:import("./whiteboard").BoardPatch,signal?:AbortSignal) => request<import("./whiteboard").BoardSaveResult>(`/api/v1/rooms/${encodeURIComponent(id)}/whiteboard?ack=minimal`,{method:"PATCH",body:JSON.stringify(patch),signal},credential),
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
  account: (token: string) => request<AccountProfile>("/api/v1/users/me/account", {}, token),
  updateAccount: (token: string, input: { display_name: string | null; hide_avatar: boolean }) =>
    request<AccountProfile>("/api/v1/users/me", { method: "PATCH", body: JSON.stringify(input) }, token),
  scheduleAccountDeletion: (token: string) =>
    request<{ deletion_scheduled_for: string }>("/api/v1/users/me/deletion", { method: "POST", body: JSON.stringify({ confirm: "DELETE" }) }, token),
  cancelAccountDeletion: (token: string) =>
    request<void>("/api/v1/users/me/deletion", { method: "DELETE" }, token),
  exportAccount: (token: string) => download("/api/v1/users/me/export", token, "mingly-data.json"),
  rooms: (token: string) =>
    request<{ rooms: ApiRoom[]; live?: LiveCounts }>("/api/v1/rooms", {}, token),
  recentRooms: (token: string) =>
    request<{ rooms: RecentRoom[]; live?: LiveCounts }>("/api/v1/rooms/recent", {}, token),
  forgetRecentRoom: (token: string, id: string) =>
    request<void>(`/api/v1/rooms/${encodeURIComponent(id)}/visit`, { method: "DELETE" }, token),
  report: (
    id: string,
    credential: RoomCredential,
    input: { target_type: ReportTargetType; target_id: string; target_name: string; reason: ModerationReason; details: string },
  ) =>
    request<{ id: number; status: ReportStatus }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/reports`,
      { method: "POST", body: JSON.stringify(input) },
      credential,
    ),
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
  callFeedback: (id: string, credential: RoomCredential, feedback: CallFeedbackPayload) =>
    request<void>(
      `/api/v1/rooms/${encodeURIComponent(id)}/call-feedback`,
      { method: "POST", body: JSON.stringify(feedback) },
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
