"use strict";

// Shared scramjet v2 bootstrap, used by every page that can launch the proxy
// (index.html's pre-warm, cheats.html, search.html, load.js). Centralizing
// this in one file means there's exactly one place that knows how the new
// Controller/transport wiring works, instead of four near-identical copies
// that could drift out of sync.
//
// scramjet v2 replaced v1's single "scramjet.all.js" + $scramjetLoadController()
// global with two separate IIFE bundles that must load in order:
//   /scramjet/scramjet.js     -> sets window.$scramjet (core rewriter/runtime)
//   /controller/controller.api.js -> sets window.$scramjetController, whose
//                                     module-level code reads $scramjet.defaultConfig
//                                     immediately, so it MUST load after scramjet.js
// bare-mux is gone entirely in v2 — transports (LibcurlClient/EpoxyClient) are
// constructed directly and handed to the Controller, which relays them to the
// service worker over its own RPC channel.

(function () {
  var SCRAMJET_CORE_SRC = "/scramjet/scramjet.js";
  var SCRAMJET_CONTROLLER_SRC = "/controller/controller.api.js";
  var DESKTOP_UA_CHECK =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    /Macintosh/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function loadscript(src) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(
          new Error(
            "Timed out loading " + src + ". Check your connection and retry.",
          ),
        );
      }, 15000);
      function loaded() {
        clearTimeout(timer);
        resolve();
      }
      function failed() {
        clearTimeout(timer);
        reject(new Error("Failed to load " + src));
      }
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.getAttribute("data-loaded") === "1") {
          loaded();
          return;
        }
        existing.addEventListener("load", loaded, { once: true });
        existing.addEventListener("error", failed, { once: true });
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () {
        s.setAttribute("data-loaded", "1");
        loaded();
      };
      s.onerror = failed;
      document.head.appendChild(s);
    });
  }

  var loadedpromise = null;
  function ensureloaded() {
    if (loadedpromise) return loadedpromise;

    loadedpromise = (async function () {
      // order matters — see note above.
      if (typeof $scramjet === "undefined") await loadscript(SCRAMJET_CORE_SRC);
      if (typeof $scramjet === "undefined") {
        throw new Error(
          "scramjet core failed to load ($scramjet missing after script load)",
        );
      }

      if (
        typeof $scramjetController === "undefined" ||
        typeof $scramjetController.Controller !== "function"
      ) {
        await loadscript(SCRAMJET_CONTROLLER_SRC);
      }
      if (
        typeof $scramjetController === "undefined" ||
        typeof $scramjetController.Controller !== "function"
      ) {
        throw new Error(
          "scramjet controller failed to load ($scramjetController.Controller missing after script load)",
        );
      }
    })().catch(function (err) {
      loadedpromise = null;
      throw err;
    });

    return loadedpromise;
  }

  async function createtransport(wispurl) {
    var preferred =
      Aetheris.storage.getItem("proxyTransport") ||
      (DESKTOP_UA_CHECK ? "epoxy" : "libcurl");

    var mod, TransportClass;
    if (preferred === "epoxy") {
      mod = await import("/epoxy/index.mjs");
    } else {
      mod = await import("/libcurl/index.mjs");
    }
    TransportClass = mod.default;

    var transport = new TransportClass({ wisp: wispurl });
    await transport.init();
    return transport;
  }

  async function waitforserviceworker() {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      throw new Error(
        "The proxy needs HTTPS (or localhost) and service-worker support.",
      );
    }

    var timeout;
    try {
      return await Promise.race([
        (async function () {
          if (typeof registersw === "function") {
            var registered = await registersw();
            if (!registered)
              throw new Error(
                "Service-worker registration failed. Try the recovery page.",
              );
          } else {
            await navigator.serviceWorker.register("/sw.js", {
              scope: "/",
              updateViaCache: "none",
            });
          }
          var reg = await navigator.serviceWorker.ready;
          var sw = navigator.serviceWorker.controller || reg.active;
          if (!sw) throw new Error("No active service worker is available.");
          return sw;
        })(),
        new Promise(function (_, reject) {
          timeout = setTimeout(function () {
            reject(
              new Error(
                "Proxy startup timed out. Reload or use /recover.html.",
              ),
            );
          }, 15000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Thin wrapper around Frame#go — kept as the one place call sites route
  // navigation through, in case cross-cutting logic is needed here again.
  // (Previously carried a client-side workaround for a scramjet 2.0.67-alpha.2
  // bug where History.prototype.pushState/replaceState — when called with no
  // url arg, e.g. `history.replaceState(state, title)` — coerced the missing
  // arg to the literal string "undefined" and rewrote it as if it were a real
  // relative URL. That's now patched at serve time in index.js instead, which
  // fixes it at the source for every frame instead of racing to catch and
  // correct it after the fact — see the comment above the
  // GET /scramjet/scramjet.js route in index.js.)
  function safego(frame, url) {
    return frame.go(url);
  }

  var controllerpromise = null;
  function getcontroller() {
    if (controllerpromise) return controllerpromise;

    controllerpromise = (async function () {
      await ensureloaded();
      var sw = await waitforserviceworker();

      var wispurl =
        (location.protocol === "https:" ? "wss" : "ws") +
        "://" +
        location.host +
        "/wisp/";
      var transport = await createtransport(wispurl);

      var controller = new $scramjetController.Controller({
        serviceworker: sw,
        transport: transport,
        scramjetConfig: { flags: { allowFailedIntercepts: true } },
      });

      await controller.wait();
      return controller;
    })().catch(function (err) {
      controllerpromise = null;
      throw err;
    });

    return controllerpromise;
  }

  window.aetherisProxy = {
    getController: getcontroller,
    ensureLoaded: ensureloaded,
    go: safego,
  };
})();
