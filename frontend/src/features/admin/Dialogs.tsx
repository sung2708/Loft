"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Copy, X } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type { AdminRoom, AdminUserDetail } from "@/types/api";
import {
  Badge,
  DecisionFields,
  auditActionLabel,
  noteValid,
  reasonLabel,
  useAdminText,
} from "./shared";
import { useAdminSession } from "./useAdminData";
import { roomStatus } from "./RoomsSection";
import { UserBadges } from "./UsersSection";
import { targetTypeLabel } from "./ReportsSection";
import type { Navigate } from "./params";

export type Inspecting =
  | { kind: "room"; room?: AdminRoom; id: string }
  | { kind: "user"; id: string; name: string };

/** Native modal dialog: focus trap, Escape and backdrop come from the browser. */
export function AdminDialog({
  inspecting,
  busy,
  onClose,
  navigate,
}: {
  inspecting: Inspecting | null;
  busy: boolean;
  onClose: () => void;
  navigate: Navigate;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (inspecting && !dialog?.open) dialog?.showModal();
    if (!inspecting && dialog?.open) dialog.close();
  }, [inspecting]);
  return (
    <dialog
      ref={ref}
      className="admin-dialog"
      aria-labelledby="admin-detail-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      {inspecting?.kind === "room" && (
        <RoomDetail
          key={inspecting.id}
          id={inspecting.id}
          initial={inspecting.room}
          onClose={onClose}
        />
      )}
      {inspecting?.kind === "user" && (
        <UserDetail
          key={inspecting.id}
          id={inspecting.id}
          name={inspecting.name}
          onClose={onClose}
          navigate={navigate}
        />
      )}
    </dialog>
  );
}

function DialogHeading({
  eyebrow,
  title,
  onClose,
  disabled,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  disabled?: boolean;
}) {
  const { t } = useAdminText();
  return (
    <>
      <div className="admin-detail-heading">
        <span className="admin-eyebrow">{eyebrow}</span>
        <button
          type="button"
          className="admin-button admin-icon-button"
          disabled={disabled}
          onClick={onClose}
          aria-label={t("Đóng", "Close")}
        >
          <X size={18} />
        </button>
      </div>
      <h2 id="admin-detail-title">{title}</h2>
    </>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const { t } = useAdminText();
  const { notify } = useAdminSession();
  return (
    <button
      type="button"
      className="admin-button admin-icon-button"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(
          () => notify(t("Đã sao chép", "Copied")),
          () =>
            notify(
              t(
                "Không sao chép được. Hãy chọn và sao chép thủ công.",
                "Could not copy. Select and copy it manually.",
              ),
            ),
        )
      }
    >
      <Copy size={14} />
    </button>
  );
}

