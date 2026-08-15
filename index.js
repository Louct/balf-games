import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { hostname } from "node:os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocket, WebSocketServer } from "ws";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";

const _require = createRequire(import.meta.url);
const epoxypath = dirname(_require.resolve("@mercuryworkshop/epoxy-transport"));
// libcurl-transport 2.0.5 dropped the libcurlPath helper entirely — the whole
// package was restructured from "ships a static bundle + a path export" to
// "a single ProxyTransport class" (dist/index.mjs default-exports
// LibcurlClient). The frontend (public/js/scramjet-init.js) only ever
// dynamically imports /libcurl/index.mjs and uses whatever it default-exports,
// so this still works — it just needs the same dirname(require.resolve(...))
// pattern epoxypath already uses one line up, since the package itself no
// longer hands us the path directly.
const libcurlPath = dirname(_require.resolve("@mercuryworkshop/libcurl-transport"));
// scramjet-controller (v2) doesn't export a path helper either — same
// dirname(require.resolve(...)) trick as libcurl above. require.resolve
// follows the package's "main"/"exports" field to dist/controller-external.mjs,
// so dirname(...) is already the dist/ folder we need to serve statically.
const scramjetControllerPath = dirname(_require.resolve("@mercuryworkshop/scramjet-controller"));
const scryptAsync = promisify(scrypt);

const publicpath = fileURLToPath(new URL("./public/", import.meta.url));


// --- password hashing ---

const KEYLEN = 64;
const SCRYPT_OPTS = { N: 2 ** 15, maxmem: 64 * 1024 * 1024 };

async function hashpw(pw) {
	const salt = randomBytes(16).toString("hex");
	const derived = await scryptAsync(pw, salt, KEYLEN, SCRYPT_OPTS);
	return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function verifypw(pw, stored) {
	if (!stored?.startsWith("scrypt:")) return false;
	const [, salt, hash] = stored.split(":");
	const expected = Buffer.from(hash, "hex");
	const actual = await scryptAsync(pw, salt, expected.length, SCRYPT_OPTS);
	return timingSafeEqual(expected, actual);
}



// --- helpers ---

function getclientip(req) {
	const forwarded = req.headers["x-forwarded-for"];
	return forwarded ? forwarded.split(",")[0].trim() : req.ip;
}

function isvaliddeviceid(id) {
	return typeof id === "string" && /^[a-f0-9]{64}$/.test(id);
}

function maketoken() {
	return randomBytes(36).toString("base64url");
}

function safefilename(name) {
	return name.toLowerCase().replace(/[^a-z0-9_\-.]/g, "_");
}

function gettoken(req) {
	const header = req.headers.authorization || "";
	return header.replace(/^Bearer\s+/i, "").trim();
}



// --- per-user file database (database/<username>.json) ---

const dbdir = join(process.cwd(), "database");
if (!existsSync(dbdir)) mkdirSync(dbdir, { recursive: true });

function userpath(username) {
	return join(dbdir, safefilename(username) + ".json");
}

function readuser(username) {
	try {
		return JSON.parse(readFileSync(userpath(username), "utf8"));
	} catch {
		return null;
	}
}

function writeuser(data) {
	// write-then-rename so a crash mid-write can't corrupt the file
	const dest = userpath(data.username);
	const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, JSON.stringify(data));
	renameSync(tmp, dest);
	indexuser(data);
}

function deleteuser(user) {
	if (!user?.username) return;
	const lc = user.username.toLowerCase();

	usernames.delete(lc);
	if (user.deviceId) deviceindex.delete(user.deviceId);

	if (user.ip) {
		const ips = ipindex.get(user.ip);
		if (ips) {
			ips.delete(lc);
			if (!ips.size) ipindex.delete(user.ip);
		}
	}

	try { unlinkSync(userpath(user.username)); } catch { /* already gone */ }
}

