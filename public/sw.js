var MIGRATION_VERSION = 2;

async function migrateifneeded() {
  var needed = true;
  try {
    var meta = await caches.open("__sw_meta__");
    var resp = await meta.match("/migration-version");
    if (resp) {
      var v = parseInt(await resp.text(), 10);
      if (v >= MIGRATION_VERSION) needed = false;
    }
  } catch (e) {}

  if (!needed) return;

  console.log("[SW] running one-time DB migration v" + MIGRATION_VERSION);

  await new Promise(function(resolve) {
    var req = indexedDB.deleteDatabase("scramjet-config");
    req.onsuccess = function() { console.log("[SW] scramjet-config deleted"); resolve(); };
    req.onerror   = function() { console.warn("[SW] scramjet-config delete error"); resolve(); };
    req.onblocked = function() { console.warn("[SW] scramjet-config blocked — will retry next install"); resolve(); };
    setTimeout(resolve, 3000);
  });

  try {
    var meta2 = await caches.open("__sw_meta__");
    await meta2.put("/migration-version", new Response(String(MIGRATION_VERSION)));
  } catch (e) {}
}

var scramjetloaded = false;
var proxy = null;
var configready = null;
var configfailed = false;
var spoofdesktopua = false;

var desktopua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

var desktopuashim = '<script>' +
'(function(){' +
'  if (window.__aetherisDesktopUASpoofInstalled) return;' +
'  window.__aetherisDesktopUASpoofInstalled = true;' +
'  var pcua = ' + JSON.stringify(desktopua) + ';' +
'  function def(obj, key, value) {' +
'    try { Object.defineProperty(obj, key, { get: function(){ return value; }, configurable: true }); } catch(e) {}' +
'  }' +
'  def(Navigator.prototype, "userAgent", pcua);' +
'  def(Navigator.prototype, "platform", "Win32");' +
'  def(Navigator.prototype, "maxTouchPoints", 0);' +
'  def(Navigator.prototype, "vendor", "Google Inc.");' +
'  try {' +
'    Object.defineProperty(Navigator.prototype, "userAgentData", {' +
'      get: function(){' +
'        return {' +
'          brands: [' +
'            { brand: "Chromium", version: "120" },' +
'            { brand: "Google Chrome", version: "120" },' +
'            { brand: "Not=A?Brand", version: "99" }' +
'          ],' +
'          mobile: false,' +
'          platform: "Windows",' +
'          getHighEntropyValues: function(hints) {' +
'            var values = {' +
'              brands: this.brands,' +
'              mobile: false,' +
'              platform: "Windows",' +
'              architecture: "x86",' +
'              bitness: "64",' +
'              model: "",' +
'              platformVersion: "10.0.0",' +
'              uaFullVersion: "120.0.0.0",' +
'              fullVersionList: this.brands' +
'            };' +
'            var out = {};' +
'            (hints || []).forEach(function(k){ if (k in values) out[k] = values[k]; });' +
'            return Promise.resolve(out);' +
'          }' +
'        };' +
'      },' +
'      configurable: true' +
'    });' +
'  } catch(e) {}' +
'})();' +
'<\/script>';

try {
  importScripts("/scram/scramjet.all.js");
  var scram = $scramjetLoadWorker();
  var ScramjetServiceWorker = scram.ScramjetServiceWorker;
  proxy = new ScramjetServiceWorker();

  proxy.addEventListener("request", function(event) {
    if (!spoofdesktopua || !event || !event.requestHeaders) return;
    event.requestHeaders["User-Agent"] = desktopua;
    event.requestHeaders["Sec-CH-UA-Mobile"] = "?0";
    event.requestHeaders["Sec-CH-UA-Platform"] = '"Windows"';
  });

  var configtimeout = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error("loadConfig timed out after 5s")); }, 5000);
  });

  configready = Promise.race([proxy.loadConfig(), configtimeout]).catch(async function(err) {
    console.error("[SW] loadConfig failed:", err);
    configfailed = true;

    try {
      var cache = await caches.open("__sw_meta__");
      await cache.put("/migration-version", new Response("0"));
    } catch (e) {}

    try { await self.registration.unregister(); } catch (e) {}

    throw err;
  });

  scramjetloaded = true;
} catch (err) {
  console.error("[SW] Scramjet failed to load:", err);
  configfailed = true;
}

