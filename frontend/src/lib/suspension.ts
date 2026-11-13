import type { OwnSuspension } from "@/types/api";

const REASONS: Record<OwnSuspension["reason"], [string, string]> = {
  illegal: ["nghi vấn vi phạm pháp luật", "suspected illegal activity"],
  policy: ["vi phạm điều khoản", "a terms violation"],
  safety: ["đe dọa hoặc quấy rối", "threats or harassment"],
  spam: ["spam hoặc lừa đảo", "spam or scams"],
  other: ["vi phạm quy định", "a rules violation"],
};

/** Tells a member why and until when their account is suspended. */
export function suspensionMessage(
  suspension: OwnSuspension | undefined,
  locale: string,
) {
  const vi = locale === "vi";
  if (!suspension)
    return vi
      ? "Tài khoản này đang bị tạm khóa."
      : "This account is suspended.";
  const reason =
    REASONS[suspension.reason]?.[vi ? 0 : 1] ?? REASONS.other[vi ? 0 : 1];
  if (!suspension.expires_at) {
    return vi
      ? `Tài khoản này bị khóa vì ${reason}.`
      : `This account is suspended for ${reason}.`;
  }
  const until = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(suspension.expires_at));
  return vi
    ? `Tài khoản này bị tạm khóa vì ${reason} đến ${until}.`
    : `This account is suspended for ${reason} until ${until}.`;
}
