import { API_URL } from "@/lib/config";
import { safeAuthDestination } from "@/lib/authRedirect";

export const SPOTIFY_OAUTH_CHANNEL = "loft_spotify_oauth";
export const SPOTIFY_RETURN_TO_KEY = "loft.spotify.return_to";
export const SPOTIFY_OAUTH_ATTEMPT_KEY = "loft.spotify.oauth_attempt";

export interface SpotifyOAuthMessage {
  type: "LOFT_SPOTIFY_AUTH_COMPLETE";
  status: "connected" | "failed" | "error";
  attemptId: string;
  returnTo?: string;
  error?: string;
}

export interface SpotifyOAuthOptions {
  returnTo?: string;
  onClosed?: () => void;
}

function canonicalSiteOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) {
    return window.location.hostname === "www.mingly.site"
      ? "https://mingly.site"
      : null;
  }
  try {
    const origin = new URL(configured).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Initiates the Spotify OAuth flow using a non-disruptive centered popup window.
 * Keeps the current room session or settings page completely uninterrupted.
 * Falls back gracefully to standard navigation if popups are blocked.
 */
export async function startSpotifyOAuth(
  accessToken: string,
  options?: SpotifyOAuthOptions,
): Promise<{ connected: boolean; error?: string; redirected?: boolean }> {
  if (typeof window === "undefined") {
    return { connected: false, error: "window_unavailable" };
  }

  // A popup and its callback must stay on one exact origin for sessionStorage,
  // postMessage, and BroadcastChannel. Move a legacy www tab to the configured
  // canonical site before creating any OAuth state.
  const canonicalOrigin = canonicalSiteOrigin();
  if (canonicalOrigin && canonicalOrigin !== window.location.origin) {
    window.location.replace(
      `${canonicalOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    return { connected: false, redirected: true };
  }

  const returnTo = safeAuthDestination(
    options?.returnTo || `${window.location.pathname}${window.location.search}`,
    "/settings",
  );
  // A same-origin popup receives a clone of sessionStorage. This lets a
  // blocked-popup fallback resume the original page without trusting a URL
  // parameter supplied by a provider.
  const attemptId = window.crypto.randomUUID();
  window.sessionStorage.setItem(SPOTIFY_RETURN_TO_KEY, returnTo);
  window.sessionStorage.setItem(SPOTIFY_OAUTH_ATTEMPT_KEY, attemptId);

  // Open synchronously from the click handler. Waiting for the API request
  // first causes modern browsers to classify the popup as unsolicited.
  const width = 500;
  const height = 720;
  const left = Math.max(
    0,
    Math.round(window.screenX + (window.outerWidth - width) / 2),
  );
  const top = Math.max(
    0,
    Math.round(window.screenY + (window.outerHeight - height) / 2),
  );
  let popup: Window | null = null;
  try {
    popup = window.open(
      "",
      `${SPOTIFY_OAUTH_CHANNEL}:${attemptId}`,
      `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no,location=yes`,
    );
  } catch {
    popup = null;
  }

  // Spotify always returns to the backend. The browser never receives or
  // forwards an authorization code. Bound the request so a stalled backend
  // cannot leave an inert popup open indefinitely.
  const controller = new AbortController();
  const connectTimeout = window.setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/spotify/connect`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch {
    popup?.close();
    window.sessionStorage.removeItem(SPOTIFY_RETURN_TO_KEY);
    window.sessionStorage.removeItem(SPOTIFY_OAUTH_ATTEMPT_KEY);
    throw new Error("connect_failed");
  } finally {
    window.clearTimeout(connectTimeout);
  }

  const result = (await response.json().catch(() => null)) as {
    url?: string;
  } | null;

  if (!response.ok || !result?.url) {
    popup?.close();
    window.sessionStorage.removeItem(SPOTIFY_RETURN_TO_KEY);
    window.sessionStorage.removeItem(SPOTIFY_OAUTH_ATTEMPT_KEY);
    throw new Error("connect_failed");
  }

  const authUrl = result.url;

  // Fallback to in-place navigation if popup was blocked or unsupported
  if (!popup || popup.closed || typeof popup.closed === "undefined") {
    window.location.assign(authUrl);
    return { connected: false, redirected: true };
  }

  popup.location.replace(authUrl);
  popup.focus();

  // Await popup completion via BroadcastChannel or postMessage
  return new Promise((resolve) => {
    let resolved = false;
    let timer: number | null = null;
    let timeout: number | null = null;
    let channel: BroadcastChannel | null = null;

    const cleanup = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      if (timeout !== null) {
        window.clearTimeout(timeout);
        timeout = null;
      }
      window.removeEventListener("message", handleMessage);
      if (channel) {
        try {
          channel.close();
        } catch {
          // ignore
        }
        channel = null;
      }
    };

    const finish = (res: { connected: boolean; error?: string }) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      window.sessionStorage.removeItem(SPOTIFY_RETURN_TO_KEY);
      window.sessionStorage.removeItem(SPOTIFY_OAUTH_ATTEMPT_KEY);
      resolve(res);
    };

    const handleCompletion = (data: SpotifyOAuthMessage | undefined) => {
      if (
        data?.type === "LOFT_SPOTIFY_AUTH_COMPLETE" &&
        data.attemptId === attemptId
      ) {
        if (data.status === "connected") {
          finish({ connected: true });
        } else {
          finish({ connected: false, error: data.error || "auth_failed" });
        }
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup)
        return;
      handleCompletion(event.data as SpotifyOAuthMessage | undefined);
    };

    window.addEventListener("message", handleMessage);

    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(`${SPOTIFY_OAUTH_CHANNEL}:${attemptId}`);
        channel.onmessage = (event) => {
          handleCompletion(event.data as SpotifyOAuthMessage | undefined);
        };
      } catch {
        channel = null;
      }
    }

    // Monitor popup closure by user
    timer = window.setInterval(() => {
      if (!popup || popup.closed) {
        options?.onClosed?.();
        finish({ connected: false, error: "window_closed" });
      }
    }, 500);

    // 5-minute timeout safety
    timeout = window.setTimeout(
      () => {
        finish({ connected: false, error: "timeout" });
      },
      5 * 60 * 1000,
    );
  });
}
