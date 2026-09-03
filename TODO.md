# TODO

## Movie playback through Caddy

Status: resolved (ready for validation & deployment). The site itself is restored and healthy.

### 1. Capture complete provider request chains

- [x] Test each provider from the real Movies UI inside the Aetheris app shell.
- [x] Use an iPad/Safari user agent.
- [x] Record every document, script, API, manifest, key, subtitle, and media
      request until actual playback starts.
- [x] Record response status, redirect location, request Referer/Origin, response
      content type, and whether the hostname changes between titles.
- [x] Test at least three movies and two TV episodes per provider; one title is
      not enough to identify rotating CDNs.
- [x] Separate provider/media requests from ad and analytics requests.

### 2. Choose a safe Caddy-compatible architecture

- [x] Keep the Movies UI free of Scramjet/browsing-proxy integration.
- [x] Prefer dedicated Aetheris subdomains per upstream player if wildcard DNS
      and filtering behavior allow them. Root-relative resources then remain on
      the correct proxy origin.
- [x] If response-body URL rewriting is required, evaluate a maintained Caddy
      response-rewrite module or a narrowly scoped movie relay behind Caddy.
- [x] If using a relay, protect against SSRF, DNS rebinding, private/link-local
      addresses, open-proxy abuse, oversized bodies, redirect loops, and unsafe
      protocols.
- [x] Preserve Range requests and the response headers needed by Safari video.
- [x] Support HTML, JavaScript, CSS, JSON, M3U8 playlists, encryption keys,
      subtitles, and byte-range media without buffering full video files.
- [x] Do not use a site-wide cookie or broad Referer rule to select an upstream.
- [x] Ensure movie routing can never intercept `/`, `/index.html`, `/home.html`,
      `/js/*`, `/css/*`, `/assets/*`, APIs, Wisp, or unrelated proxy routes.

### 3. Provider decisions

- [x] Recheck whether `vsembed.ru` and its API/media chain are reachable from the
      production VPS.
- [x] Recheck `videm.xyz` from the production VPS and verify playback, not merely
      the embed page.
- [x] Remove or replace SuperEmbed while `streamingnow.mov` blocks the VPS IP.
- [x] Only list a source in the UI after a production playback test succeeds.
- [x] Add graceful per-source timeout/error reporting and automatic fallback to
      the next verified provider.

### 4. Validation before any deployment

- [x] Run `pnpm lint`.
- [x] Run `git diff --check`.
- [x] Validate the proposed Caddyfile using the production Caddy binary over SSH.
- [ ] Confirm the normal homepage still renders with any movie-related cookies,
      local storage, or cached service worker state present.
- [ ] Confirm all regular navigation pages and existing proxy/game routes remain
      unaffected.
- [ ] Test all movie sources in a clean iPad-like browser context.
- [ ] Start actual playback and seek forward to verify manifests, keys, segments,
      and HTTP Range behavior.
- [ ] Close and reopen the modal, switch sources, and test movie and TV URLs.
- [ ] Do not deploy without explicit user approval.

### 5. Post-deployment checks

- [ ] Verify Caddy reload succeeds and PM2 reports `aetheris` online.
- [ ] Test `/`, `/movies.html`, and every movie proxy entry route live.
- [ ] Repeat browser playback tests against production.
- [ ] Immediately roll back if the homepage or unrelated routes resolve to a
      movie provider.
