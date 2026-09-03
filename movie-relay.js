import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { URL } from "node:url";
import zlib from "node:zlib";

const MAX_REDIRECTS = 5;
const PROXY_ROUTE = "/movie-proxy";

const BLOCKED_DOMAINS = new Set([
	"adexchangerapid.com",
	"usrpubtrk.com",
	"histats.com",
	"s10.histats.com",
]);

function decodeEntities(str) {
	if (!str) return str;
	return str
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function unwrapProxyUrl(rawUrl) {
	let current = decodeEntities(rawUrl ? rawUrl.trim() : "");
	while (current.includes("/movie-proxy?url=")) {
		try {
			const dummyUrl = new URL(current, "http://127.0.0.1");
			const innerParam = dummyUrl.searchParams.get("url");
			if (innerParam) {
				current = decodeEntities(innerParam.trim());
			} else {
				break;
			}
		} catch {
			break;
		}
	}
	return current;
}

const HAS_ZSTD = typeof zlib.zstdDecompressSync === "function";

// Never offer upstream an encoding we cannot decode: otherwise it replies
// with those bytes, decompressBuffer returns them raw, and we serve
// compressed binary as text/html (browser renders it as garbage text).
function normalizeAcceptEncoding(incoming) {
	const fallback = HAS_ZSTD ? "gzip, deflate, br, zstd" : "gzip, deflate, br";
	if (!incoming || typeof incoming !== "string") return fallback;
	if (!HAS_ZSTD && incoming.toLowerCase().includes("zstd")) {
		const stripped = incoming
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s && !/^zstd(\s*;|$)/i.test(s))
			.join(", ");
		return stripped || fallback;
	}
	return incoming;
}

function decompressBuffer(buffer, encoding) {
	if (!encoding) return buffer;
	const enc = encoding.toLowerCase().trim();
	try {
		if (enc.includes("gzip")) return zlib.gunzipSync(buffer);
		if (enc.includes("br")) return zlib.brotliDecompressSync(buffer);
		if (enc.includes("deflate")) return zlib.inflateSync(buffer);
		// Modern browsers send `zstd` in accept-encoding and providers
		// (vidsrc, videm, …) honor it. Without this branch the zstd bytes
		// were served as text/html → page of garbage characters.
		if (enc.includes("zstd") && HAS_ZSTD) return zlib.zstdDecompressSync(buffer);
	} catch {
		// return original buffer if decompression fails
	}
	return buffer;
}

function isRealHtml(text) {
	if (!text || typeof text !== "string") return false;
	const snippet = text.slice(0, 500).toLowerCase();
	return snippet.includes("<!doctype html") || snippet.includes("<html") || snippet.includes("<head") || snippet.includes("<body");
}

function isPrivateIp(ip) {
	if (net.isIPv4(ip)) {
		const parts = ip.split(".").map(Number);
		if (parts[0] === 127) return true; // 127.0.0.0/8
		if (parts[0] === 10) return true; // 10.0.0.0/8
		if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
		if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
		if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16
		if (parts[0] === 0) return true; // 0.0.0.0/8
		return false;
	}
	if (net.isIPv6(ip)) {
		const norm = ip.toLowerCase();
		if (norm === "::1" || norm === "0:0:0:0:0:0:0:1") return true;
		if (norm.startsWith("fe8") || norm.startsWith("fe9") || norm.startsWith("fea") || norm.startsWith("feb")) return true;
		if (norm.startsWith("fc") || norm.startsWith("fd")) return true;
		if (norm.startsWith("::ffff:")) {
			const ipv4 = norm.slice(7);
			return isPrivateIp(ipv4);
		}
		return false;
	}
	return true;
}

