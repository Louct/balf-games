<div align="center">
  <img src="public/assets/images/icon.png" width="80" />
  <h1>Aetheris</h1>
  <p>A feature-packed site with games, apps, a built-in web proxy, movies, chat, and more.</p>
</div>

## Features

- **Games** — large library with favorites, search/filter, and popular section
- **Apps** — curated collection of web apps
- **Web Proxy** — browse any site through Scramjet + libcurl/epoxy transport
- **Movies & TV** — browse and watch via TMDB
- **Chat** — built-in DM system with user accounts
- **Cheats** — bookmarklet-style browser tools
- **Tab Cloaking** — disguise your tab title & icon (presets for Google, Drive, Classroom, etc.)
- **Panic Key** — instantly redirect to a safe URL with a hotkey
- **Themes** — multiple color themes
- **About:blank Launch** — open the site in an about:blank tab
- **Desktop UA Spoofing** — pretend to be on desktop from a mobile device
- **Performance Mode** — reduced animations for low-end devices
- **Bug Reports** — built-in report form on the home page

## Self-hosting

A VPS is recommended — the Scramjet proxy requires a persistent server and won't work on serverless platforms like Vercel.

**Requirements:** [Node.js](https://nodejs.org) (>=20), [Git](https://git-scm.com/download), [pnpm](https://pnpm.io), [Caddy](https://caddyserver.com)

```bash
git clone https://github.com/mynamescrax/aetheris
cd aetheris
pnpm install
```

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Start with PM2:

```bash
pm2 start index.js --name aetheris --node-args="--env-file=/path/to/.env" --kill-timeout 5000
pm2 save
```

Symlink the Caddyfile and reload:

```bash
ln -s /path/to/aetheris/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

## Credits

Game files sourced from [GN-Math](https://gn-math.dev) and [The Ultimate Game Stash](https://docs.google.com/document/d/1_FmH3BlSBQI7FGgAQL59-ZPe8eCxs35wel6JUyVaG8Q/preview?pli=1&tab=t.pvxbxnr5rcer&sle=true&pru=AAABnlARoYY*_5r087PNiPkXhHVGgjNYOA). If you fork this repo, consider giving it a star!