function allusers() {
	try {
		return readdirSync(dbdir)
			.filter(f => f.endsWith(".json"))
			.map(f => {
				try { return JSON.parse(readFileSync(join(dbdir, f), "utf8")); }
				catch { return null; }
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

function finduser(token) {
	const username = tokenindex.get(token);
	if (!username) return null;

	const user = readuser(username);
	if (user?.sessions?.[token]) return user;

	// stale token — user file was deleted or session was removed outside our process
	tokenindex.delete(token);
	return null;
}



// --- in-memory indices ---
// rebuilt on startup, kept in sync on writes. saves us from scanning
// every json file on every request.

const tokenindex = new Map();   // token -> username (lowercase)
const usernames = new Map();    // lowercase name -> original case
const deviceindex = new Map();  // device fingerprint -> username (lowercase)
const ipindex = new Map();      // ip -> Set<username (lowercase)>

function indexuser(u) {
	if (!u?.username) return;
	const lc = u.username.toLowerCase();
	usernames.set(lc, u.username);
	if (u.deviceId) deviceindex.set(u.deviceId, lc);
	if (u.ip) {
		let set = ipindex.get(u.ip);
		if (!set) { set = new Set(); ipindex.set(u.ip, set); }
		set.add(lc);
	}
}

function remembertoken(token, username) {
	tokenindex.set(token, username.toLowerCase());
}

function forgettoken(token) {
	tokenindex.delete(token);
}

function rebuildindices() {
	tokenindex.clear();
	usernames.clear();
	deviceindex.clear();
	ipindex.clear();
	for (const u of allusers()) {
		indexuser(u);
		if (!u.sessions) continue;
		for (const token of Object.keys(u.sessions)) {
			tokenindex.set(token, u.username.toLowerCase());
		}
	}
	console.log(`indices loaded: ${usernames.size} users, ${tokenindex.size} sessions, ${deviceindex.size} devices, ${ipindex.size} ips`);
}
rebuildindices();



// --- play counts (gameplays.json) ---
// we only track plays for games in the aetheris catalog, not arbitrary ids.

const gamesfile = join(publicpath, "assets/data/aetheris.json");

function loadids() {
	try {
		const games = JSON.parse(readFileSync(gamesfile, "utf8"));
		return new Set(games.map(g => String(g.id)));
	} catch (err) {
		console.warn("couldn't load aetheris.json for play filtering:", err.message);
		return null;
	}
}

const aetherisids = loadids();
console.log(`plays allowlist: ${aetherisids ? aetherisids.size + " games" : "disabled (file missing)"}`);

function isgame(id) {
	return aetherisids ? aetherisids.has(String(id)) : true;
}

const playsfile = join(process.cwd(), "gameplays.json");
const FLUSH_DELAY = 5_000;

let playscache = null;
let playsdirty = false;
let flushtimer = null;

function loadplays() {
	if (playscache) return playscache;
	try {
		playscache = JSON.parse(readFileSync(playsfile, "utf8"));
	} catch {
		playscache = {};
	}
	return playscache;
}

function flushplays() {
	if (!playsdirty || !playscache) return;
	try {
		const tmp = `${playsfile}.${process.pid}.${Date.now()}.tmp`;
		writeFileSync(tmp, JSON.stringify(playscache));
		renameSync(tmp, playsfile);
		playsdirty = false;
	} catch (err) {
		console.error("failed to flush plays:", err);
	}
}

function scheduleflush() {
	playsdirty = true;
	if (flushtimer) return;
	flushtimer = setTimeout(() => {
		flushtimer = null;
		flushplays();
	}, FLUSH_DELAY);
}

function bumpplay(id) {
	const plays = loadplays();
	plays[id] = (plays[id] || 0) + 1;
	scheduleflush();
}

if (!existsSync(playsfile)) {
	playscache = {};
	playsdirty = true;
	flushplays();
}



// --- wisp / proxy ---

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [ // yes ik im blocking porn sites but why not
		/(^|\.)pornhub\.com$/i,
		/(^|\.)xvideos\.com$/i,
		/(^|\.)xhamster\.com$/i,
		/(^|\.)xnxx\.com$/i,
		/(^|\.)redtube\.com$/i,
		/(^|\.)youporn\.com$/i,
		/(^|\.)tube8\.com$/i,
		/(^|\.)spankbang\.com$/i,
		/(^|\.)beeg\.com$/i,
		/(^|\.)eporner\.com$/i,
		/(^|\.)porntube\.com$/i,
		/(^|\.)drtuber\.com$/i,
		/(^|\.)txxx\.com$/i,
		/(^|\.)sunporno\.com$/i,
		/(^|\.)bravotube\.com$/i,
		/(^|\.)porntrex\.com$/i,
		/(^|\.)ixxx\.com$/i,
		/(^|\.)nuvid\.com$/i,
		/(^|\.)thumbzilla\.com$/i,
		/(^|\.)wankoz\.com$/i,
		/(^|\.)anysex\.com$/i,
		/(^|\.)pornoxo\.com$/i,
		/(^|\.)mrdeepfakes\.com$/i,
		/(^|\.)fapello\.com$/i,
		/(^|\.)thothub\.tv$/i,
		/(^|\.)coomer\.su$/i,
		/(^|\.)nekohouse\.su$/i,
		/(^|\.)simpcity\.su$/i,
	],
	port_blacklist: [8080],
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});


// --- online counter (SSE) ---

const clients = new Set();
let broadcastpending = null;

function broadcastcount() {
	if (broadcastpending) return;
	// coalesce rapid connect/disconnect bursts into a single write
	broadcastpending = setTimeout(() => {
		broadcastpending = null;
		const msg = `data: ${clients.size}\n\n`;
		for (const res of clients) {
			try { res.write(msg); } catch { clients.delete(res); }
		}
	}, 50);
}

// keep SSE connections alive through proxies that kill idle streams
setInterval(() => {
	for (const res of clients) {
		try { res.write(": heartbeat\n\n"); } catch { clients.delete(res); }
	}
}, 30_000);


// --- fastify ---

function handleupgrade(req, socket, head) {
	if (req.url.endsWith("/wisp/")) {
		wisp.routeRequest(req, socket, head);
		return;
	}

	if (req.url.startsWith("/wsproxy/")) {
		proxywsconnection(req, socket, head);
		return;
	}

	socket.end();
}

function proxywsconnection(req, socket, head) {
	const path = req.url.slice("/wsproxy/".length);
	const slash = path.indexOf("/");
	const hostport = slash === -1 ? path : path.slice(0, slash);
	const rest = slash === -1 ? "" : path.slice(slash);

	const host = hostport.split(":")[0];
	if (host !== "growden.io" && !host.endsWith(".growden.io")) {
		socket.end();
		return;
	}

	const upstream = new WebSocket(`wss://${hostport}${rest}`, {
		headers: { origin: "https://growden.io" },
	});

	const timeout = setTimeout(() => {
		upstream.terminate();
		socket.end();
	}, 10_000);

	upstream.on("open", () => {
		clearTimeout(timeout);
		const wss = new WebSocketServer({ noServer: true });
		wss.handleUpgrade(req, socket, head, (browser) => {
			browser.on("message", (data) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data); });
			upstream.on("message", (data) => { if (browser.readyState === WebSocket.OPEN) browser.send(data); });
			browser.on("close", () => upstream.close());
			upstream.on("close", () => browser.close());
			browser.on("error", () => upstream.close());
			upstream.on("error", () => browser.close());
		});
	});

	upstream.on("error", (err) => {
		clearTimeout(timeout);
		console.error("ws proxy error:", err.message);
		socket.end();
	});
}

