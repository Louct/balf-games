# Completed fixes

## iPad/touch UI and navigation

- Kept the original dark/grid styling, themes, page layout and card design; no framework migration or visual overhaul.
- Fixed the sidebar staying open after navigation on tablet-width screens. Added an explicit close button, a touch-accessible quick exit, focus handling and accessible state labels.
- Added allowlisted shell routes so direct game/app/search links retain their destination instead of returning to the home page. Rapid navigation discards stale frame loads.
- Tab name/icon changes now update the outer browser tab immediately, not just the inner settings frame.
- Added 44px touch targets to important controls and 16px touch-device form fields to avoid focus zoom on supported iPad Safari versions.
- Added viewport-height handling for browser chrome, the on-screen keyboard, safe areas and scrollable dialogs. Improved keyboard focus outlines and reduced-motion/performance behavior.
- Added an in-page expanded-player fallback when native fullscreen is unavailable or rejected, with a visible exit control. Escape exits expanded view before closing an underlying movie dialog.
- Repositioned Chat/Report/Keys controls into the small-screen game toolbar instead of leaving them on top of the game. Prevented the outer menu overlapping the decorative AI rail logo.
- Added clean optional-artwork fallbacks; all original image paths remain intact. Existing artwork is used when restored.

## Game and app libraries

- Replaced the render-then-hide race with data-first filtering and sorting. Search, tags, source filters, favorites and popular results now use consistent catalog state.
- Limited initial game cards to 120 with a “Show more games” control instead of constructing thousands of hidden cards on an iPad.
- Most Played sorts the whole filtered catalog, not whichever cards finished rendering first. Random chooses from all matching games.
- Fixed tag initialization, source-scoped tags, empty states, retry behavior and the all-sources option.
- Made numeric/string favorite IDs consistent, tolerated malformed saved favorites and corrected legacy favorite removal in the player.
- Fixed catalog ID handling, including ID 0 and repeated ID collisions. Failed/partial catalog loads are not cached as complete results.
- Added bounded catalog fetches and IndexedDB cache open/read fallbacks for unavailable or stalled storage.
- Added app search and empty states. Fixed external app images by using normal image loading instead of attempting to display unreadable `no-cors` response blobs.
- Converted cards to real links and retained existing catalog/asset references.

## Game player and keyboard

- Load only the relevant games or apps catalog; initialize the player once.
- Added clear missing-item, missing-local-bundle, proxy-startup and retry/back states. Fixed deep-URL 404-page asset references.
- Removed the undefined favorite handler and made favorite state accessible.
- New-tab and download actions use independent game routes rather than reusing an embedded frame/controller. Downloaded HTML is correctly described as an **online launcher**, not an offline copy of a game.
- Game save/load message requests now store and retrieve JSON-compatible content per game, sender origin and slot instead of reporting success while discarding saves. Invalid/unsupported data and storage failures return errors. Messages must originate from the active game frame.
- Added pointer cancellation/lost-capture handling and modifier release to reduce stuck on-screen keys. Added viewport scaling/clamping and larger keyboard close controls.

## Backups, settings and cache recovery

- Separated disposable proxy/catalog caches from other IndexedDB databases. Cache reset no longer treats the tracked list of every opened database as a deletion list.
- Reset reports blocked/incomplete work honestly and affects only the known site worker/cache names. Settings and recovery pages use the same reset helper.
- Added version-2 backups with database versions, object-store key paths, auto-increment settings, indexes and keys, not just raw record values.
- Preserve supported structured values such as Blob/File, Date, Map, Set, typed arrays, ArrayBuffer, BigInt and special numeric values.
- Validate/decode imports before writing. Recreate compatible schemas, wait for transaction completion, and report schema conflicts or partial multi-database restores instead of silently skipping records.
- Keep legacy backup support where schema information is sufficient. Exclude chat sign-in credentials and disposable cache databases. Roll back local-storage settings if their import fails.
- Provide a persistent download link suitable for iPad's download/share flow; do not revoke it immediately. Circular structures and files above the documented safety limit fail explicitly.
- Fixed theme/transport selection interference, background-overlay attachment and panic-key detection/URL validation. Performance-mode changes reach the outer shell.
- The update notice dismisses even when animations are disabled.

