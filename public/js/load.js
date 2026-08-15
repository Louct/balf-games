(function() {
  var params    = new URLSearchParams(window.location.search);
  var gameid    = params.get("game");
  var appid     = params.get("app");
  var srcsource = params.get("source");
  var srctitle  = params.get("title");

  var proxy  = null;
  var iframe = null;

  function wantsdesktopua() {
    return localStorage.getItem("spoofDesktopUA") === "true";
  }

  function syncuaspoof() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "aetheris-set-desktop-ua-spoof",
          enabled: wantsdesktopua()
        });
      }
    } catch (e) {}
  }

  function slugify(str) {
    return String(str || "")
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function finditem() {
    if (appid) {
      var apps = Array.isArray(window.apps) ? window.apps : [];
      return apps.find(function(a) { return String(a.id) === String(appid); }) || null;
    }

    var games = Array.isArray(window.games) ? window.games : [];

    if (gameid) {
      return games.find(function(g) { return String(g.id) === String(gameid); }) || null;
    }

    if (srcsource && srctitle) {
      return games.find(function(g) {
        return g.source === srcsource && slugify(g.title || g.name || "") === srctitle;
      }) || null;
    }

    return null;
  }

  function setgameinfo(item) {
    var titleel = document.getElementById("game-title");
    var descel  = document.getElementById("game-desc");
    var imgel   = document.getElementById("game-img");

    if (titleel) titleel.textContent = item.title || item.name || "";
    if (descel) descel.textContent = item.description || "";
    if (imgel) imgel.src = item.image || "/assets/images/placeholder.png";
  }

  async function startproxy() {
    if (proxy) return;

    if (!window.aetherisProxy) {
      await new Promise(function(resolve, reject) {
        var waited = 0;
        var t = setInterval(function() {
          waited += 100;
          if (window.aetherisProxy) { clearInterval(t); resolve(); }
          else if (waited >= 10000) { clearInterval(t); reject(new Error("Scramjet failed to load")); }
        }, 100);
      });
    }

    proxy = await window.aetherisProxy.getController();
    syncuaspoof();
  }

  async function loaditem(item) {
    var container = document.getElementById("game-frame");
    var url = item.url || item.html;

    if (!container) { console.error("no #game-frame found"); return; }
    if (!url)       { console.error("item has no url:", item); return; }

    setgameinfo(item);

    if (!appid) {
      var deviceid = localStorage.getItem("dmDeviceId") || "";
      fetch("/api/plays/" + encodeURIComponent(item.id), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ deviceId: deviceid })
      }).catch(function() {});
    }

    setupfavoritebutton(item);
    container.innerHTML = "";

    var isexternal = /^https?:\/\//i.test(url);

    if (isexternal && !item.noProxy) {
      await startproxy();
      var frameel = document.createElement("iframe");
      frameel.style.cssText = "width:100%;height:100%;border:0;";
      iframe = proxy.createFrame(frameel);
      container.appendChild(frameel);
      window.aetherisProxy.go(iframe, url);
    } else {
      var frame = document.createElement("iframe");
      frame.allowFullscreen = true;
      frame.referrerPolicy = "no-referrer";
      frame.style.cssText = "width:100%;height:100%;border:0;";
      frame.allow = "autoplay; fullscreen";
      frame.setAttribute("sandbox",
        "allow-scripts allow-same-origin allow-forms allow-popups " +
        "allow-pointer-lock allow-downloads allow-modals allow-orientation-lock " +
        "allow-presentation allow-storage-access-by-user-activation");

      container.appendChild(frame);
      syncuaspoof();

      if (wantsdesktopua()) {
        try {
          var nav = frame.contentWindow.navigator;
          var DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
          Object.defineProperty(nav, "userAgent",      { get: function() { return DESKTOP_UA; }, configurable: true });
          Object.defineProperty(nav, "platform",       { get: function() { return "Win32"; },    configurable: true });
          Object.defineProperty(nav, "maxTouchPoints", { get: function() { return 0; },          configurable: true });
        } catch (e) {}
      }

      frame.src = url;
    }
  }

  function setupfavoritebutton(item) {
    var starbtn = document.querySelector("#fav-btn");
    if (!starbtn) return;

    var storagekey = appid ? "favoritedApps" : "favoritedGames";
    var itemid = item.id;

  function refreshstar() {
    var saved = JSON.parse(localStorage.getItem(storagekey) || "[]");
    starbtn.textContent = isfavorited(saved, item) ? "★" : "☆";
  }

  function isfavorited(saved, it) {
    if (saved.indexOf(it.id) !== -1) return true;
    // favorites saved before id deduping may hold the raw shared id
    return !!it.rawid && saved.indexOf(it.rawid) !== -1;
  }

    starbtn.onclick = function() {
      var favs = JSON.parse(localStorage.getItem(storagekey) || "[]");
      var idx = favs.indexOf(itemid);

      if (idx === -1) {
        favs.push(itemid);
      } else {
        favs.splice(idx, 1);
      }

      localStorage.setItem(storagekey, JSON.stringify(favs));
      refreshstar();
    };

    refreshstar();
  }

  function tryload() {
    var item = finditem();
    if (!item) return false;
    loaditem(item).catch(console.error);
    return true;
  }

  async function boot() {
    var pending = [];
    if (window.gamesready && typeof window.gamesready.then === "function") pending.push(window.gamesready);
    if (window.appsready && typeof window.appsready.then === "function")  pending.push(window.appsready);

    if (pending.length) {
      try { await Promise.allSettled(pending); } catch (e) {}
      if (tryload()) return;
    }

    window.addEventListener("gamesloaded", tryload, { once: true });
    window.addEventListener("appsloaded",  tryload, { once: true });

    var ticks = 0;
    var poll = setInterval(function() {
      ticks++;
      if (tryload() || ticks > 100) clearInterval(poll);
    }, 100);
  }

  boot();
})();
