# Aetheris — replacement package

This is a complete replacement **source** package, not a redesign. The original layout, themes, game catalogs, provider choices and asset paths have been kept.

## Install without losing your assets or data

**Merge the contents of the `aetheris/` folder into your existing project root. Overwrite matching source files; do not delete your existing project first.**

1. Back up your existing project and browser game saves before updating.
2. Keep your existing `.env`, `database/`, `gameplays.json`, `public/assets/games/` and `public/assets/images/`. They are deliberately **not included** in this ZIP. Do not replace them with empty folders.
3. Copy this package over your existing source files. Keep any production-specific Caddy configuration changes you have made since the supplied copy.
4. Use Node.js **20.19 or newer**; a current supported LTS is preferable. From your project root run:
   ```sh
   pnpm install --frozen-lockfile
   pnpm lint
   pnpm check
   pnpm test
   ```
   Fastify and vulnerable transitive `fast-uri` releases were updated; the proxy stack remains pinned for compatibility. There is no new build step.
5. Restart the existing site process using your normal process manager and existing environment-file configuration. For an existing PM2 process named `aetheris`, for example:
   ```sh
   pm2 restart aetheris --update-env
   ```
   Keep your existing `--env-file` setup. Do not create a second process on the same port.
6. Reload the site on your iPad. Changed first-party scripts and styles have new versioned URLs. Service-worker updates now offer a reload rather than interrupting a running game automatically. Close other site tabs if a proxy-cache reset reports that its databases are still open.

**Do not run a deployment command that resets this folder back to the old Git checkout.** The supplied `deploy.sh` is retained unchanged; review it before using it with this replacement.

For a fresh installation, restore the two omitted asset folders yourself. Missing game bundles cannot be reconstructed from the catalog. The site now explains missing local game files and uses a neutral thumbnail fallback when artwork is unavailable.

## Configuration notes

Existing configuration stays compatible. `.env.example` documents two additional, optional safety controls:

- `AI_REQUIRE_LOGIN=true`: require a valid chat-account session for chat/image AI generation. The default remains open to preserve your existing workflow. Provider keys still stay on the server.
- `RECOVER_DUPLICATE_INSTANCE=true`: explicitly opt into the existing duplicate-process recovery behavior. **By default, startup no longer terminates another process.**

`HOST` can optionally restrict the listen address. Keep your existing port, Caddy, Wisp and environment setup unless you deliberately change them. AI and report webhooks need your existing valid credentials/configuration; this ZIP does not supply new ones.

## What's included

- `FIXES.md`: completed fixes, organized by feature.
- `QA.md`: checks performed, their scope, limitations and a short real-iPad acceptance checklist.
- `tests/` and `scripts/check-source.js`: repeatable local regression and syntax checks.
- `PACKAGE-MANIFEST.json`: per-file checksums and changed/added-file list.

No `node_modules`, real credentials, live accounts, runtime play counts, old logs, omitted game bundles or omitted artwork are shipped.
