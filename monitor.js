#!/usr/bin/env node

/**
 * monitor.js — site uptime monitor & auto-recovery for Caddy + Fastify
 * with Discord webhook alerts and periodic status reports.
 */

import { execSync }        from "node:child_process";
import { createWriteStream } from "node:fs";
import { connect }         from "node:net";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
if (!DISCORD_WEBHOOK) throw new Error("DISCORD_WEBHOOK env var not set");

const CONFIG = {
  domains: (process.env.DOMAINS || [
    "https://aetheris.win",
    "https://crax.lol",
    "https://hosting.crax.lol",
  ].join(",")).split(",").map(s => s.trim()).filter(Boolean),

  fallbackHost:   process.env.FALLBACK_HOST     || "127.0.0.1",
  fallbackPort:   parseInt(process.env.FALLBACK_PORT || "8080"),
  intervalMs:     parseInt(process.env.CHECK_INTERVAL || "60") * 1000,
  timeoutMs:      parseInt(process.env.TIMEOUT || "8000"),
  appService:     process.env.APP_SERVICE       || "aetheris",
  logFile:        process.env.LOG_FILE          || "/var/log/monitor.log",

  // How often to post a summary report to Discord (ms). Default: 15 minutes.
  reportIntervalMs: parseInt(process.env.REPORT_INTERVAL || String(15 * 60)) * 1000,
};

// ─── LOGGING ─────────────────────────────────────────────────────────────────

let logStream;
try {
  logStream = createWriteStream(CONFIG.logFile, { flags: "a" });
} catch {
  logStream = null;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream?.write(line + "\n");
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function run(cmd) {
  try {
    const out = execSync(cmd, { timeout: 15_000 }).toString().trim();
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: err.message };
  }
}

function serviceActive(name) {
  const { ok, out } = run(`systemctl is-active ${name}`);
  return ok && out === "active";
}

function tcpReachable(host, port, timeoutMs = 3000) {
  return new Promise(resolve => {
    const sock = connect({ host, port }, () => { sock.destroy(); resolve(true); });
    sock.setTimeout(timeoutMs);
    sock.on("error",   () => resolve(false));
    sock.on("timeout", () => { sock.destroy(); resolve(false); });
  });
}

