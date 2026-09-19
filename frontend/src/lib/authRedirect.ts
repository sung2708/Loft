export function safeAuthDestination(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.startsWith("/auth/") ||
    value.includes(":")
  ) {
    return fallback;
  }
  return value;
}