## Movies and proxy reliability

- Replaced overlapping movie requests with abort/version handling for search, pagination, title details, seasons and episodes. Late responses cannot overwrite a newer selection or restart a closed player.
- Corrected movie/TV trending endpoints, pagination retries, no-poster handling and season/episode error states.
- Added semantic movie controls, modal focus handling, natural player sizing and scrollable small-screen dialogs rather than a forced player height that clips on tablets.
- Added honest provider loading/error guidance. An iframe load event is no longer presented as proof that a movie is actually playing.
- Removed the overly broad client-side ad-removal observer that could remove legitimate playback/decoder scripts. Movie provider frames remain unsandboxed for compatibility, so providers may open popups or attempt top-level navigation; this is **not** a security boundary.
- Fixed client proxy relative-URL resolution and URL/Request handling. Removed the nonfunctional dynamic-import override and made verbose URL logging opt-in.
- Server relay supports raw form/multipart POST bodies, HEAD and binary/range responses; preserves POST on 307/308-style redirects and handles method changes on applicable redirects.
- Revalidates public destinations on redirects, pins validated DNS answers, blocks private/reserved destinations and restores TLS certificate verification.
- Strips upstream cookie/storage/service-worker-setting headers, caps rewritten text/decompression, handles cancellation and avoids unhandled response errors when abandoning redirects.
- Improved HLS rewriting for initialization segments, audio/subtitle tracks, keys and partial segments. Fixed upstream document/module path resolution.

## Chat and account reliability

- Stale conversation/inbox responses cannot leak into a newly selected conversation. Polling guards reduce duplicate requests and stale unread state.
- Added per-conversation drafts, duplicate-send prevention, bounded sends, draft restoration on failure and session checks for late send/search results.
- Read markers advance only through displayed messages. Server message timestamps are monotonic within a conversation, preventing same-millisecond cursor loss.
- Failed account/message deletion keeps the session and displays the server error rather than showing success. Expired sessions cannot authorize account deletion.
- Improved mobile inbox/back navigation, IME Enter handling, password toggles and authentication-submit timeouts. Mini-chat uses the same conversation safety checks.
- Removed misleading double-check read receipts; the UI indicates sent messages without claiming recipient reads.
- Hardened registration/device races, reserved usernames, credential-field validation, session cleanup and account-deletion/DM races.

## AI, reports and server safety

- Failed AI requests restore drafts/attachments and remove duplicate failed/partial bubbles. Clearing a conversation is disabled while sending.
- Preserve the last streaming chunk even when it lacks a trailing newline; handle stream/JSON error responses and normal non-streaming responses.
- Improve IME input, attachment failure handling and scroll behavior; surface model-loading errors and use server-reported default model IDs.
- Removed the static “AI services online” claim from the rail; availability is determined by actual requests.
- Added IP-based rate ceilings in addition to device checks, input size/type validation and optional AI login enforcement. Generated-image downloads use validated public destinations and bounded reads.
- AI streaming respects backpressure and client cancellation.
- Unconfigured report webhooks return an explicit unavailable error instead of fake success; webhook requests time out and disable mentions.
- Handle malformed WebSocket/relay frames and invalid upstream URLs without crashing the process; preserve text/binary distinctions and cap relay buffers.
- Validate startup port configuration. Duplicate-process termination is now opt-in. API responses use `no-store`.
- Added repeatable source checks and server/helper/relay regression tests. Updated script/style version references so old browser caches do not hide the fixes.

## Intentionally preserved

Original game/app catalog JSON, omitted asset paths, theme palette and overall design, pinned proxy-stack versions, Caddyfile, deployment script and licensing. Fastify and vulnerable transitive `fast-uri` releases were updated. Nothing was deployed to your live host.

See `QA.md` for the difference between verified behavior, fixture-based tests and areas that still need testing on your actual iPad/host.