var recoveryhtml = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'<meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width, initial-scale=1">' +
'<title>Fixing connection…</title>' +
'<style>' +
'*{box-sizing:border-box;margin:0;padding:0}' +
'body{min-height:100vh;display:flex;align-items:center;justify-content:center;' +
'  background:#0e0010;font-family:system-ui,sans-serif;color:#e2d6f5}' +
'.card{text-align:center;padding:2.5rem 2rem;max-width:360px}' +
'.spinner{width:48px;height:48px;border:3px solid rgba(180,120,255,.2);' +
'  border-top-color:#b478ff;border-radius:50%;animation:spin .8s linear infinite;' +
'  margin:0 auto 1.5rem}' +
'@keyframes spin{to{transform:rotate(360deg)}}' +
'h1{font-size:1.1rem;font-weight:600;margin-bottom:.5rem;color:#f0eaff}' +
'p{font-size:.875rem;color:#a090c0;line-height:1.5}' +
'</style>' +
'</head>' +
'<body>' +
'<div class="card">' +
'  <div class="spinner"></div>' +
'  <h1>fixing stuff...</h1>' +
'  <p>clearing your cache, won\'t take long.</p>' +
'</div>' +
'<script>' +
'(function(){' +
'  if(!navigator.serviceWorker){window.location.replace("/");return}' +
'  var dbNames = [];' +
'  try { dbNames = JSON.parse(localStorage.getItem("idbNames") || "[]"); } catch(_) {}' +
'  if (dbNames.indexOf("scramjet-config") === -1) dbNames.push("scramjet-config");' +
'  navigator.serviceWorker.getRegistrations()' +
'    .then(function(regs){return Promise.all(regs.map(function(r){return r.unregister()}))})' +
'    .then(function(){return caches.keys()})' +
'    .then(function(keys){return Promise.all(keys.map(function(k){return caches.delete(k)}))})' +
'    .then(function(){' +
'       return Promise.all(dbNames.map(function(name){' +
'         return new Promise(function(resolve){' +
'           var req = indexedDB.deleteDatabase(name);' +
'           req.onsuccess = req.onerror = req.onblocked = function(){ resolve(); };' +
'           setTimeout(resolve, 2000);' +
'         });' +
'       }));' +
'    })' +
'    .then(function(){' +
'       try { localStorage.removeItem("idbNames"); } catch(_) {}' +
'       setTimeout(function(){ window.location.replace("/"); }, 500);' +
'    })' +
'    .catch(function(e){' +
'       document.querySelector("h1").textContent="something went wrong";' +
'       document.querySelector("p").textContent="try clearing your browser data manually.";' +
'    });' +
'})();' +
'<\/script>' +
'</body>' +
'</html>';

