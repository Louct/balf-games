(function () {
  var path = location.pathname;
  var isindex =
    path === "/" ||
    path === "" ||
    path.substring(path.length - 11) === "/index.html" ||
    path.substring(path.length - 6) === "/index";
  if (window.self === window.top && !isindex) {
    var route = Aetheris.routeForUrl(location.href);
    if (route) location.replace("/index.html#" + route.route);
  }
})();

(function () {
  try {
    var hasflag =
      location.search.indexOf("fps") !== -1 ||
      (window.parent !== window &&
        window.parent.location.search.indexOf("fps") !== -1);
    if (!hasflag) return;
  } catch (e) {
    if (location.search.indexOf("fps") === -1) return;
  }

  var el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:100000;" +
    "background:rgba(0,0,0,0.75);color:#4ade80;font:700 13px/1.2 monospace;" +
    "padding:4px 8px;border-radius:6px;pointer-events:none;user-select:none;";
  el.textContent = "-- fps";

  var mount = function () {
    (document.body || document.documentElement).appendChild(el);
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });

  var frames = 0;
  var last = performance.now();

  function tick(now) {
    frames++;
    if (now - last >= 500) {
      var fps = Math.round((frames * 1000) / (now - last));
      el.textContent = fps + " fps";
      el.style.color =
        fps >= 50 ? "#4ade80" : fps >= 30 ? "#facc15" : "#ef4444";
      frames = 0;
      last = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

(function () {
  if (!window.indexedDB) return;
  var nativeopen = indexedDB.open.bind(indexedDB);
  indexedDB.open = function (name, version) {
    if (name) {
      try {
        var known = JSON.parse(Aetheris.storage.getItem("idbNames") || "[]");
        if (known.indexOf(name) === -1) {
          known.push(name);
          Aetheris.storage.setItem("idbNames", JSON.stringify(known));
        }
      } catch (e) {}
    }
    return nativeopen(name, version);
  };
})();

(function () {
  var optedIn = Aetheris.storage.getItem("performanceMode") === "true";
  var lowmem = navigator.deviceMemory && navigator.deviceMemory <= 2;
  if (optedIn || lowmem) {
    document.documentElement.classList.add("low-power-mode", "power-saving");
  }
})();

(function () {
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin) return;
    if (e.data && e.data.type === "online-count") {
      var el = document.getElementById("online-count");
      var n = parseInt(e.data.count, 10);
      if (el && !isNaN(n)) el.textContent = n;
    }
  });
})();

// keep the SW's in-memory ua-spoof flag in sync — the browser can recycle the
// SW at any time, resetting its memory; settings.js and load.js also push this
// but only from their own pages. cheap enough to do from every page load.
(function () {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "aetheris-set-desktop-ua-spoof",
        enabled: Aetheris.storage.getItem("spoofDesktopUA") === "true",
      });
    }
  } catch (_) {}
})();

// panic key (app pages — game/proxied pages get the same listener injected by
// the service worker's shims, see sw.js)
(function () {
  document.addEventListener(
    "keydown",
    function (e) {
      try {
        if (window.aetherisDetectingPanic) return;
        var key = Aetheris.storage.getItem("panickey");
        if (!key || e.key !== key) return;
        // single-char panic keys don't fire while typing in a text field —
        // they'd trigger on every keystroke otherwise
        var t = e.target;
        if (
          e.key.length === 1 &&
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable)
        )
          return;
        if (t && (t.id === "panickey" || t.id === "panicurl")) return;
        e.preventDefault();
        Aetheris.quickExit();
      } catch (_) {}
    },
    true,
  );
})();