function RoomDetail({
  id,
  initial,
  onClose,
}: {
  id: string;
  initial?: AdminRoom;
  onClose: () => void;
}) {
  const { t, date } = useAdminText();
  const { token, refresh, notify } = useAdminSession();
  const [room, setRoom] = useState<AdminRoom | null>(initial ?? null);
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initial) return;
    let active = true;
    api
      .adminRooms(token, id, 1)
      .then((page) => {
        if (!active) return;
        if (page.items[0]) setRoom(page.items[0]);
        else setMissing(true);
      })
      .catch(() => active && setMissing(true));
    return () => {
      active = false;
    };
  }, [id, initial, token]);

  if (!room) {
    return (
      <>
        <DialogHeading
          eyebrow={t("CHI TIẾT PHÒNG", "ROOM DETAILS")}
          title={
            missing
              ? t("Không tìm thấy phòng", "Room not found")
              : t("Đang tải…", "Loading…")
          }
          onClose={onClose}
        />
        <p className="admin-sub mono">{id}</p>
      </>
    );
  }
  const endRoom = async (decisionReason = reason, decisionNote = note) => {
    if (pending || !decisionReason || !noteValid(decisionNote)) return;
    setPending(true);
    setError("");
    try {
      await api.adminEndRoom(
        token,
        room.id,
        decisionReason,
        decisionNote.trim(),
      );
      notify(t("Đã kết thúc phòng", "Room ended"));
      refresh();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "ROOM_END_MEDIA_PENDING"
          ? t(
              "Phòng đã kết thúc. Nhấn lại để thử ngắt cuộc gọi.",
              "Room ended. Retry to disconnect the call.",
            )
          : t(
              "Không kết thúc được phòng. Hãy thử lại.",
              "Could not end the room. Try again.",
            ),
      );
      refresh();
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <DialogHeading
        eyebrow={t("CHI TIẾT PHÒNG", "ROOM DETAILS")}
        title={room.name || t("Phòng đã xóa", "Deleted room")}
        onClose={onClose}
        disabled={pending}
      />
      <dl className="admin-details">
        <dt>ID</dt>
        <dd className="mono">
          {room.id}
          <CopyValue value={room.id} label={t("Sao chép ID", "Copy ID")} />
        </dd>
        {!room.deleted && (
          <>
            <dt>{t("Mã phòng", "Room code")}</dt>
            <dd className="mono">
              {room.code}
              <CopyValue
                value={room.code}
                label={t("Sao chép mã", "Copy code")}
              />
            </dd>
            <dt>{t("Chủ phòng", "Owner")}</dt>
            <dd>
              {room.owner_name}
              <span className="admin-sub mono">{room.owner_id}</span>
            </dd>
            <dt>{t("Quyền vào", "Access")}</dt>
            <dd>
              {room.allow_guests
                ? t("Cho phép khách", "Guests allowed")
                : t("Chỉ thành viên", "Members only")}{" "}
              ·{" "}
              {room.password_required
                ? t("Có mật khẩu", "Password protected")
                : t("Không mật khẩu", "No password")}
            </dd>
          </>
        )}
        <dt>{t("Trạng thái", "Status")}</dt>
        <dd>
          <Badge
            tone={
              room.moderation ? "danger" : room.ended ? "neutral" : "active"
            }
          >
            {roomStatus(t, room)}
          </Badge>
        </dd>
        <dt>
          {room.deleted
            ? t("Ngày xử lý", "Recorded")
            : t("Ngày tạo", "Created")}
        </dt>
        <dd>{date(room.created_at)}</dd>
      </dl>
      {room.moderation && (
        <section
          className="admin-danger-zone"
          aria-label={t("Quyết định xử lý", "Moderation decision")}
        >
          <h3>{t("Đã xử lý vi phạm", "Moderation recorded")}</h3>
          <dl className="admin-details">
            <dt>{t("Lý do", "Reason")}</dt>
            <dd>{reasonLabel(t, room.moderation.reason)}</dd>
            <dt>{t("Ghi chú", "Note")}</dt>
            <dd className="whitespace-pre-wrap">{room.moderation.note}</dd>
            <dt>{t("Người xử lý", "Administrator")}</dt>
            <dd className="mono">{room.moderation.actor_id}</dd>
            <dt>{t("Thời điểm", "Recorded")}</dt>
            <dd>{date(room.moderation.created_at)}</dd>
          </dl>
          <button
            type="button"
            className="admin-button"
            disabled={pending || room.deleted}
            title={
              room.deleted
                ? t(
                    "Phòng đã bị xóa; không còn cuộc gọi để ngắt.",
                    "The room was deleted; there is no call left to end.",
                  )
                : undefined
            }
            onClick={() =>
              void endRoom(room.moderation!.reason, room.moderation!.note)
            }
          >
            {t("Thử ngắt lại", "Retry cleanup")}
          </button>
        </section>
      )}
      {!room.deleted && !room.moderation && (
        <section className="admin-danger-zone">
          {confirming ? (
            <>
              <h3>{t("Kết thúc phòng này?", "End this room?")}</h3>
              <p>
                {t(
                  "Mọi người sẽ bị ngắt kết nối và không thể tham gia lại. Lịch sử phòng được giữ lại. Không thể hoàn tác.",
                  "Everyone will be disconnected and unable to rejoin. Room history is retained. This cannot be undone.",
                )}
              </p>
              <DecisionFields
                reason={reason}
                note={note}
                onReason={setReason}
                onNote={setNote}
                disabled={pending}
                idPrefix="end-room"
              />
              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-button"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                >
                  {t("Hủy", "Cancel")}
                </button>
                <button
                  type="button"
                  className="admin-button admin-danger"
                  disabled={pending || !reason || !noteValid(note)}
                  onClick={() => void endRoom()}
                >
                  {pending
                    ? t("Đang kết thúc…", "Ending…")
                    : t("Kết thúc phòng", "End room")}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="admin-button admin-danger"
              onClick={() => setConfirming(true)}
            >
              {t("Kết thúc phòng", "End room")}
            </button>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
    </>
  );
}

function UserDetail({
  id,
  name,
  onClose,
  navigate,
}: {
  id: string;
  name: string;
  onClose: () => void;
  navigate: Navigate;
}) {
  const { t, locale, date, dateTime } = useAdminText();
  const { token, refresh, notify } = useAdminSession();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .adminUser(token, id)
      .then((value) => active && setDetail(value))
      .catch(() => active && setMissing(true));
    return () => {
      active = false;
    };
  }, [id, token, reload]);

  const after = (message: string) => {
    notify(message);
    refresh();
    setConfirming(false);
    setReason("");
    setNote("");
    setReload((value) => value + 1);
  };
  const suspend = async () => {
    if (pending || !reason || !noteValid(note)) return;
    setPending(true);
    setError("");
    try {
      await api.adminSuspendUser(token, id, reason, note.trim(), days);
      after(t("Đã tạm khóa tài khoản", "Account suspended"));
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "FORBIDDEN"
          ? t(
              "Không thể tạm khóa tài khoản quản trị.",
              "Admin accounts cannot be suspended.",
            )
          : t(
              "Không tạm khóa được. Hãy thử lại.",
              "Could not suspend. Try again.",
            ),
      );
    } finally {
      setPending(false);
    }
  };
  const lift = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api.adminLiftSuspension(token, id);
      after(t("Đã gỡ tạm khóa", "Suspension lifted"));
    } catch {
      setError(t("Không gỡ được. Hãy thử lại.", "Could not lift. Try again."));
    } finally {
      setPending(false);
    }
  };
  const title = detail?.display_name ?? name;
  return (
    <>
      <DialogHeading
        eyebrow={t("CHI TIẾT TÀI KHOẢN", "ACCOUNT DETAILS")}
        title={
          missing ? t("Không tìm thấy tài khoản", "Account not found") : title
        }
        onClose={onClose}
        disabled={pending}
      />
      {!detail ? (
        <p className="admin-sub">
          {missing ? (
            <span className="mono">{id}</span>
          ) : (
            t("Đang tải…", "Loading…")
          )}
        </p>
      ) : (
        <>
          <div className="admin-badges admin-badges-spaced">
            <UserBadges user={detail} />
          </div>
          <dl className="admin-metrics admin-metrics-compact">
            {[
              [t("Phòng đã tạo", "Rooms created"), detail.room_count],
              [t("Thành viên phòng", "Member of"), detail.member_rooms],
              [t("Tin nhắn", "Messages"), detail.messages_sent],
              [t("Bị báo cáo", "Reports against"), detail.total_reports],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd className="tabular-nums">
                  {Number(value).toLocaleString(locale)}
                </dd>
              </div>
            ))}
          </dl>
          <dl className="admin-details">
            <dt>ID</dt>
            <dd className="mono">
              {detail.id}
              <CopyValue
                value={detail.id}
                label={t("Sao chép ID", "Copy ID")}
              />
            </dd>
            <dt>{t("Tham gia", "Joined")}</dt>
            <dd>{date(detail.created_at)}</dd>
            <dt>{t("Hoạt động gần nhất", "Last active")}</dt>
            <dd>{dateTime(detail.last_seen_at)}</dd>
            {detail.suspension && (
              <>
                <dt>{t("Tạm khóa đến", "Suspended until")}</dt>
                <dd>
                  {detail.suspension.expires_at
                    ? dateTime(detail.suspension.expires_at)
                    : t("Vĩnh viễn", "Permanent")}
                </dd>
                <dt>{t("Lý do", "Reason")}</dt>
                <dd>{reasonLabel(t, detail.suspension.reason)}</dd>
                <dt>{t("Ghi chú", "Note")}</dt>
                <dd className="whitespace-pre-wrap">
                  {detail.suspension.note}
                </dd>
              </>
            )}
          </dl>
          <div className="admin-actions admin-actions-start">
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                onClose();
                navigate("rooms", {
                  owner: detail.id,
                  ownerName: detail.display_name,
                });
              }}
            >
              {t("Xem phòng", "View rooms")}
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                onClose();
                navigate("audit", { target: detail.id });
              }}
            >
              {t("Toàn bộ nhật ký", "Full history")}
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>
          {detail.recent_reports.length > 0 && (
            <section
              className="admin-subsection"
              aria-labelledby="user-reports-title"
            >
              <h3 id="user-reports-title">
                {t("Báo cáo gần đây", "Recent reports")}
              </h3>
              <ul className="admin-timeline">
                {detail.recent_reports.map((report) => (
                  <li key={report.id}>
                    <span className="admin-timeline-when">
                      {dateTime(report.created_at)}
                    </span>
                    <span>
                      <strong>{reasonLabel(t, report.reason)}</strong> ·{" "}
                      {targetTypeLabel(t, report.target_type)} ·{" "}
                      {report.room_name}
                      {report.details && (
                        <span className="admin-note">{report.details}</span>
                      )}
                      <span className="admin-sub">
                        {report.status === "open"
                          ? t("Chờ xử lý", "Open")
                          : report.status === "actioned"
                            ? t("Đã xử lý", "Actioned")
                            : t("Đã bỏ qua", "Dismissed")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section
            className="admin-subsection"
            aria-labelledby="user-history-title"
          >
            <h3 id="user-history-title">
              {t("Lịch sử xử lý", "Moderation history")}
            </h3>
            {detail.history.length ? (
              <ul className="admin-timeline">
                {detail.history.map((entry) => (
                  <li key={entry.id}>
                    <span className="admin-timeline-when">
                      {dateTime(entry.created_at)}
                    </span>
                    <span>
                      <strong>{auditActionLabel(t, entry.action)}</strong>
                      {entry.reason && ` · ${reasonLabel(t, entry.reason)}`}
                      {entry.note && (
                        <span className="admin-note">{entry.note}</span>
                      )}
                      <span className="admin-sub">
                        {entry.actor_name || entry.actor_id}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-sub">
                {t(
                  "Chưa có thao tác nào với tài khoản này.",
                  "No actions on this account yet.",
                )}
              </p>
            )}
          </section>
          <section className="admin-danger-zone">
            {detail.suspension ? (
              <button
                type="button"
                className="admin-button"
                disabled={pending}
                onClick={() => void lift()}
              >
                {pending
                  ? t("Đang gỡ…", "Lifting…")
                  : t("Gỡ tạm khóa", "Lift suspension")}
              </button>
            ) : confirming ? (
              <>
                <h3>{t("Tạm khóa tài khoản này?", "Suspend this account?")}</h3>
                <p>
                  {t(
                    "Người dùng bị ngắt khỏi mọi phòng và không thể dùng dịch vụ cho đến khi hết hạn hoặc được gỡ. Họ thấy nhóm lý do và ngày hết hạn, không thấy ghi chú.",
                    "The user is disconnected from every room and blocked until the suspension ends or is lifted. They see the reason category and end date, not the note.",
                  )}
                </p>
                <label className="admin-field">
                  {t("Thời hạn", "Duration")}
                  <select
                    className="admin-select"
                    value={days}
                    disabled={pending}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    <option value={1}>{t("1 ngày", "1 day")}</option>
                    <option value={7}>{t("7 ngày", "7 days")}</option>
                    <option value={30}>{t("30 ngày", "30 days")}</option>
                    <option value={90}>{t("90 ngày", "90 days")}</option>
                    <option value={0}>{t("Vĩnh viễn", "Permanent")}</option>
                  </select>
                </label>
                <DecisionFields
                  reason={reason}
                  note={note}
                  onReason={setReason}
                  onNote={setNote}
                  disabled={pending}
                  idPrefix="suspend"
                />
                <div className="admin-actions">
                  <button
                    type="button"
                    className="admin-button"
                    disabled={pending}
                    onClick={() => setConfirming(false)}
                  >
                    {t("Hủy", "Cancel")}
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-danger"
                    disabled={pending || !reason || !noteValid(note)}
                    onClick={() => void suspend()}
                  >
                    {pending
                      ? t("Đang khóa…", "Suspending…")
                      : t("Tạm khóa", "Suspend")}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="admin-button admin-danger"
                onClick={() => setConfirming(true)}
              >
                {t("Tạm khóa", "Suspend")}
              </button>
            )}
            {error && (
              <p role="alert" className="admin-error">
                {error}
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