const fastify = Fastify({
	trustProxy: true,
	serverFactory: (handler) =>
		createServer()
			.on("request", (req, res) => {
				// iOS Safari blocks AudioContext.resume() in iframes without this
				res.setHeader("Permissions-Policy", "autoplay=*, fullscreen=*");
				handler(req, res);
			})
			.on("upgrade", handleupgrade),
});




fastify.get("/online", (req, reply) => {
	reply.hijack();
	const res = reply.raw;
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
		"X-Accel-Buffering": "no",
		"Access-Control-Allow-Origin": "*",
	});
	clients.add(res);
	broadcastcount();
	req.raw.on("close", () => { clients.delete(res); broadcastcount(); });
});

fastify.get("/online-count", (_req, reply) => {
	reply.header("Access-Control-Allow-Origin", "*");
	reply.send({ count: clients.size });
});



// cached responses for the top/counts endpoints — recalculated every 10s at most
let toppopular = null;
let topstale = 0;
let countscache = null;
let countsstale = 0;
const CACHE_TTL = 10_000;

fastify.get("/api/plays/top", (_req, reply) => {
	const now = Date.now();
	if (!toppopular || now - topstale > CACHE_TTL) {
		toppopular = Object.entries(loadplays())
			.filter(([id]) => isgame(id))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([id]) => id);
		topstale = now;
	}
	reply.send(toppopular);
});

fastify.get("/api/plays/counts", (_req, reply) => {
	const now = Date.now();
	if (!countscache || now - countsstale > CACHE_TTL) {
		countscache = {};
		for (const [id, count] of Object.entries(loadplays())) {
			if (isgame(id)) countscache[id] = count;
		}
		countsstale = now;
	}
	reply.send(countscache);
});

// one bump per (fingerprint, game) per minute — stops trivial loop inflation
const BUMP_WINDOW = 60_000;
const playbumps = new Map();

fastify.post("/api/plays/:id", (req, reply) => {
	const { id } = req.params;
	if (!id || id.length > 128) return reply.code(400).send({ ok: false });
	if (!isgame(id)) return reply.code(400).send({ ok: false, error: "Game not tracked." });

	const deviceid = req.body?.deviceId;
	const fp = isvaliddeviceid(deviceid) ? `dev:${deviceid}` : `ip:${getclientip(req)}`;
	const key = `${fp}|${id}`;
	const now = Date.now();
	const last = playbumps.get(key) || 0;

	if (now - last < BUMP_WINDOW) return reply.send({ ok: true, throttled: true });
	playbumps.set(key, now);

	// gc: if the map gets big, drop expired entries
	if (playbumps.size > 20_000) {
		const cutoff = now - BUMP_WINDOW;
		for (const [k, ts] of playbumps) {
			if (ts < cutoff) playbumps.delete(k);
		}
	}

	bumpplay(id);
	reply.send({ ok: true });
});



// --- discord webhooks ---

const REPORT_WEBHOOK_URL = process.env.REPORT_WEBHOOK_URL || "";
const STATS_WEBHOOK_URL  = process.env.STATS_WEBHOOK_URL  || "";

