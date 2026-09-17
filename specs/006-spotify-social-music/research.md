# Research: Spotify Social Music & Personal Playback

## Decision: Account-level user authorization

Use Spotify Authorization Code with PKCE for browser-facing user authorization unless planning confirms a secure server-side flow is preferable for the deployed topology. Keep the client secret out of browser code, validate state and exact redirect URIs, request only selected scopes, refresh short-lived access tokens, and treat expired/revoked refresh credentials as requiring reauthorization.

Rationale: Spotify documents PKCE for apps where a client secret cannot be safely stored, and documents access tokens as short-lived with refresh-token lifecycle requirements. This matches the account-level, cross-room connection model.

Source: https://developer.spotify.com/documentation/web-api/concepts/authorization, https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow, https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens

Alternatives considered: Implicit grant (not selected); room-scoped authorization (violates product privacy and reuse); putting tokens in room snapshots/events (forbidden by constitution).

## Decision: Personal playback with provider authority

Treat “Play for me” and personal controls as user-owned Spotify actions. Evaluate Web Playback SDK only for eligible accounts and supported environments; otherwise use Spotify Connect/provider controls or Open in Spotify. Never capture or relay provider audio and never synchronize playback across participants.

Rationale: Spotify describes the Web Playback SDK as a client-side Connect device and exposes explicit Premium, authentication, account, playback, and autoplay failure states.

Source: https://developer.spotify.com/documentation/web-playback-sdk, https://developer.spotify.com/documentation/web-playback-sdk/reference

Alternatives considered: Mingly-hosted audio relay, browser capture, and a shared Spotify queue (all prohibited); mandatory embedded playback (fails unsupported environments).

## Decision: Search and social metadata are quota-aware

Implement tracks-first search with debounce, bounded result sizes, caching only where policy permits, provider error states, and Retry-After-aware backoff. Do not poll listening state aggressively; prefer provider events where supported and stop updates when room visibility is disabled.

Rationale: Spotify rate limits operate over rolling windows and development mode has separate quota restrictions. Current official guidance requires handling 429 responses and pacing requests.

Source: https://developer.spotify.com/documentation/web-api/concepts/rate-limits, https://developer.spotify.com/documentation/web-api/concepts/quota-modes

Alternatives considered: fetch on every keystroke/render and fixed retry loops (unbounded/quota unsafe).

## Decision: Experimental rollout is allowlisted and policy-gated

Plan for Development Mode allowlisting and Premium requirements as an explicit product state. Do not assume arbitrary public users can authorize the integration. Verify current Developer Policy, attribution, branding, content caching, AI/ML, and commercial-use restrictions during implementation readiness review.

Rationale: Spotify’s current quota-mode guidance limits Development Mode users and requires the app owner to have Premium; Spotify also states Web Playback SDK commercial use requires prior written approval.

Source: https://developer.spotify.com/documentation/web-api/concepts/quota-modes, https://developer.spotify.com/documentation/web-playback-sdk

Alternatives considered: shipping as unrestricted public functionality before approval (unsafe and misleading).

## Resolved unknowns

- OAuth is account-level, not room-level.
- Room visibility is explicit, private by default, and isolated per room/session.
- Room Picks contain safe metadata only and never become the YouTube queue.
- Spotify failures degrade locally and cannot block Mingly participation.
- Final scope list, retention period, provider endpoint availability, and current policy interpretation remain implementation-gate checks, not hidden assumptions.
