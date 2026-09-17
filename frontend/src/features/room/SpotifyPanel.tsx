"use client";

import { useAuth } from "@/lib/auth/useAuth";
import { API_URL } from "@/lib/config";
import { useUIText } from "@/lib/i18n/uiText";
import { startSpotifyOAuth } from "@/lib/spotify/oauth";
import { useSpotifyStore } from "@/stores/useSpotifyStore";
import { useRoomStore } from "@/stores/useRoomStore";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export function SpotifyPanel() {
  const tr = useUIText();
  const { isAuthenticated, session } = useAuth();
  const room = useRoomStore((state) => state.room);
  const connection = useSpotifyStore((state) => state.connection);
  const fetchStatus = useSpotifyStore((state) => state.fetchStatus);
  const disconnectSpotify = useSpotifyStore((state) => state.disconnect);
  const visibility = useSpotifyStore(
    (state) => state.roomVisibility[room?.id ?? ""]?.sharing ?? false,
  );
  const setRoomVisibility = useSpotifyStore((state) => state.setRoomVisibility);

  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectNotice, setConnectNotice] = useState<string | null>(null);
  const [results, setResults] = useState<
    Array<{ uri: string; name: string; artists: string[]; image_url?: string }>
  >([]);

  // Fetch authoritative Spotify connection status on mount / auth change
  useEffect(() => {
    if (session?.access_token) {
      void fetchStatus(session.access_token);
    }
  }, [fetchStatus, session?.access_token]);

  // Debounced search with AbortController
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || connection.status !== "CONNECTED" || !session?.access_token) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);

      fetch(`${API_URL}/api/v1/spotify/search?q=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            if (response.status === 401) {
              void fetchStatus(session.access_token);
              throw new Error("Spotify session expired. Please reconnect.");
            }
            if (response.status === 429) {
              throw new Error("Spotify rate limited. Try again shortly.");
            }
            throw new Error("Search failed.");
          }
          return response.json();
        })
        .then((payload) => {
          if (!controller.signal.aborted) {
            setResults(payload?.tracks ?? []);
            setSearched(true);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setResults([]);
            setSearched(true);
            setSearchError(err instanceof Error ? err.message : "Search error.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearching(false);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [connection.status, fetchStatus, query, session?.access_token]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (!val.trim()) {
      setResults([]);
      setSearched(false);
      setSearchError(null);
    }
  };

  const connect = async () => {
    if (!session?.access_token || isConnecting) return;
    setIsConnecting(true);
    setConnectNotice(null);
    try {
      const res = await startSpotifyOAuth(session.access_token, {
        returnTo: `${window.location.pathname}${window.location.search}`,
        onClosed: () => {
          setIsConnecting(false);
        },
      });
      if (res.connected) {
        await fetchStatus(session.access_token);
      } else if (res.error && res.error !== "window_closed") {
        setConnectNotice("Could not connect Spotify. Try again.");
      }
    } catch {
      setConnectNotice("Could not connect Spotify. Try again.");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!session?.access_token) return;
    await disconnectSpotify(session.access_token);
    setResults([]);
    setQuery("");
    setSearched(false);
    setSearchError(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-medium">Spotify</h2>
        <p className="mt-1 text-[11px] text-[var(--text-loft-secondary)]">
          {tr("Personal playback and room music picks")}
        </p>
      </div>

      {!isAuthenticated ? (
        <p className="text-[11px] text-[var(--text-loft-secondary)]">
          {tr("Sign in to connect Spotify")}
        </p>
      ) : connection.status !== "CONNECTED" ? (
        <div className="flex flex-col gap-2">
          {connection.status === "REVOKED" && (
            <p className="text-[11px] text-[var(--status-danger)]">
              Spotify access was revoked. Please reconnect.
            </p>
          )}
          {connectNotice && (
            <p className="text-[11px] text-[var(--status-danger)]">
              {connectNotice}
            </p>
          )}
          <button
            type="button"
            disabled={isConnecting}
            onClick={() => void connect()}
            className="flex items-center justify-center gap-2 rounded-[6px] bg-[#101113] px-3 py-2 text-[11px] font-medium text-white hover:bg-[#2b2d31] disabled:opacity-50"
          >
            {isConnecting && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            {isConnecting ? "Connecting…" : "Connect Spotify"}
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-[6px] border border-[var(--border-loft)] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium">Personal playback</p>
              <button
                type="button"
                onClick={() => void disconnect()}
                className="text-[10px] text-[var(--text-loft-secondary)] hover:text-[var(--status-danger)]"
              >
                Disconnect
              </button>
            </div>

            <div className="mt-2 flex gap-2">
              <input
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search Spotify"
                className="min-w-0 flex-1 rounded-[5px] border border-[var(--border-loft)] bg-transparent px-2 py-2 text-[11px]"
              />
              <button
                type="button"
                onClick={() => setSearched(true)}
                className="rounded-[5px] border border-[var(--border-loft)] px-3 text-[11px]"
              >
                Search
              </button>
            </div>

            {searching && (
              <p className="mt-2 text-[11px] text-[var(--text-loft-secondary)]">
                Searching…
              </p>
            )}

            {searchError && (
              <p className="mt-2 text-[11px] text-[var(--status-danger)]">
                {searchError}
              </p>
            )}

            {!searching && searched && query.trim() && results.length === 0 && !searchError && (
              <p className="mt-2 text-[11px] text-[var(--text-loft-secondary)]">
                No tracks found.
              </p>
            )}

            {results.length > 0 && (
              <div className="mt-2 space-y-1">
                {results.map((track) => (
                  <button
                    key={track.uri}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[5px] p-2 text-left hover:bg-[var(--bg-loft-surface)]"
                  >
                    {track.image_url && (
                      <img
                        src={track.image_url}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded object-cover"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px]">
                      {track.name}
                      <span className="block truncate text-[10px] text-[var(--text-loft-secondary)]">
                        {track.artists.join(", ")}
                      </span>
                    </span>
                    <span className="text-[10px] text-[var(--text-loft-secondary)]">
                      Play
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[6px] border border-[var(--border-loft)] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium">Room Picks</p>
              <span className="text-[10px] text-[var(--text-loft-secondary)]">0</span>
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-loft-secondary)]">
              Suggest tracks for this room without sharing audio.
            </p>
            <button
              type="button"
              disabled
              className="mt-3 rounded-[5px] border border-[var(--border-loft)] px-3 py-2 text-[11px] opacity-50"
            >
              Add a pick
            </button>
          </div>

          <label className="flex items-center justify-between rounded-[6px] border border-[var(--border-loft)] p-3 text-[11px]">
            <span>
              <span className="block font-medium">Share listening in this room</span>
              <span className="text-[10px] text-[var(--text-loft-secondary)]">
                Private by default
              </span>
            </span>
            <input
              type="checkbox"
              checked={visibility}
              onChange={(event) =>
                room &&
                setRoomVisibility({ roomId: room.id, sharing: event.target.checked })
              }
              className="h-4 w-4 shrink-0 accent-[#101113] align-middle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]"
            />
          </label>
        </>
      )}
    </div>
  );
}