const STATS_INTERVAL = 2 * 60 * 60 * 1000;       // post stats every 2h
const REPORT_COOLDOWN = 2 * 60 * 1000;            // 2min between reports per fingerprint
const LOGIN_WINDOW = 30 * 1000;                    // 30s sliding window for login attempts
const MAX_LOGIN_PER_FP = 5;                        // per device per window
const MAX_LOGIN_PER_ACCT = 15;                     // per account per window

const reporttimes = new Map();
const loginattempts = new Map();
const loginbyaccount = new Map();

fastify.post("/api/report", async (req, reply) => {
	const { game, issue, steps, notes, url, deviceId: deviceid } = req.body || {};

	const ratelimitkey = isvaliddeviceid(deviceid) ? `fp:${deviceid}` : `ip:${getclientip(req)}`;
	const now = Date.now();
	const remaining = REPORT_COOLDOWN - (now - (reporttimes.get(ratelimitkey) || 0));
	if (remaining > 0) return reply.code(429).send({ ok: false, error: `Too many reports. Try again in ${Math.ceil(remaining / 1000)}s.` });

	if (!issue || !steps) return reply.code(400).send({ ok: false, error: "Missing required fields." });
	if (steps.length > 2000 || (notes && notes.length > 1000)) return reply.code(400).send({ ok: false, error: "Input too long." });

	reporttimes.set(ratelimitkey, now);
	if (reporttimes.size > 5000) {
		const cutoff = now - REPORT_COOLDOWN;
		for (const [k, ts] of reporttimes) { if (ts < cutoff) reporttimes.delete(k); }
	}

	if (!REPORT_WEBHOOK_URL) {
		console.log("[report] received but no webhook url configured:", { game, issue });
		return reply.send({ ok: true });
	}

	const fields = [
		{ name: "🎮 Game", value: String(game || "Unknown").slice(0, 256), inline: true },
		{ name: "❌ Issue", value: String(issue).slice(0, 256), inline: true },
		{ name: "🔁 How to recreate", value: String(steps).slice(0, 1024), inline: false },
		{ name: "🌐 URL", value: String(url || "Unknown").slice(0, 512), inline: false },
	];
	if (notes) fields.splice(3, 0, { name: "📝 Extra notes", value: String(notes).slice(0, 1024), inline: false });

	const payload = {
		username: "Aetheris Bug Reporter",
		embeds: [{
			title:     "🚩 New Game Report",
			color:     0xa855f7,
			fields,
			timestamp: new Date().toISOString(),
			footer:    { text: "Aetheris • Game Report" },
		}],
	};

	try {
		const res = await fetch(REPORT_WEBHOOK_URL, {
			method:  "POST",
			headers: { "Content-Type": "application/json" },
			body:    JSON.stringify(payload),
		});
		if (!res.ok) {
			console.error("report webhook failed:", res.status);
			return reply.code(502).send({ ok: false, error: "Failed to send report." });
		}
		reply.send({ ok: true });
	} catch (e) {
		console.error("report webhook error:", e);
		reply.code(500).send({ ok: false, error: "Internal error." });
	}
});



async function poststats() {
	if (!STATS_WEBHOOK_URL) return;

	const plays = loadplays();
	const totalplays = Object.values(plays).reduce((a, b) => a + b, 0);
	const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
	const top5 = Object.entries(plays)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([id, count], i) => `${medals[i]} **${id}** — ${count} plays`)
		.join("\n");

	const payload = {
		username: "aetheris stats",
		embeds: [{
			title:     "📊 Site Stats",
			color:     0xa855f7,
			fields: [
				{ name: "👥 Online Now",  value: String(clients.size), inline: true  },
				{ name: "🎮 Total Plays", value: String(totalplays),   inline: true  },
				{ name: "🔥 Top 5 Games", value: top5 || "No plays yet", inline: false },
			],
			timestamp: new Date().toISOString(),
			footer:    { text: "Aetheris • Auto Stats" },
		}],
	};

	try {
		const res = await fetch(STATS_WEBHOOK_URL, {
			method:  "POST",
			headers: { "Content-Type": "application/json" },
			body:    JSON.stringify(payload),
		});
		if (!res.ok) console.error("stats webhook failed:", res.status);
		else console.log("stats posted to discord");
	} catch (e) {
		console.error("stats webhook error:", e);
	}
}

poststats();
setInterval(poststats, STATS_INTERVAL);



// returns the user object or null (after sending an error response)
function requireauth(req, reply) {
	const token = gettoken(req);
	if (!token) {
		reply.code(401).send({ ok: false, error: "Not authenticated." });
		return null;
	}
	const user = finduser(token);
	if (!user) {
		reply.code(401).send({ ok: false, error: "Invalid or expired session." });
		return null;
	}
	return user;
}