function httpCheck(url, timeoutMs) {
  return new Promise(resolve => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { signal: ctrl.signal, redirect: "follow" })
      .then(res => {
        clearTimeout(timer);
        resolve({ ok: res.status < 500, status: res.status });
      })
      .catch(err => {
        clearTimeout(timer);
        const msg = err.name === "AbortError" ? "TIMEOUT" : err.message;
        resolve({ ok: false, error: msg });
      });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatDuration(ms) {
  if (ms < 1000) return "< 1s";
  const totalSecs = Math.round(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── DISCORD ─────────────────────────────────────────────────────────────────

async function sendWebhook(payload) {
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) log(`Discord webhook failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    log(`Discord webhook error: ${err.message}`);
  }
}

// Instant alert — site went down
async function alertDown(url, reason) {
  await sendWebhook({
    embeds: [{
      title:       "🔴 Site Down",
      description: `**${url}** is unreachable.`,
      color:       0xe74c3c,
      fields: [
        { name: "Error",     value: reason,                        inline: true },
        { name: "Time",      value: new Date().toUTCString(),      inline: false },
      ],
      footer: { text: "Aetheris Uptime Monitor" },
      timestamp: new Date().toISOString(),
    }],
  });
}

// Instant alert — site recovered
async function alertUp(url, downtimeMs) {
  await sendWebhook({
    embeds: [{
      title:       "🟢 Site Recovered",
      description: `**${url}** is back online.`,
      color:       0x2ecc71,
      fields: [
        { name: "Downtime", value: formatDuration(downtimeMs), inline: true },
        { name: "Time",     value: new Date().toUTCString(),   inline: false },
      ],
      footer: { text: "Aetheris Uptime Monitor" },
      timestamp: new Date().toISOString(),
    }],
  });
}

// Instant alert — recovery action taken
async function alertRecovery(type, detail) {
  await sendWebhook({
    embeds: [{
      title:       "🔧 Recovery Action",
      color:       0xf39c12,
      fields: [
        { name: "Type",   value: type,   inline: true },
        { name: "Action", value: detail, inline: true },
      ],
      footer: { text: "Aetheris Uptime Monitor" },
      timestamp: new Date().toISOString(),
    }],
  });
}

// Periodic summary report
async function sendReport() {
  const windowMs    = CONFIG.reportIntervalMs;
  const windowHours = windowMs / (1000 * 60 * 60);
  const windowLabel = windowHours % 1 === 0 ? `${windowHours}-Hour` : `${(windowHours * 60).toFixed(0)}-Minute`;

  for (const url of CONFIG.domains) {
    const s = state.get(url);
    if (!s) continue;

    const totalChecks  = s.totalChecks;
    const upChecks     = s.upChecks;
    const downChecks   = totalChecks - upChecks;
    const uptimePct    = totalChecks === 0 ? 100 : (upChecks / totalChecks) * 100;
    const downtimeMs   = s.totalDowntimeMs + (s.down && s.since ? Date.now() - s.since : 0);
    const isUp         = !s.down;

    const uptimeColor  = uptimePct === 100 ? 0x2ecc71 : uptimePct >= 95 ? 0xf39c12 : 0xe74c3c;

    await sendWebhook({
      embeds: [{
        title: `${new URL(url).hostname} — ${windowLabel} Status Report`,
        color: uptimeColor,
        fields: [
          {
            name:   "Status",
            value:  isUp ? "🟢 UP" : "🔴 DOWN",
            inline: true,
          },
          {
            name:   `Uptime (window)`,
            value:  `${uptimePct.toFixed(2)}%`,
            inline: true,
          },
          {
            name:   "Checks",
            value:  `${upChecks} up / ${downChecks} down of ${totalChecks} total`,
            inline: false,
          },
          {
            name:   "Active Downtime Duration",
            value:  downtimeMs > 0 ? formatDuration(downtimeMs) : "None",
            inline: true,
          },
          {
            name:   "Last Recorded Error",
            value:  s.lastError || "None",
            inline: true,
          },
        ],
        footer:    { text: `${new URL(url).hostname} Uptime Monitor` },
        timestamp: new Date().toISOString(),
      }],
    });

    // Reset window stats after reporting
    s.totalChecks    = 0;
    s.upChecks       = 0;
    s.totalDowntimeMs = 0;
    s.lastError      = null;
  }
}

// ─── RECOVERY ────────────────────────────────────────────────────────────────

async function recover(fallbackReachable) {
  const type = fallbackReachable ? "POSSIBLE_CADDY" : "POSSIBLE_APP";
  log(`Recovery triggered — type: ${type}, fallback reachable: ${fallbackReachable}`);

  if (type === "POSSIBLE_CADDY") {
    log("Running: systemctl reload caddy");
    run("systemctl reload caddy");
    await sleep(2000);

    if (!serviceActive("caddy")) {
      log("Caddy not active. Running: systemctl start caddy");
      const res = run("systemctl start caddy");
      log(`caddy start result: ${res.ok ? "ok" : "FAILED — " + res.out}`);
      await alertRecovery("Caddy", res.ok ? "systemctl start caddy → ok" : `FAILED: ${res.out}`);
    } else {
      log("caddy reload result: ok");
      await alertRecovery("Caddy", "systemctl reload caddy → ok");
    }

  } else {
    if (!serviceActive(CONFIG.appService)) {
      log(`Running: systemctl start ${CONFIG.appService}`);
      const res = run(`systemctl start ${CONFIG.appService}`);
      log(`${CONFIG.appService} start result: ${res.ok ? "ok" : "FAILED — " + res.out}`);
      await alertRecovery("Node App", res.ok ? `systemctl start ${CONFIG.appService} → ok` : `FAILED: ${res.out}`);
    } else {
      log(`Running: systemctl restart ${CONFIG.appService}`);
      const res = run(`systemctl restart ${CONFIG.appService}`);
      log(`${CONFIG.appService} restart result: ${res.ok ? "ok" : "FAILED — " + res.out}`);
      await alertRecovery("Node App", res.ok ? `systemctl restart ${CONFIG.appService} → ok` : `FAILED: ${res.out}`);
    }
  }
}

// ─── STATE ───────────────────────────────────────────────────────────────────

const state = new Map(
  CONFIG.domains.map(url => [url, {
    down:             false,
    since:            null,
    totalChecks:      0,
    upChecks:         0,
    totalDowntimeMs:  0,
    lastError:        null,
  }])
);

// ─── TICK ────────────────────────────────────────────────────────────────────

async function tick() {
  const results = await Promise.all(
    CONFIG.domains.map(async url => {
      const result = await httpCheck(url, CONFIG.timeoutMs);
      return { url, ...result };
    })
  );

  const failed  = results.filter(r => !r.ok);
  const passing = results.filter(r => r.ok);

  for (const { url } of passing) {
    const s = state.get(url);
    s.totalChecks++;
    s.upChecks++;
    if (s.down) {
      const downtimeMs = Date.now() - s.since;
      s.totalDowntimeMs += downtimeMs;
      log(`${url} is back UP. Downtime: ${formatDuration(downtimeMs)}`);
      await alertUp(url, downtimeMs);
      s.down  = false;
      s.since = null;
    }
  }

  for (const { url, status, error } of failed) {
    const s      = state.get(url);
    const reason = error || `HTTP ${status}`;
    s.totalChecks++;
    s.lastError = reason;
    if (!s.down) {
      s.down  = true;
      s.since = Date.now();
      log(`${url} is DOWN. Error: ${reason}`);
      await alertDown(url, reason);
    } else {
      const elapsed = Math.round((Date.now() - s.since) / 1000);
      log(`${url} still DOWN (${elapsed}s). Error: ${reason}`);
    }
  }

  if (failed.length > 0) {
    const fallbackReachable = await tcpReachable(CONFIG.fallbackHost, CONFIG.fallbackPort);
    log(`Fallback (port ${CONFIG.fallbackPort}) reachable: ${fallbackReachable}`);
    await recover(fallbackReachable);
  }
}

// ─── START ───────────────────────────────────────────────────────────────────

log(`Monitor starting. Watching ${CONFIG.domains.length} domain(s) every ${CONFIG.intervalMs / 1000}s:`);
for (const d of CONFIG.domains) log(`  ${d}`);

tick();
setInterval(tick, CONFIG.intervalMs);
setInterval(sendReport, CONFIG.reportIntervalMs);

process.on("SIGINT",  () => { log("Monitor stopped."); logStream?.end(); process.exit(0); });
process.on("SIGTERM", () => { log("Monitor stopped."); logStream?.end(); process.exit(0); });
