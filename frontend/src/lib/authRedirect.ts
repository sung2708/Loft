const callbackPrefix = "/auth/";

// Returns a same-origin path only. OAuth return destinations are untrusted
// because they can originate in a query string or browser storage.
export function safeAuthDestination(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.startsWith("/auth/") ||
    value.includes(":")
  ) {
    return fallback;
  }

  let decoded = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return fallback;
    }
  }
  if (
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    decoded.includes("\u0000") ||
    decoded.includes("\r") ||
    decoded.includes("\n") ||
    decoded.startsWith(callbackPrefix)
  ) {
    return fallback;
  }

  try {
    const base = new URL("https://mingly.invalid");
    const target = new URL(value, base);
    if (
      target.origin !== base.origin ||
      target.pathname.startsWith(callbackPrefix)
    ) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