function cleanupdms(user) {
	const senderlower = user.username.toLowerCase();
	for (const otherlower of Object.keys(user.dms || {})) {
		const other = readuser(otherlower);
		if (other?.dms) {
			delete other.dms[senderlower];
			writeuser(other);
		}
	}
}



fastify.post("/api/accounts/register", async (req, reply) => {
	const ip = getclientip(req);
	const { username, password, deviceId: deviceid } = req.body || {};

	if (!username || !password) return reply.code(400).send({ ok: false, error: "Missing username or password." });
	if (username.length < 2 || username.length > 32) return reply.code(400).send({ ok: false, error: "Username must be 2–32 characters." });
	if (password.length < 4 || password.length > 128) return reply.code(400).send({ ok: false, error: "Password must be 4–128 characters." });
	if (!/^[a-zA-Z0-9_\-\.]+$/.test(username)) return reply.code(400).send({ ok: false, error: "Username may only contain letters, numbers, _, -, ." });
	if (!isvaliddeviceid(deviceid)) return reply.code(400).send({ ok: false, error: "Missing or invalid device fingerprint. Please enable cookies/localStorage." });

	const loweruser = username.toLowerCase();

	const existinglc = deviceindex.get(deviceid);
	if (existinglc) {
		const existing = readuser(existinglc);
		if (existing) return reply.code(403).send({ ok: false, error: `This device already has an account (${existing.username}). Log in or delete it first.` });
		// stale index entry — clean up and continue
		deviceindex.delete(deviceid);
	}

	if (usernames.has(loweruser) || readuser(loweruser)) return reply.code(409).send({ ok: false, error: "Username already taken." });

	writeuser({ username, passwordHash: await hashpw(password), ip, deviceId: deviceid, createdAt: Date.now(), sessions: {}, dms: {} });
	reply.send({ ok: true, username });
});


fastify.post("/api/accounts/login", async (req, reply) => {
	const ip = getclientip(req);
	const { username, password, deviceId: deviceid } = req.body || {};
	if (!username || !password) return reply.code(400).send({ ok: false, error: "Missing credentials." });

	const now = Date.now();
	const userlc = String(username).toLowerCase();
	const fp = isvaliddeviceid(deviceid) ? `dev:${deviceid}` : `ip:${ip}`;
	const fpkey = `${userlc}|${fp}`;
	const acctkey = userlc;

	function bump(map, key) {
		const entry = map.get(key) || { count: 0, windowstart: now };
		if (now - entry.windowstart > LOGIN_WINDOW) {
			entry.count = 0;
			entry.windowstart = now;
		}
		entry.count++;
		map.set(key, entry);
		return entry;
	}

	function gc(map) {
		if (map.size <= 10_000) return;
		const cutoff = now - LOGIN_WINDOW;
		for (const [k, v] of map) {
			if (v.windowstart < cutoff) map.delete(k);
		}
	}

	const fpattempt = bump(loginattempts, fpkey);
	const acctattempt = bump(loginbyaccount, acctkey);
	gc(loginattempts);
	gc(loginbyaccount);

	const overfp = fpattempt.count > MAX_LOGIN_PER_FP;
	const overacct = acctattempt.count > MAX_LOGIN_PER_ACCT;
	if (overfp || overacct) {
		const worst = overfp ? fpattempt : acctattempt;
		const retryafter = Math.ceil((LOGIN_WINDOW - (now - worst.windowstart)) / 1000);
		return reply.code(429).send({ ok: false, error: `Too many login attempts. Try again in ${retryafter}s.` });
	}

	const user = readuser(username.toLowerCase());
	if (!user || !await verifypw(password, user.passwordHash)) {
		return reply.code(401).send({ ok: false, error: "Invalid username or password." });
	}

	const token = maketoken();
	user.sessions ??= {};
	user.sessions[token] = { ip, createdAt: Date.now() };
	user.ip = ip;
	writeuser(user);
	remembertoken(token, user.username);

	reply.send({ ok: true, token, username: user.username });
});


fastify.post("/api/accounts/logout", (req, reply) => {
	const token = gettoken(req);
	if (!token) return reply.code(400).send({ ok: false, error: "No token." });

	const user = finduser(token);
	if (user) {
		delete user.sessions[token];
		writeuser(user);
	}
	forgettoken(token);
	reply.send({ ok: true });
});


fastify.delete("/api/accounts/delete", (req, reply) => {
	const token = gettoken(req);
	if (!token) return reply.code(400).send({ ok: false, error: "No token." });

	const user = finduser(token);
	if (!user) return reply.code(401).send({ ok: false, error: "Invalid or expired session." });

	cleanupdms(user);
	for (const t of Object.keys(user.sessions || {})) forgettoken(t);
	deleteuser(user);
	reply.send({ ok: true });
});


