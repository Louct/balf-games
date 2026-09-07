# Verification and remaining limitations

## Automated checks

Run from the project root:

```sh
pnpm lint
pnpm check
pnpm test
```

- **ESLint:** passes for the configured server, client, relay, helper and test files.
- **Source check:** parses first-party browser scripts and inline HTML scripts, checks the server/helper scripts, and parses the supplied catalog JSON.
- **Node regression suite:** **26 passing tests including subtests**. Coverage includes malformed account/AI/report input, device-registration races, concurrent DM cursors, expired deletion sessions, deletion cleanup, AI streaming/defaults/login enforcement, malformed WebSockets, route validation, favorites/storage fallback, rate limiting, private-address/DNS checks, HLS/import rewriting and compression limits.
- **Real local HTTP relay fixtures:** form POST body preservation, binary 206/range responses, HEAD, compressed HTML rewriting, cookie/storage-header stripping, redirect revalidation, 303/307 semantics and bad compression handling. These are local fixtures, not real movie providers.

Tests use temporary account data and a local fake AI provider. They do not require live credentials, contact real users or purchase AI generation.

## Browser checks

The actual site source and supplied catalogs were exercised in Chromium through a local request bridge. Checked at **820 × 1180** (iPad-sized portrait), **1180 × 820** (landscape), **390 × 844** (phone) and **1440 × 900** (desktop), using touch emulation. Screenshots were inspected individually for overlap, clipping, spacing and consistency with the existing design.

The main run completed **23 scenario checks**, including responsive passes. A further targeted run completed **6 additional passing checks**:

- Browser Back/Forward keeping the outer route and content frame synchronized.
- The on-screen keyboard opening above the tablet toolbar.
- Rejection of nested binary data in the JSON-only game save message API.
- A clear missing-local-game error without uncaught fallback-page script errors.
- Phone chat inbox/conversation/back navigation.
- Phone movie-dialog sizing and Escape exiting expanded view before closing the dialog.

Other exercised behavior includes sidebar closure, rapid navigation, bounded catalog rendering, search/tag/Most Played consistency, tab cloaking, recreated IndexedDB schemas and structured backup values, preserving game-save databases during cache reset, movie retry/search/season races, closing pending playback, stale chat responses, failed deletion, AI draft recovery/final SSE chunks, favorites, cancelled touch keys, per-slot game saves and direct game links.

**Fixture boundary:** TMDB results, movie-player documents, chat/AI replies and one local game document were controlled test responses. The omitted game/artwork folders were not fabricated. Browser service workers were blocked in this fixture environment, so this is not an end-to-end Scramjet/Wisp transport test. The server regression suite separately tests real API and local relay behavior.

## Not verified / remaining caveats

1. **Actual iPad Safari/WebKit has not been run.** Chromium touch/viewport emulation cannot establish Safari's native fullscreen, keyboard, Files app, download, memory-pressure or background-tab behavior. Fullscreen falls back to an in-page expanded view when native support is unavailable.
2. **Real movie playback, every external game/app and live proxy destinations are not verified.** External providers, authentication, geographic/IP restrictions, upstream challenges, CORS/CSP and service availability can still prevent playback. An iframe load event does not prove that video is playing. No stream was downloaded as part of this work.
3. **The omitted asset directories must be retained/restored.** A thumbnail fallback is not a replacement game bundle. The package cannot verify game-specific engines, local artwork or every game's save/control API without those files.
4. **No live host/Caddy deployment was performed.** The supplied Caddyfile, lockfile and deployment script are unchanged. Preserve your production-specific changes and environment. Run a single application instance per file-backed account-data directory; this release does not introduce multi-process database transactions.
5. **Proxy content is untrusted.** The existing same-origin proxy architecture is not a strong isolation boundary for untrusted third-party scripts. Blocking private relay targets and stripping response headers does not solve that architectural risk. A separate origin/deployment for proxy content, restricted server egress and account-gated AI are appropriate additional hardening for a public service. Direct movie sources can have their own ads/tracking. This is not a complete security audit or a guarantee of ad blocking.
6. **Backup limits:** 128 MiB JSON safety limit; unsupported/circular structures are rejected. Imports are atomic per database transaction, not across the entire browser profile. Legacy files missing schema information cannot always be restored safely. Browser storage does not expose every internal detail (for example, an auto-increment counter's deleted historical values), and backups are not bit-for-bit browser-profile clones. Keep backups private and take a fresh backup before importing.
7. **Game message saves accept JSON-compatible content only.** This fixes the implemented message API; it does not add universal save support to games that use other APIs. Synthetic keyboard events are not trusted hardware input, so some games or inaccessible cross-origin frames will not accept the on-screen keyboard.
8. **The HTML game download is an online launcher.** It still needs this hosted site, its assets and an internet connection; it is not a packaged offline game.
9. **Dependency scope:** Fastify and vulnerable transitive `fast-uri` releases were updated and `pnpm audit --prod` reports no known vulnerabilities. The provided proxy stack remains pinned for compatibility; this is not a complete dependency-security certification.

## Short acceptance check on your actual iPad

After merging the replacement over your existing project:

- [ ] Navigate between pages in portrait and landscape; test Back/Forward and a copied game link.
- [ ] Search/filter games, toggle a favorite, use Random and Most Played, and load more results.
- [ ] Open one restored local game and one proxied game. Test sound, reload, fullscreen/expanded view, touch keys and left/right-handed mode.
- [ ] Export a backup to Files. In a separate test browser/profile, restore a disposable save and check the game can read it. Keep your original backup.
- [ ] Confirm cache reset keeps an existing local game save and favorite. Expect proxy state to be reset; close other site tabs if requested.
- [ ] Test one movie and one TV episode from your actual host. Switch seasons/providers, rotate the iPad, then close and reopen the player.
- [ ] Test login, DM send/retry, mini-chat, and the iPad software keyboard. Do not delete a real account just to test the UI.
- [ ] Check configured AI and reports. Missing credentials/webhooks should show an explicit error rather than success.