async function validateUrl(rawUrl) {
	const unescaped = unwrapProxyUrl(rawUrl);

	let parsed;
	try {
		parsed = new URL(unescaped);
	} catch {
		throw new Error("Invalid target URL");
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Only http and https protocols are allowed");
	}

	const hostname = parsed.hostname.toLowerCase();
	if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
		throw new Error("Access to local hostnames is prohibited");
	}

	if (net.isIP(hostname)) {
		if (isPrivateIp(hostname)) {
			throw new Error("Access to private IP addresses is prohibited");
		}
	} else {
		try {
			const records = await dns.lookup(hostname, { all: true });
			for (const rec of records) {
				if (isPrivateIp(rec.address)) {
					throw new Error(`Hostname resolved to private IP (${rec.address})`);
				}
			}
		} catch (err) {
			if (err.message.includes("prohibited") || err.message.includes("private")) throw err;
			throw new Error(`DNS resolution failed for ${hostname}`);
		}
	}

	return parsed;
}

function rewriteHtml(html, targetUrl) {
	const baseUrl = new URL(unwrapProxyUrl(targetUrl.href));
	const origin = baseUrl.origin;
	const href = baseUrl.href;

	// Remove anti-devtools scripts & top checks, enable autoStart for VidSrc players
	let cleaned = html.replace(/<script[^>]*disable-devtool[^>]*>[\s\S]*?<\/script>/gi, "");
	cleaned = cleaned.replace(/if\s*\(\s*window\s*===\s*window\.top\s*\)[\s\S]*?\}/gi, "/* removed top check */");
	cleaned = cleaned.replace(/"autoStart"\s*:\s*false/g, '"autoStart":true');

	const rewriteAttr = (match, attr, quote, val) => {
		if (!val) return match;
		const decoded = unwrapProxyUrl(val);
		if (
			decoded.startsWith("data:") ||
			decoded.startsWith("blob:") ||
			decoded.startsWith("javascript:") ||
			decoded.startsWith(PROXY_ROUTE) ||
			decoded.startsWith("#") ||
			decoded.startsWith("/js/movie-proxy-client.js")
		) {
			return match;
		}

		try {
			const abs = new URL(decoded, href).href;
			const proxied = `${PROXY_ROUTE}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(href)}`;
			return `${attr}=${quote}${proxied}${quote}`;
		} catch {
			return match;
		}
	};

	cleaned = cleaned.replace(/\b(src|href|data-src|data-api)=(["'])([^"']+)\2/gi, rewriteAttr);

	const scriptTag = `<script>window.__MOVIE_PROXY_TARGET__=${JSON.stringify(href)};window.__MOVIE_PROXY_ORIGIN__=${JSON.stringify(origin)};</script><script src="/js/movie-proxy-client.js"></script>`;

	if (/<head[^>]*>/i.test(cleaned)) {
		cleaned = cleaned.replace(/(<head[^>]*>)/i, `$1\n${scriptTag}`);
	} else {
		cleaned = scriptTag + "\n" + cleaned;
	}

	return cleaned;
}

function rewriteM3u8(playlistText, targetUrl) {
	const baseUrl = new URL(unwrapProxyUrl(targetUrl.href));
	const href = baseUrl.href;
	const lines = playlistText.split("\n");

	const rewritten = lines.map((line) => {
		const trimmed = line.trim();
		if (!trimmed) return line;

		if (trimmed.startsWith("#EXT-X-KEY:")) {
			return line.replace(/URI=(["'])([^"']+)\1/gi, (match, quote, val) => {
				try {
					const unescapedVal = unwrapProxyUrl(val);
					const abs = new URL(unescapedVal, href).href;
					const proxied = `${PROXY_ROUTE}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(href)}`;
					return `URI=${quote}${proxied}${quote}`;
				} catch {
					return match;
				}
			});
		}

		if (!trimmed.startsWith("#")) {
			try {
				const unescapedLine = unwrapProxyUrl(trimmed);
				const abs = new URL(unescapedLine, href).href;
				return `${PROXY_ROUTE}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(href)}`;
			} catch {
				return line;
			}
		}

		return line;
	});

	return rewritten.join("\n");
}

function rewriteCss(cssText, targetUrl) {
	const baseUrl = new URL(unwrapProxyUrl(targetUrl.href));
	const href = baseUrl.href;
	return cssText.replace(/url\((["']?)([^"']+?)\1\)/gi, (match, quote, url) => {
		const trimmed = url.trim();
		if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return match;
		try {
			const abs = new URL(unwrapProxyUrl(trimmed), href).href;
			const proxied = `${PROXY_ROUTE}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(href)}`;
			return `url(${quote}${proxied}${quote})`;
		} catch {
			return match;
		}
	});
}

function rewriteJsImports(jsText, targetUrl) {
	const baseUrl = new URL(unwrapProxyUrl(targetUrl.href));
	const href = baseUrl.href;
	const srcUrl = targetUrl.href;

	// Vite 5 bundles keep their chunk table in m.f=[...] (the raw chunk paths,
	// e.g. "assets/vendor-x.js"), which dynamic import(__vite__mapDeps[N])
	// feeds to the module loader. Left relative they resolve against the proxy
	// document base instead of the upstream origin, so those chunk loads 404 /
	// NS_ERROR_CORRUPTED_CONTENT. Rewrite each chunk path to an absolute
	// proxied URL so the dynamic import goes back through us.
	const mapDepsPattern = /m\.f=(\(?)(\[[^;]*?\])(\)?)/g;
	let out = jsText.replace(mapDepsPattern, (whole, parenOpen, arr, parenClose) => {
		const rew = arr.replace(
			/"(?:\.\.?\/|\/)?(assets\/[^"']+\.(?:js|mjs|css|ts))"|'(?:\.\.?\/|\/)?(assets\/[^"']+\.(?:js|mjs|css|ts))'/g,
			(m, d1, d2) => {
				const p = (d1 || d2).replace(/^\.\.?\//, "");
				try {
					const abs = new URL(p, `${baseUrl.origin}/`).href;
					return JSON.stringify(`${PROXY_ROUTE}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(srcUrl)}`);
				} catch {
					return m;
				}
			}
		);
		return `m.f=${parenOpen}${rew}${parenClose}`;
	});

	// NOTE: no early return here — a bundle can contain BOTH the m.f chunk
	// table AND relative import() calls (e.g. Vite's
	// `j(()=>import("./Homepage-x.js"),__vite__mapDeps([...]))`). Rewriting
	// only the table leaves the imports resolving against /movie-proxy
	// (whose path merges to /<chunk>.js) so every lazy chunk 404s as HTML
	// and Firefox reports NS_ERROR_CORRUPTED_CONTENT. Rewrite both.
	out = out.replace(
		/(from\s*["']|import\s*["']|import\(\s*["'])(\.\.?\/[^"']+|\/assets\/[^"']+)(["'])/g,
		(match, prefix, path, suffix) => {
			try {
				const abs = new URL(path, href).href;
				const proxied = `${PROXY_ROUTE}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(href)}`;
				return prefix + proxied + suffix;
			} catch {
				return match;
			}
		}
	);

	// Asset workers: new URL("/assets/wasmPoolWorker-x.ts", import.meta.url)
	// resolves against the proxied document (→ /assets/... 404) instead of
	// the upstream origin once import.meta.url is the /movie-proxy URL.
	out = out.replace(
		/(new\s+URL\(\s*["'])(\.\.?\/[^"']+|\/assets\/[^"']+)(["'])/g,
		(match, prefix, path, suffix) => {
			try {
				const abs = new URL(path, href).href;
				const proxied = `${PROXY_ROUTE}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(href)}`;
				return prefix + proxied + suffix;
			} catch {
				return match;
			}
		}
	);

	return out;
}

function rewriteJson(jsonText, targetUrl) {
	const baseUrl = new URL(unwrapProxyUrl(targetUrl.href));
	const href = baseUrl.href;
	try {
		const parsed = JSON.parse(jsonText);
		const rewriteObj = (obj) => {
			if (!obj || typeof obj !== "object") return obj;
			for (const k of Object.keys(obj)) {
				if (typeof obj[k] === "string") {
					const val = obj[k].trim();
					if (val.startsWith("http://") || val.startsWith("https://") || val.endsWith(".m3u8") || val.includes("/embed/")) {
						try {
							const abs = new URL(unwrapProxyUrl(val), href).href;
							obj[k] = `${PROXY_ROUTE}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(href)}`;
						} catch {}
					}
				} else if (typeof obj[k] === "object") {
					rewriteObj(obj[k]);
				}
			}
			return obj;
		};
		return JSON.stringify(rewriteObj(parsed));
	} catch {
		return jsonText;
	}
}

export function registerMovieRelay(fastify) {
	fastify.get(PROXY_ROUTE, async (req, reply) => {
		let rawTarget = req.query.url;
		if (!rawTarget || typeof rawTarget !== "string") {
			reply.code(400).send("Missing url query parameter");
			return;
		}

		rawTarget = unwrapProxyUrl(rawTarget);

		if (rawTarget === "about:blank") {
			reply.code(200).type("text/html").send("<!DOCTYPE html><html><body></body></html>");
			return;
		}

		const customReferer = req.query.referer ? unwrapProxyUrl(req.query.referer) : null;

		let currentUrl;
		try {
			currentUrl = await validateUrl(rawTarget);
		} catch (err) {
			reply.code(403).send(`SSRF validation failed: ${err.message}`);
			return;
		}

		if (BLOCKED_DOMAINS.has(currentUrl.hostname.toLowerCase())) {
			reply.code(403).send("Blocked domain");
			return;
		}

		let redirectCount = 0;
		let upstreamRes = null;

		while (redirectCount <= MAX_REDIRECTS) {
			const refUrl = customReferer || currentUrl.href;
			const refOrigin = new URL(refUrl).origin;

			const reqHeaders = {
				"user-agent": req.headers["user-agent"] || "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/605.1.15",
				accept: req.headers.accept || "application/json, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
				"accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
				"accept-encoding": normalizeAcceptEncoding(req.headers["accept-encoding"]),
				referer: refUrl,
				origin: refOrigin,
				"sec-fetch-mode": req.headers["sec-fetch-mode"] || "cors",
				"sec-fetch-site": req.headers["sec-fetch-site"] || "same-origin",
				"sec-fetch-dest": req.headers["sec-fetch-dest"] || "empty",
			};

			if (req.headers.range) {
				reqHeaders.range = req.headers.range;
			}

			const transport = currentUrl.protocol === "https:" ? https : http;

			if (currentUrl.pathname.includes("/content/")) {
				console.log("[movie-proxy] subtitle upstream", currentUrl.href.slice(0, 120), "headers:", JSON.stringify({ accept: reqHeaders.accept, referer: reqHeaders.referer?.slice(0, 80), "accept-encoding": reqHeaders["accept-encoding"] }));
			}

			try {
				upstreamRes = await new Promise((resolve, reject) => {
					const request = transport.request(
						currentUrl.href,
						{
							method: "GET",
							headers: reqHeaders,
							rejectUnauthorized: false,
						},
						resolve
					);
					request.on("error", reject);
					request.setTimeout(15000, () => {
						request.destroy(new Error("Upstream timeout"));
					});
					request.end();
				});
			} catch (err) {
				reply.code(502).send(`Upstream request error: ${err.message}`);
				return;
			}

		const status = upstreamRes.statusCode;
		if (currentUrl.pathname.includes("/content/")) {
			console.log("[movie-proxy] subtitle response", status, currentUrl.pathname.slice(0, 60));
		}
		if (status >= 300 && status < 400 && upstreamRes.headers.location) {
				redirectCount++;
				try {
					const nextUrl = new URL(upstreamRes.headers.location, currentUrl.href);
					currentUrl = await validateUrl(nextUrl.href);
					upstreamRes.resume();
					continue;
				} catch (err) {
					reply.code(403).send(`Redirect target validation failed: ${err.message}`);
					return;
				}
			}

			break;
		}

		if (redirectCount > MAX_REDIRECTS) {
			reply.code(508).send("Too many redirects");
			return;
		}

		reply.code(upstreamRes.statusCode);

		const filterHeaders = [
			"x-frame-options",
			"content-security-policy",
			"content-security-policy-report-only",
			"cross-origin-embedder-policy",
			"cross-origin-opener-policy",
			"cross-origin-resource-policy",
			"transfer-encoding",
			"content-encoding",
			"content-disposition",
		];

		for (const [k, v] of Object.entries(upstreamRes.headers)) {
			if (!filterHeaders.includes(k.toLowerCase())) {
				reply.header(k, v);
			}
		}

		reply.header("Access-Control-Allow-Origin", "*");
		reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
		reply.header("Access-Control-Allow-Headers", "*");

		const cleanPath = currentUrl.pathname.toLowerCase();
		let forcedMime = null;
		if (cleanPath.endsWith(".css")) forcedMime = "text/css; charset=utf-8";
		else if (cleanPath.endsWith(".js") || cleanPath.endsWith(".mjs")) forcedMime = "application/javascript; charset=utf-8";
		else if (cleanPath.endsWith(".woff2")) forcedMime = "font/woff2";
		else if (cleanPath.endsWith(".woff")) forcedMime = "font/woff";
		else if (cleanPath.endsWith(".ttf")) forcedMime = "font/ttf";
		else if (cleanPath.endsWith(".svg")) forcedMime = "image/svg+xml";

		if (forcedMime) {
			reply.type(forcedMime);
			reply.raw.setHeader("Content-Type", forcedMime);
		}

		const contentType = (reply.getHeader("content-type") || upstreamRes.headers["content-type"] || "").toString().toLowerCase();
		const isM3u8 = contentType.includes("mpegurl") || contentType.includes("m3u8") || cleanPath.endsWith(".m3u8");
		const isHtml = contentType.includes("text/html");
		const isJson = contentType.includes("application/json") || contentType.includes("text/json");
		const isJs = contentType.includes("javascript") || cleanPath.endsWith(".js") || cleanPath.endsWith(".mjs");
		const isCss = contentType.includes("text/css") || cleanPath.endsWith(".css");
		// text/plain is ambiguous: many embeds mislabel m3u8 playlists or JSON
		// source payloads as text/plain. Buffer + content-sniff instead of
		// streaming raw so those get rewritten.
		const isPlain = contentType.startsWith("text/plain") && !cleanPath.match(/\.(png|jpe?g|gif|webp|avif|ico|mp4|webm|mp3|m4a|ts|aac)$/);

		console.log("[movie-proxy] classify", upstreamRes.statusCode,
			currentUrl.pathname.slice(0, 70),
			"ct=" + (upstreamRes.headers["content-type"] || "?").slice(0, 50),
			"[html:" + isHtml + " m3u8:" + isM3u8 + " json:" + isJson + " js:" + isJs + " css:" + isCss + " plain:" + isPlain + "]");

		// Fast path: clearly non-text payloads (video/audio segments, images,
		// fonts, blobs) are streamed raw without buffering so playback stays
		// smooth. text/plain is NOT fast-pathed because it may be a mislabeled
		// m3u8/JSON that needs rewriting.
		if (!isHtml && !isM3u8 && !isJson && !isJs && !isCss && !isPlain) {
			// reply.header() values are silently dropped after hijack(), so
			// write status + headers to the raw response explicitly. Without
			// this, binary went out with no content-type (browsers sniffed it
			// as text/garbage). content-encoding is preserved so gzipped
			// binary isn't served as garbage; only framing/policy headers and
			// content-disposition (force inline playback) stay stripped.
			reply.hijack();
			const passthrough = {};
			for (const [k, v] of Object.entries(upstreamRes.headers)) {
				const lk = k.toLowerCase();
				if (lk === "transfer-encoding" || lk === "connection" || lk === "keep-alive") continue;
				if (filterHeaders.includes(lk) && lk !== "content-encoding") continue;
				passthrough[k] = v;
			}
			if (forcedMime) passthrough["content-type"] = forcedMime;
			passthrough["access-control-allow-origin"] = "*";
			passthrough["access-control-allow-methods"] = "GET, HEAD, OPTIONS";
			passthrough["access-control-allow-headers"] = "*";
			reply.raw.writeHead(upstreamRes.statusCode, passthrough);
			upstreamRes.pipe(reply.raw);
			return;
		}

		// Text files (HTML, JS, CSS, JSON, M3U8) decompressed & checked
		const chunks = [];
		for await (const chunk of upstreamRes) {
			chunks.push(chunk);
		}
		const rawCompressed = Buffer.concat(chunks);
		const decompressed = decompressBuffer(rawCompressed, upstreamRes.headers["content-encoding"]);

		// Guard against binary payloads mislabeled as text — some CDNs send
		// media/segments with a text-ish or missing content-type, which would
		// otherwise fall into the rewriters below and render as garbage in the
		// browser. NUL bytes in the probe are a strong binary indicator.
		if (!isHtml && !isM3u8 && decompressed.slice(0, 512).includes(0x00)) {
			reply.hijack();
			reply.raw.setHeader("Content-Type", reply.getHeader("content-type") || upstreamRes.headers["content-type"] || "application/octet-stream");
			reply.raw.setHeader("Content-Length", decompressed.length);
			reply.raw.setHeader("Access-Control-Allow-Origin", "*");
			reply.raw.end(decompressed);
			return;
		}

		const rawBody = decompressed.toString("utf-8");

		// For text/plain responses, sniff the body to detect mislabeled m3u8 or
		// JSON source payloads so they get rewritten instead of streamed raw.
		const sniffM3u8 = isPlain && /^#EXTM3U|^#EXT-X-/.test(rawBody.trimStart());
		const trimmedStart = rawBody.trimStart();
		const sniffJson = isPlain && (trimmedStart.startsWith("{") || trimmedStart.startsWith("["));

		if (isHtml && isRealHtml(rawBody)) {
			const rewritten = rewriteHtml(rawBody, currentUrl);
			reply.type("text/html; charset=utf-8");
			reply.raw.setHeader("Content-Type", "text/html; charset=utf-8");
			reply.header("content-length", Buffer.byteLength(rewritten));
			reply.send(rewritten);
		} else if (isHtml) {
			// Upstream says text/html but content didn't match known HTML
			// patterns — still serve as HTML rather than falling through to
			// octet-stream which would trigger a browser download.
			reply.type("text/html; charset=utf-8");
			reply.raw.setHeader("Content-Type", "text/html; charset=utf-8");
			reply.header("content-length", Buffer.byteLength(rawBody));
			reply.send(rawBody);
		} else if (isM3u8 || sniffM3u8) {
			const rewritten = rewriteM3u8(rawBody, currentUrl);
			reply.type("application/vnd.apple.mpegurl");
			reply.raw.setHeader("Content-Type", "application/vnd.apple.mpegurl");
			reply.header("content-length", Buffer.byteLength(rewritten));
			reply.send(rewritten);
		} else if (isJson || sniffJson) {
			const rewritten = rewriteJson(rawBody, currentUrl);
			reply.type("application/json");
			reply.raw.setHeader("Content-Type", "application/json");
			reply.header("content-length", Buffer.byteLength(rewritten));
			reply.send(rewritten);
		} else if (isCss) {
			const rewritten = rewriteCss(rawBody, currentUrl);
			reply.type("text/css; charset=utf-8");
			reply.raw.setHeader("Content-Type", "text/css; charset=utf-8");
			reply.header("content-length", Buffer.byteLength(rewritten));
			reply.send(rewritten);
		} else if (isJs) {
			const rewritten = rewriteJsImports(rawBody, currentUrl);
			reply.type("application/javascript; charset=utf-8");
			reply.raw.setHeader("Content-Type", "application/javascript; charset=utf-8");
			reply.header("content-length", Buffer.byteLength(rewritten));
			reply.send(rewritten);
		} else {
			// Fake-named .html video segments or raw binary text
			reply.type("application/octet-stream");
			reply.raw.setHeader("Content-Type", "application/octet-stream");
			reply.send(decompressed);
		}
	});
}
