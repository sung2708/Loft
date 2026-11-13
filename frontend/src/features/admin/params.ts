export type Section = "overview" | "reports" | "rooms" | "users" | "audit";

export const SECTIONS: Section[] = [
  "overview",
  "reports",
  "rooms",
  "users",
  "audit",
];

/** Filters that live in the URL so a view survives reloads and can be shared. */
export type AdminParams = Partial<
  Record<
    | "q"
    | "status"
    | "owner"
    | "ownerName"
    | "page"
    | "action"
    | "actor"
    | "target"
    | "from"
    | "to",
    string
  >
>;

export type Navigate = (section: Section, params?: AdminParams) => void;

export type SetParams = (
  patch: AdminParams,
  options?: { keepPage?: boolean },
) => void;

export function parseSection(value: string | null): Section {
  return SECTIONS.includes(value as Section) ? (value as Section) : "overview";
}

export function parsePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 0;
}