fastify.delete("/api/accounts/delete-all-mine", (req, reply) => {
	const { deviceId: deviceid } = req.body || {};
	if (!isvaliddeviceid(deviceid)) return reply.code(400).send({ ok: false, error: "Missing device fingerprint." });

	const lc = deviceindex.get(deviceid);
	if (!lc) return reply.send({ ok: true, deleted: 0 });

	const user = readuser(lc);
	if (!user) { deviceindex.delete(deviceid); return reply.send({ ok: true, deleted: 0 }); }

	cleanupdms(user);
	for (const t of Object.keys(user.sessions || {})) forgettoken(t);
	deleteuser(user);

	reply.send({ ok: true, deleted: 1 });
});


fastify.get("/api/accounts/me", (req, reply) => {
	const user = requireauth(req, reply);
	if (!user) return;
	reply.send({ ok: true, username: user.username });
});


fastify.get("/api/accounts/search", (req, reply) => {
	const me = requireauth(req, reply);
	if (!me) return;

	const q = String(req.query.q || "").trim().toLowerCase();
	if (q.length < 2) return reply.send({ ok: true, users: [] });

	const mylower = me.username.toLowerCase();
	const prefixMatches = [];
	const substringMatches = [];

	for (const [lc, original] of usernames) {
		if (lc === mylower) continue;
		if (lc.startsWith(q)) {
			prefixMatches.push(original);
		} else if (lc.includes(q)) {
			substringMatches.push(original);
		}
		if (prefixMatches.length + substringMatches.length >= 20) break;
	}
	reply.send({ ok: true, users: [...prefixMatches, ...substringMatches].slice(0, 20) });
});



const DM_MAX = 500;

fastify.get("/api/dm/:recipient", (req, reply) => {
	const me = requireauth(req, reply);
	if (!me) return;

	const recipientlower = req.params.recipient.toLowerCase();
	if (!usernames.has(recipientlower)) return reply.code(404).send({ ok: false, error: "User not found." });

	const msgs = (me.dms || {})[recipientlower] || [];
	const after = parseInt(req.query.after || "0", 10);
	reply.send(after ? msgs.filter(m => m.time > after) : msgs);
});


fastify.post("/api/dm/:recipient", async (req, reply) => {
	const me = requireauth(req, reply);
	if (!me) return;

	const recipientlower = req.params.recipient.toLowerCase();
	const { message } = req.body || {};

	if (!message?.trim()) return reply.code(400).send({ ok: false, error: "Empty message." });
	if (message.length > 3000) return reply.code(400).send({ ok: false, error: "Message too long (max 3000 characters)." });

	const recipient = readuser(recipientlower);
	if (!recipient) return reply.code(404).send({ ok: false, error: "User not found." });

	const senderlower = me.username.toLowerCase();
	if (senderlower === recipientlower) return reply.code(400).send({ ok: false, error: "Cannot DM yourself." });

	const msg = { from: senderlower, message: message.trim(), time: Date.now() };

	me.dms                ??= {};
	me.dms[recipientlower] ??= [];
	me.dms[recipientlower].push(msg);
	if (me.dms[recipientlower].length > DM_MAX) {
		me.dms[recipientlower] = me.dms[recipientlower].slice(-DM_MAX);
	}
	writeuser(me);

	recipient.dms             ??= {};
	recipient.dms[senderlower] ??= [];
	recipient.dms[senderlower].push(msg);
	if (recipient.dms[senderlower].length > DM_MAX) {
		recipient.dms[senderlower] = recipient.dms[senderlower].slice(-DM_MAX);
	}
	writeuser(recipient);

	reply.send({ ok: true });
});


fastify.get("/api/dm-inbox", (req, reply) => {
	const me = requireauth(req, reply);
	if (!me) return;

	const lastread = me.lastRead || {};
	const conversations = [];

	for (const [otherlower, msgs] of Object.entries(me.dms || {})) {
		if (!msgs.length) continue;
		const last = msgs[msgs.length - 1];
		const readts = lastread[otherlower] || 0;
		const unread = msgs.filter(m => m.from.toLowerCase() === otherlower && m.time > readts).length;
		conversations.push({
			with:        usernames.get(otherlower) ?? otherlower,
			lastMessage: last.message,
			lastTime:    last.time,
			unread,
		});
	}

	conversations.sort((a, b) => b.lastTime - a.lastTime);
	reply.send({ ok: true, conversations });
});


fastify.post("/api/dm-inbox/read/:other", (req, reply) => {
	const me = requireauth(req, reply);
	if (!me) return;

	me.lastRead                                 ??= {};
	me.lastRead[req.params.other.toLowerCase()] = Date.now();
	writeuser(me);
	reply.send({ ok: true });
});



fastify.get("/recover",    (_req, reply) => reply.redirect("/recover.html", 302));
fastify.get("/sw-recover", (_req, reply) => reply.redirect("/recover.html", 302));

