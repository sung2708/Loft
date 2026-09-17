import { API_URL } from "@/lib/config";

export const SPOTIFY_OAUTH_CHANNEL = "loft_spotify_oauth";

export interface SpotifyOAuthMessage {
  type: "LOFT_SPOTIFY_AUTH_COMPLETE";
  status: "connected" | "failed" | "error";
  returnTo?: string;
  error?: string;
}

export interface SpotifyOAuthOptions {
  returnTo?: string;
  onClosed?: () => void;
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

  const returnTo =
    options?.returnTo || `${window.location.pathname}${window.location.search}`;
  const redirectUri = `${window.location.origin}/auth/spotify/callback`;

  // Request authorization URL from backend preserving exact client redirect_uri
  const response = await fetch(
    `${API_URL}/api/v1/spotify/connect?redirect_uri=${encodeURIComponent(redirectUri)}&return_to=${encodeURIComponent(returnTo)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  const result = (await response.json().catch(() => null)) as {
    url?: string;
  } | null;

  if (!response.ok || !result?.url) {
    throw new Error("connect_failed");
  }

  const authUrl = result.url;

  // Calculate centered popup dimensions
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
      authUrl,
      "loft_spotify_oauth",
      `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no,location=yes`,
    );
  } catch {
    popup = null;
  }

  // Fallback to in-place navigation if popup was blocked or unsupported
  if (!popup || popup.closed || typeof popup.closed === "undefined") {
    window.location.assign(authUrl);
    return { connected: false, redirected: true };
  }

  popup.focus();

  // Await popup completion via BroadcastChannel or postMessage
  return new Promise((resolve) => {
    let resolved = false;
    let timer: number | null = null;
    let channel: BroadcastChannel | null = null;

    const cleanup = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
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
      resolve(res);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin && event.origin !== window.location.origin) return;
      const data = event.data as SpotifyOAuthMessage | undefined;
      if (data?.type === "LOFT_SPOTIFY_AUTH_COMPLETE") {
        if (data.status === "connected") {
          finish({ connected: true });
        } else {
          finish({ connected: false, error: data.error || "auth_failed" });
        }
      }
    };

    window.addEventListener("message", handleMessage);

    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(SPOTIFY_OAUTH_CHANNEL);
        channel.onmessage = handleMessage;
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
    window.setTimeout(() => {
      finish({ connected: false, error: "timeout" });
    }, 5 * 60 * 1000);
  });
}
