"use strict";

var SW_PATH = "./sw.js";
var UPDATE_POLL = 30 * 60 * 1000;

async function registersw() {
  if (!navigator.serviceWorker) return;

  try {
    var reg = await navigator.serviceWorker.register(SW_PATH, {
      scope: "/",
      updateViaCache: "none"
    });

    reg.addEventListener("updatefound", function() {
      var worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", function() {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    var reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function() {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });

    function check() { reg.update().catch(function() {}); }
    setInterval(check, UPDATE_POLL);
    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState === "visible") check();
    });

  } catch (err) {
    console.error("sw registration failed:", err);
  }
}

registersw();