fastify.addHook("onSend", (req, reply, payload, done) => {
	const path = req.url.split("?")[0];

	if (path === "/sw.js" || path === "/register-sw.js") {
		reply.header("Cache-Control", "no-store");
	} else if (String(reply.getHeader("content-type") || "").includes("text/html")) {
		reply.header("Cache-Control", "no-cache");
	} else if (path.startsWith("/css/") || path.startsWith("/js/")) {
		reply.header("Cache-Control", "public, max-age=600, stale-while-revalidate=604800");
	} else if (path.startsWith("/assets/data/")) {
		reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
	} else if (path.startsWith("/assets/images/") || path.startsWith("/assets/fonts/")) {
		reply.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
	}

	const brotliTypes = {
		".wasm.br":         "application/wasm",
		".framework.js.br": "application/javascript",
		".data.br":         "application/octet-stream",
	};
	for (const [ext, mime] of Object.entries(brotliTypes)) {
		if (path.endsWith(ext)) {
			reply.header("Content-Type", mime).header("Content-Encoding", "br");
			break;
		}
	}
	if (path.endsWith(".loader.js")) reply.header("Content-Type", "application/javascript");
	if (path.endsWith(".wasm"))      reply.header("Content-Type", "application/wasm");

	if (/\/(scramjet|controller|libcurl)\//.test(req.url)) {
		reply.header("Cross-Origin-Resource-Policy", "cross-origin");
		reply.header("Access-Control-Allow-Origin", "*");
	}

	done(null, payload);
});




// Epoxy 3.0.1 iterates headers with for..of, but BareHeaders is a plain
// object. We patch the one broken line at serve time instead of forking the pkg.
let patchedepoxy = null;
fastify.get("/epoxy/index.mjs", (_req, reply) => {
	if (!patchedepoxy) {
		const raw = readFileSync(join(epoxypath, "index.mjs"), "utf8");
		patchedepoxy = raw.replace(
			"for (let [key, value] of headers) {",
			"for (let [key, value] of (headers != null && typeof headers[Symbol.iterator] === \"function\" ? headers : Object.entries(headers || {}))) {"
		);
	}
	reply.type("application/javascript").send(patchedepoxy);
});

// scramjet 2.0.67-alpha.2's History.prototype.pushState/replaceState patch
// does `String(ctx.args[2])` unconditionally — when a router omits the url
// arg (very common: `history.replaceState(state, title)`), that's
// `String(undefined)`, the literal three-letter string "undefined", which
// then gets treated as a real relative URL and rewritten onto the proxied
// site's origin (e.g. https://example.com/undefined). Every SPA whose router
// makes that call renders its own "page not found" for a route literally
// named "undefined". Fixed upstream the day after this alpha was published
// (MercuryWorkshop/scramjet@98c1864, "[core] fix undefined popping up in
// history") but never republished to npm — patch the one-line regression at
// serve time the same way the epoxy fix above does, instead of forking the
// package or waiting on a new alpha release.
// scramjet's htmlRules strips `integrity` from <script>/<link> tags by
// setting the attribute to "" instead of removing it outright (unlike the
// adjacent nonce/csp rule right next to it in the same array, which does
// `fn: () => null` and gets fully removed). An empty-but-present `integrity`
// attribute is supposed to mean "no SRI check" per spec, and a synthetic
// same-shape test confirms Chromium treats it that way — but real sites
// (confirmed on discord.com, a Webflow-hosted page with 2MB+ stylesheets)
// still get their CSS/JS blocked with a computed-hash mismatch. Since we
// necessarily rewrite url()/@import references inside CSS (and JS bodies),
// any original integrity hash can never validate again regardless — so
// match the nonce/csp rule's approach and remove the attribute entirely
// instead of leaving an empty one behind.
let patchedscramjetcore = null;
fastify.get("/scramjet/scramjet.js", (_req, reply) => {
	if (!patchedscramjetcore) {
		let raw = readFileSync(join(scramjetPath, "scramjet.js"), "utf8");

		const undefinedhistorybroken = "s=(0,n.Qf)(t.args[2]);";
		if (!raw.includes(undefinedhistorybroken)) {
			console.warn("[scramjet-patch] expected minified history.ts pattern not found — shipping that part unpatched (did the alpha version change?)");
		} else {
			raw = raw.replace(undefinedhistorybroken, "s=t.args[2]?(0,n.Qf)(t.args[2]):void 0;");
		}

		const integritybroken = '{fn:()=>"",integrity:["script","link"]}';
		if (!raw.includes(integritybroken)) {
			console.warn("[scramjet-patch] expected minified htmlRules integrity pattern not found — shipping that part unpatched (did the alpha version change?)");
		} else {
			raw = raw.replace(integritybroken, '{fn:()=>null,integrity:["script","link"]}');
		}

		// The htmlRules fix above only covers *declarative* <script>/<link
		// integrity="...">. Scramjet's fetch()/Request() proxies rewrite the
		// URL argument to point at our (necessarily modified — url()/@import
		// references get rewritten) proxied content, but never touch a
		// caller-supplied `integrity` option in the init object. Any site
		// calling fetch(url, { integrity: "sha384-..." }) would hit the
		// browser's fetch-level SRI check against the *original* hash
		// regardless of what the DOM says. Strip it the same way the HTML
		// rewriter strips the declarative form. (Didn't end up being what was
		// actually breaking discord.com — see the Link-header fix right below
		// — but it's a real gap in its own right, worth keeping.)
		const fetchintegritybroken = "let r=(0,n.Qf)(t.args[0]);t.args[0]=e.rewriteUrl(r,s(t.args[1]))";
		if (!raw.includes(fetchintegritybroken)) {
			console.warn("[scramjet-patch] expected minified fetch()/Request() rewrite pattern not found — shipping that part unpatched (did the alpha version change?)");
		} else {
			raw = raw.split(fetchintegritybroken).join(
				fetchintegritybroken + ';if(t.args[1]&&t.args[1].integrity)t.args[1]={...t.args[1],integrity:""}'
			);
		}

		// This is the one that actually explains discord.com's CSS not
		// applying: the ORIGIN's document response itself carries a
		// `Link: <url>; rel=preload; as=style; integrity="sha384-..."` HTTP
		// response header (Webflow emits these for critical-CSS preloading).
		// rewriteResponseHeaders() rewrites the <url> inside each Link-header
		// entry to point at our (necessarily modified) proxied content, but
		// never strips the `integrity=` parameter riding along with it — so
		// the browser preloads our rewritten URL while still holding it to
		// the original, now-mismatched hash, entirely independent of the
		// <link> tag's own (correctly-stripped) integrity attribute. Strip
		// `integrity=...` out of the header value after the URL rewrite.
		const linkheaderintegritybroken = 'A.replace(/<([^>]+)>/gi,(e,t)=>`<${(0,i.Oy)(t,l,c)}>`));s.set("link",t)}';
		if (!raw.includes(linkheaderintegritybroken)) {
			console.warn("[scramjet-patch] expected minified Link-header rewrite pattern not found — shipping that part unpatched (did the alpha version change?)");
		} else {
			raw = raw.replace(
				linkheaderintegritybroken,
				'A.replace(/<([^>]+)>/gi,(e,t)=>`<${(0,i.Oy)(t,l,c)}>`).replace(/;\\s*integrity\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^;,]*)/gi,""));s.set("link",t)}'
			);
		}

		patchedscramjetcore = raw;
	}
	reply.type("application/javascript").send(patchedscramjetcore);
});