var audiounlockshim = '<script>' +
'(function(){' +
'  if (window.__aetherisAudioUnlockInstalled) return;' +
'  window.__aetherisAudioUnlockInstalled = true;' +
'  var issafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);' +
'  var contexts = new Set();' +
'  var unlocked = false;' +
'  function dbg(){' +
'    if (console && console.log) {' +
'      var args = ["[audio-dbg]"].concat(Array.prototype.slice.call(arguments));' +
'      console.log.apply(console, args);' +
'    }' +
'  }' +
'  function silentping(ctx){' +
'    try {' +
'      var buf = ctx.createBuffer(1, 1, 22050);' +
'      var src = ctx.createBufferSource();' +
'      src.buffer = buf; src.connect(ctx.destination);' +
'      if (typeof src.start === "function") src.start(0);' +
'      else if (typeof src.noteOn === "function") src.noteOn(0);' +
'    } catch(e){}' +
'  }' +
'  function tryresume(ctx){' +
'    if (!ctx || typeof ctx.resume !== "function") return;' +
'    if (ctx.state === "suspended" || ctx.state === "interrupted") {' +
'      silentping(ctx);' +
'      try {' +
'        ctx.resume().then(function(){ dbg("resume() resolved, new state:", ctx.state); })' +
'          .catch(function(e){ dbg("resume() rejected:", e && e.message); });' +
'      } catch(e){ dbg("resume() threw:", e && e.message); }' +
'    }' +
'  }' +
'  function watchcontext(ctx){' +
'    if (!ctx || ctx.__aetherisWatched) return;' +
'    ctx.__aetherisWatched = true; contexts.add(ctx);' +
'    try { ctx.addEventListener("statechange", function(){' +
'      dbg("watched context statechange ->", ctx.state);' +
'      if (unlocked && (ctx.state === "suspended" || ctx.state === "interrupted")) tryresume(ctx);' +
'    }); } catch(e){}' +
'  }' +
'  function scanunitycontexts(){' +
'    try {' +
'      var canvases = document.querySelectorAll("canvas");' +
'      for (var i=0;i<canvases.length;i++){' +
'        var c = canvases[i];' +
'        var u = c.unityInstance || window.unityInstance || window.myGameInstance || window.gameInstance;' +
'        var ctx = u && u.Module && u.Module.WEBAudio && u.Module.WEBAudio.audioContext;' +
'        if (ctx) { dbg("found Unity WEBAudio context, state:", ctx.state); watchcontext(ctx); if (unlocked) tryresume(ctx); }' +
'      }' +
'    } catch(e){}' +
'  }' +
'  function unlockall(){' +
'    if (!unlocked) { dbg("first unlock gesture fired (Safari:", issafari, ")"); startpolling(); }' +
'    unlocked = true; contexts.forEach(tryresume); scanunitycontexts();' +
'  }' +
'  var _polltimer = null;' +
'  function startpolling(){' +
'    if (_polltimer) return;' +
'    _polltimer = setInterval(function(){' +
'      if (document.hidden) return;' +
'      contexts.forEach(function(ctx){' +
'        if (ctx.state === "suspended" || ctx.state === "interrupted") { dbg("poll: resuming context, state:", ctx.state); tryresume(ctx); }' +
'      }); scanunitycontexts();' +
'    }, 2000);' +
'  }' +
'  document.addEventListener("visibilitychange", function(){' +
'    if (document.visibilityState === "visible" && unlocked) { dbg("visibilitychange -> visible, re-resuming contexts"); unlockall(); }' +
'  });' +
'  var native = window.AudioContext || window.webkitAudioContext;' +
'  if (native) {' +
'    dbg("patching AudioContext constructor (Safari:", issafari, ")");' +
'    var wrapped = function(){' +
'      var ctx = arguments.length ? new native(arguments[0]) : new native();' +
'      dbg("AudioContext created, initial state:", ctx.state, "sampleRate:", ctx.sampleRate);' +
'      watchcontext(ctx); tryresume(ctx); return ctx;' +
'    };' +
'    wrapped.prototype = native.prototype;' +
'    try { window.AudioContext = wrapped; } catch(e){}' +
'    try { window.webkitAudioContext = wrapped; } catch(e){}' +
'  } else { dbg("no AudioContext available on this page"); }' +
'  var events = ["touchstart","touchend","mousedown","click","keydown","pointerdown","gesturestart"];' +
'  events.forEach(function(evt){ document.addEventListener(evt, unlockall, { capture: true, passive: true }); });' +
'  window.addEventListener("message", function(e){ if (e && e.data && e.data.type === "aetheris-unlock-audio") unlockall(); });' +
'  function patchchildiframe(el){' +
'    if (!el || el.tagName !== "IFRAME") return;' +
'    try {' +
'      var cur = el.getAttribute("allow") || "";' +
'      if (cur.indexOf("autoplay") === -1) {' +
'        el.setAttribute("allow", cur ? cur + "; autoplay" : "autoplay; fullscreen");' +
'        dbg("patched child iframe allow:", el.src || el.getAttribute("src"));' +
'      }' +
'    } catch(e){}' +
'  }' +
'  function patchchildiframes(){ try { var iframes = document.querySelectorAll("iframe"); for (var i = 0; i < iframes.length; i++) patchchildiframe(iframes[i]); } catch(e){} }' +
'  patchchildiframes();' +
'  try {' +
'    var mo = new MutationObserver(function(mutations){' +
'      for (var i = 0; i < mutations.length; i++){' +
'        var added = mutations[i].addedNodes;' +
'        for (var j = 0; j < added.length; j++){' +
'          var n = added[j];' +
'          if (n && n.tagName === "IFRAME") patchchildiframe(n);' +
'          else if (n && n.querySelectorAll) { var nested = n.querySelectorAll("iframe"); for (var k = 0; k < nested.length; k++) patchchildiframe(nested[k]); }' +
'        }' +
'      }' +
'    });' +
'    mo.observe(document.documentElement, { childList: true, subtree: true });' +
'  } catch(e){}' +
'  window.__audiodbg = { getcontexts: function(){ return Array.from(contexts); }, forceunlock: unlockall, get unlocked(){ return unlocked; } };' +
'})();' +
'<\/script>';

// Ad spoof shim — loaded from /js/ad-spoof.js (same-origin, no async/defer so it
// executes synchronously before any game scripts; absolute path bypasses <base href>)
var adspoofshim = '<script src="/js/ad-spoof.js"><\/script>';

