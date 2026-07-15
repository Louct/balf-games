<div align="center">
  <img src="public/assets/images/icon.png" width="80" />
  <h1>Aetheris</h1>
  <p>games, proxy, movies and a chat: all in one place</p>
  <p>open source again after 5 months</p>
</div>

## what's inside

- **Games**: big library with search, filters, favorites, and a popular section
- **Apps**: a collection of useful web apps
- **Web Proxy**: browse anything through Scramjet with libcurl/epoxy transports
- **Movies & TV**: search and watch using TMDB and external sources
- **Chat**: DMs with user accounts 
- **Cheats**: bookmarklet tools you can use
- **Tab Cloaking**: change your tab's title and icon (Google, Drive, Classroom presets and more)
- **Panic Key**: hit a hotkey and get redirected somewhere safe
- **Themes**: a few different color themes to pick from
- **About:blank Launch**: open the site hidden inside an about:blank tab
- **Performance Mode**: tones down animations if your device is struggling
- **Bug Reports**: report something broken right from the home page

## self-hosting

You need a VPS for this: the proxy needs a server and won't work on Vercel or similar platforms.

**you'll need:** [Node.js](https://nodejs.org) (>=20), [Git](https://git-scm.com/download), [pnpm](https://pnpm.io), [Caddy](https://caddyserver.com)

```bash
git clone https://github.com/mynamescrax/aetheris
cd aetheris
pnpm install
```

Set up your environment:

```bash
cp .env.example .env
# fill in your values
```

Start the server with PM2:

```bash
pm2 start index.js --name aetheris --node-args="--env-file=/path/to/.env" --kill-timeout 5000
pm2 save
```

Hook up Caddy:

```bash
ln -s /path/to/aetheris/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

## credits

Game files from [GN-Math](https://gn-math.dev) and [The Ultimate Game Stash](https://docs.google.com/document/d/1_FmH3BlSBQI7FGgAQL59-ZPe8eCxs35wel6JUyVaG8Q/preview?pli=1&pru=AAABnlARoYY*_5r087PNiPkXhHVGgjNYOA&tab=t.0). if you fork this, a star would be appreciated!