// controller.sw.js used to be patched here to buffer the request body before
// relaying it to the page-side Controller. That work moved into public/sw.js
// (buildrouteevent), which reads the body with .arrayBuffer() and hands
// route() an ArrayBuffer directly — stock route() already accepts an
// ArrayBuffer body and already puts it in the postMessage transfer list, so
// there is nothing left to rewrite here. Doing it on our side also fixes the
// case the patch could never reach: Request.prototype.body (a request body
// ReadableStream) is Chromium-only, so on other engines route()'s read of
// event.request.body yielded undefined and POSTs went out empty regardless of
// what this patch did to the relay. Serve the file untouched.

fastify.register(fastifyStatic, { root: publicpath, decorateReply: true });
// scramjet v2's controller package hardcodes these two path prefixes as its
// defaults (Config.scramjetPath / Config.injectPath / Config.wasmPath in
// @mercuryworkshop/scramjet-controller) — keep them as-is rather than
// overriding, so every call site that builds a Controller without a custom
// `config` just works.
fastify.register(fastifyStatic, { root: scramjetPath, prefix: "/scramjet/", decorateReply: false });
fastify.register(fastifyStatic, { root: scramjetControllerPath, prefix: "/controller/", decorateReply: false });
fastify.register(fastifyStatic, { root: libcurlPath, prefix: "/libcurl/", decorateReply: false });
fastify.register(fastifyStatic, { root: epoxypath, prefix: "/epoxy/", decorateReply: false });
fastify.setNotFoundHandler((_req, reply) => reply.code(404).type("text/html").sendFile("404.html"));



fastify.server.on("listening", () => {
	const a = fastify.server.address();
	const host = a.family === "IPv6" ? `[${a.address}]` : a.address;
	console.log("listening on:");
	console.log(`\thttp://localhost:${a.port}`);
	console.log(`\thttp://${hostname()}:${a.port}`);
	console.log(`\thttp://${host}:${a.port}`);
});

async function shutdown() {
	console.log("shutting down");
	flushplays();
	// force exit after 3s if graceful close hangs (websocket connections keep the port held)
	setTimeout(() => process.exit(0), 3000).unref();
	await fastify.close();
	process.exit(0);
}
process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);

const port = parseInt(process.env.PORT || "") || 8080;
try {
	await fastify.listen({ port, host: "::" });
} catch (err) {
	console.error("STARTUP FAILED:", err);
	process.exit(1);
}