async function injecthtmlshims(response, options) {
  if (!options) options = {};
  try {
    if (!response || !(response instanceof Response)) return response;
    if (response.status !== 200) return response;
    if (response.type === "opaque" || response.type === "opaqueredirect") return response;
    var ct = (response.headers.get("content-type") || "").toLowerCase();
    if (ct.indexOf("text/html") === -1) return response;
    var text = await response.text();
    var shims = (options.desktopua ? desktopuashim : "") + audiounlockshim + adspoofshim;
    var injected = (/<head[^>]*>/i.test(text))
      ? text.replace(/<head[^>]*>/i, function(m) { return m + shims; })
      : shims + text;
    var newheaders = new Headers(response.headers);
    newheaders.delete("content-length");
    newheaders.set("Permissions-Policy", "autoplay=*, fullscreen=*");
    return new Response(injected, { status: response.status, statusText: response.statusText, headers: newheaders });
  } catch (err) { return response; }
}

var fetcherrors = new Map();
function logfetchfail(req, err) {
  var now = Date.now();
  if (now - (fetcherrors.get(req.url) || 0) < 5000) return;
  fetcherrors.set(req.url, now);
  console.error("[SW] fetch failed:", (err && err.message) || err, "\n url:", req.url);
}

function shouldbypass(url) {
  if (
    url.indexOf("data:") === 0 ||
    url.indexOf("chrome-extension:") === 0 ||
    url.indexOf("blob:") === 0 ||
    url.indexOf("ws:") === 0
  ) return true;

  if (
    url.indexOf("/api-proxy/") !== -1 ||
    url.indexOf("/proxy/") !== -1 ||
    url.indexOf(".unityweb") !== -1 ||
    url.indexOf(".wasm") !== -1 ||
    url.indexOf("jsdelivr.net") !== -1 ||
    url.indexOf("aetheris.win/assets/") !== -1 ||
    url.indexOf("aetheris.win/scram/") !== -1 ||
    url.indexOf("aetheris.win/api/") !== -1 ||
    url.indexOf("aetheris.win/js/") !== -1 ||
    url.indexOf("aetheris.win/css/") !== -1
  ) return true;

  try {
    var parsed = new URL(url);
    if (parsed.hostname === "aetheris.win" && /\.html$/.test(parsed.pathname)) return true;
  } catch (e) {};

  try { if (/\/online(-count)?$/.test(new URL(url).pathname)) return true; }
  catch (e) {}

  return false;
}

self.addEventListener("fetch", function(event) {
  var url = event.request.url;

  if (url.indexOf("/recover") !== -1) {
    event.respondWith(new Response(recoveryhtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }));
    return;
  }

  if (url.indexOf("api.1games.io") !== -1) {
    var rewritten = url.replace("https://api.1games.io/", "https://aetheris.win/api-proxy/");
    event.respondWith(
      event.request.text().then(function(body) {
        return fetch(rewritten, {
          method: event.request.method,
          headers: event.request.headers,
          body: event.request.method !== "GET" ? body : undefined
        });
      })
    );
    return;
  }

  var parsed = null;
  try { parsed = new URL(url); } catch (e) {}

  if (
    parsed &&
    parsed.origin === self.location.origin &&
    parsed.pathname.indexOf("/assets/games/") === 0 &&
    /\.html$/i.test(parsed.pathname)
  ) {
    event.respondWith(
      fetch(event.request)
        .then(function(r) { return injecthtmlshims(r, { desktopua: spoofdesktopua }); })
        .catch(function() { return fetch(event.request); })
    );
    return;
  }

  if (url.indexOf("disable-devtool") !== -1) {
    event.respondWith(new Response("", { headers: { "Content-Type": "application/javascript" } }));
    return;
  }

  if (shouldbypass(url)) return;

  if (!scramjetloaded || !configready || configfailed) {
    event.respondWith(
      fetch(event.request).catch(function() {
        if (event.request.mode === "navigate") return Response.redirect("/recover", 302);
        return new Response("", { status: 503, statusText: "SW unavailable" });
      })
    );
    return;
  }

  event.respondWith(
    configready.then(function() {
      var routed = false;
      try { routed = proxy.route(event); }
      catch (e) { return fetch(event.request); }

      if (routed) {
        return proxy.fetch(event).then(function(r) { return injecthtmlshims(r, { desktopua: spoofdesktopua }); });
      }
      return fetch(event.request);
    }).catch(function(err) {
      logfetchfail(event.request, err);
      if (event.request.mode === "navigate") return Response.redirect("/recover", 302);
      return fetch(event.request).catch(function() {
        return new Response("", { status: 503, statusText: "SW unavailable" });
      });
    })
  );
});

self.addEventListener("install", function(event) {
  event.waitUntil(
    migrateifneeded().then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event) { event.waitUntil(self.clients.claim()); });

self.addEventListener("message", function(event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "aetheris-set-desktop-ua-spoof") {
    spoofdesktopua = event.data.enabled === true;
  }
});
