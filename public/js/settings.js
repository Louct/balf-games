document.addEventListener("DOMContentLoaded", function () {

  // --- tab cloak ---

  var TAB_PRESETS = {
    google:       { name: "Google", icon: "https://www.google.com/favicon.ico" },
    drive:        { name: "My Drive - Google Drive", icon: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png" },
    docs:         { name: "Google Docs", icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico" },
    classroom:    { name: "Home", icon: "https://ssl.gstatic.com/classroom/ic_product_classroom_32.png" },
    examrevision: { name: "Exam Revision", icon: "https://examrevision.ie/favicon.ico" },
    default:      { name: "Aetheris", icon: "/assets/images/icon.png" },
  };

  function changetab(name, icon) {
    var nameinput = document.querySelector("#tabname");
    var iconinput = document.querySelector("#tabicon");

    name = (name !== undefined) ? name : nameinput.value;
    icon = (icon !== undefined) ? icon : iconinput.value;

    localStorage.setItem("tabName", name);
    localStorage.setItem("tabIcon", icon);

    document.title = name;
    var favicon = document.querySelector("link[rel='shortcut icon']") || document.querySelector("link[rel='icon']");
    if (favicon) favicon.href = icon;

    if (nameinput) nameinput.value = name;
    if (iconinput) iconinput.value = icon;

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "set-tab", name: name, icon: icon }, location.origin);
    }
  }

  window.settab = changetab;

  window.settabpreset = function (key) {
    var preset = TAB_PRESETS[key];
    changetab(preset.name, preset.icon);
  };

  if (localStorage.getItem("tabName")) document.querySelector("#tabname").value = localStorage.getItem("tabName");
  if (localStorage.getItem("tabIcon")) document.querySelector("#tabicon").value = localStorage.getItem("tabIcon");

  // --- theme selector ---

  var themeselect = document.getElementById("theme-select");
  if (themeselect) {
    var saved = localStorage.getItem("aetheris-theme");
    if (saved) themeselect.value = saved;

    themeselect.addEventListener("change", function () {
      var theme = themeselect.value;
      document.documentElement.setAttribute("theme", theme);
      if (document.body) document.body.setAttribute("theme", theme);
      localStorage.setItem("aetheris-theme", theme);

      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "theme-changed", theme: theme }, location.origin);
      }
    });
  }

  // --- panic key ---

  if (localStorage.getItem("panickey")) document.querySelector("#panickey").value = localStorage.getItem("panickey");
  if (localStorage.getItem("panicurl")) document.querySelector("#panicurl").value = localStorage.getItem("panicurl");

  window.setpanickey = function () {
    localStorage.setItem("panickey", document.querySelector("#panickey").value);
  };

  window.setpanicurl = function () {
    localStorage.setItem("panicurl", document.querySelector("#panicurl").value);
  };

  var waitingforkey = false;

  window.detectpanic = function () {
    var input = document.querySelector("#panickey");
    var btn = document.querySelector("#panickeybtn");

    if (waitingforkey) return;
    waitingforkey = true;
    btn.disabled = true;
    btn.innerHTML = "Press any key...";

    function onkey(e) {
      input.value = e.key;
      localStorage.setItem("panickey", e.key);
      btn.innerHTML = "Auto-detect panic key";
      btn.disabled = false;
      waitingforkey = false;
      document.removeEventListener("keydown", onkey);
    }

    document.addEventListener("keydown", onkey);
  };

  // --- transport selector ---
  // libcurl is faster but doesn't work on Apple devices
  var ua = navigator.userAgent;
  var isapple = /iP(hone|ad|od)/.test(ua) ||
    /Macintosh/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var activetransport = localStorage.getItem("proxyTransport") || (isapple ? "epoxy" : "libcurl");

  function highlighttransport(name) {
    document.querySelectorAll("#transport-cards .theme-card").forEach(function (c) {
      c.classList.toggle("active", c.dataset.transport === name);
    });
  }

  highlighttransport(activetransport);

  window.selecttransport = function (name) {
    activetransport = name;
    localStorage.setItem("proxyTransport", name);
    highlighttransport(name);

    var status = document.getElementById("transport-status");
    // scramjet v2 constructs a fresh transport per proxy launch (see
    // scramjet-init.js) instead of pushing it into a long-lived bare-mux
    // worker, so there's nothing to eagerly switch here — the localStorage
    // pref just gets picked up the next time a proxy page starts.
    if (status) status.textContent = "saved. takes effect on next proxy use.";
  };

  // --- desktop UA spoof toggle ---

  var spooftoggle = document.getElementById("spoof-ua-toggle");
  if (spooftoggle) {
    function pushspoofstate() {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "aetheris-set-desktop-ua-spoof",
            enabled: localStorage.getItem("spoofDesktopUA") === "true",
          });
        }
      } catch (_) {}
    }

    spooftoggle.checked = localStorage.getItem("spoofDesktopUA") === "true";
    pushspoofstate();

    spooftoggle.addEventListener("change", function () {
      localStorage.setItem("spoofDesktopUA", String(spooftoggle.checked));
      pushspoofstate();
    });
  }

  // --- custom background ---

  (function () {
    var previewwrap = document.getElementById("bg-preview-wrap");
    var preview = document.getElementById("bg-preview");
    var removebtn = document.getElementById("bg-remove-btn");
    var bgstatus = document.getElementById("bg-status");

    function refreshpreview(url) {
      if (url) {
        if (preview) preview.src = url;
        if (previewwrap) previewwrap.style.display = "block";
        if (removebtn) removebtn.style.display = "";
      } else {
        if (previewwrap) previewwrap.style.display = "none";
        if (removebtn) removebtn.style.display = "none";
      }
    }

    function ensureoverlay() {
      var el = document.getElementById("custom-bg-overlay");
      if (el) return el;
      el = document.createElement("div");
      el.id = "custom-bg-overlay";
      el.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;background-size:cover;background-position:center;background-repeat:no-repeat;";
      document.body.insertBefore(el, document.body.firstChild);
      return el;
    }

    function clearinlinebg() {
      document.body.style.backgroundSize = "";
      document.body.style.backgroundPosition = "";
      document.body.style.backgroundRepeat = "";
      document.body.style.backgroundAttachment = "";
    }

    refreshpreview(localStorage.getItem("aetheris-customBg"));

    window.uploadbg = function (event) {
      var file = event.target.files[0];
      if (!file) return;
      event.target.value = "";
      if (bgstatus) bgstatus.textContent = "Reading...";

      var reader = new FileReader();
      reader.onload = function (e) {
        var dataurl = e.target.result;
        try {
          localStorage.setItem("aetheris-customBg", dataurl);
        } catch (_) {
          if (bgstatus) bgstatus.textContent = "Image too large for localStorage. Try something smaller.";
          return;
        }
        document.documentElement.classList.add("has-custom-bg");
        document.body.classList.add("has-custom-bg");
        document.body.style.setProperty("background-image", "none", "important");
        clearinlinebg();
        ensureoverlay().style.backgroundImage = "url(" + dataurl + ")";
        refreshpreview(dataurl);
        if (bgstatus) bgstatus.textContent = "Background saved.";
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "bg-changed", dataurl: dataurl }, location.origin);
        }
      };
      reader.onerror = function () {
        if (bgstatus) bgstatus.textContent = "Failed to read image.";
      };
      reader.readAsDataURL(file);
    };

    var themebgs = {
      "dark":          { bg: "linear-gradient(135deg, #0f0f0f 0%, #161616 40%, #0a0a0a 100%)", bgc: "#0f0f0f" },
      "charcoal-gold": { bg: "linear-gradient(135deg, #0f0f0f 0%, #161616 40%, #0a0a0a 100%)", bgc: "#0f0f0f" },
      "dark-blue":     { bg: "linear-gradient(#020617, #000)", bgc: "#020617" },
    };

    window.removebg = function () {
      localStorage.removeItem("aetheris-customBg");
      document.documentElement.classList.remove("has-custom-bg");
      document.body.classList.remove("has-custom-bg");
      var overlay = document.getElementById("custom-bg-overlay");
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);

      var t = themebgs[localStorage.getItem("aetheris-theme") || "dark"] || {};
      document.body.style.setProperty("background-image", t.bg || "", "important");
      document.body.style.setProperty("background-color", t.bgc || "#0f0f0f", "important");
      clearinlinebg();
      refreshpreview(null);
      if (bgstatus) bgstatus.textContent = "Background removed.";
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "bg-changed", dataurl: null }, location.origin);
      }
    };
  })();

  // --- misc toggles ---

  var osktoggle = document.getElementById("osk-toggle");
  if (osktoggle) {
    osktoggle.checked = localStorage.getItem("oskEnabled") === "true";
    osktoggle.addEventListener("change", function () {
      localStorage.setItem("oskEnabled", String(osktoggle.checked));
    });
  }

  var perftoggle = document.getElementById("performance-toggle");
  if (perftoggle) {
    perftoggle.checked = localStorage.getItem("performanceMode") === "true";
    perftoggle.addEventListener("change", function () {
      localStorage.setItem("performanceMode", String(perftoggle.checked));
      location.reload();
    });
  }

  // --- data export / import ---

  function showmsg(msg, isErr) {
    var el = document.getElementById("data-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isErr ? "#e05555" : "";
  }

  function snapshotls() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }
    return data;
  }

  // opens a database and checks whether it has any object stores
  function dbexists(name) {
    return new Promise(function (resolve) {
      var done = false;

      var timer = setTimeout(function () {
        if (!done) { done = true; resolve(false); }
      }, 1500);

      try {
        var req = indexedDB.open(name);

        req.onerror = function () {
          if (!done) { done = true; clearTimeout(timer); resolve(false); }
        };

        req.onsuccess = function (e) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          var db = e.target.result;
          var has = db.objectStoreNames.length > 0;
          db.close();
          resolve(has);
        };

        // if upgradeneeded fires, the db didn't exist — clean it up
        req.onupgradeneeded = function (e) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          e.target.result.close();
          indexedDB.deleteDatabase(name);
          resolve(false);
        };
      } catch (_) {
        if (!done) { done = true; clearTimeout(timer); resolve(false); }
      }
    });
  }

  // blobs and arraybuffers need to be base64-encoded to survive JSON round-tripping
  function buf2b64(buffer) {
    var bytes = new Uint8Array(buffer);
    var BLK = 0x8000;
    var bin = "";
    for (var i = 0; i < bytes.length; i += BLK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + BLK));
    }
    return btoa(bin);
  }

  function b642buf(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function encodevalue(val) {
    if (val === null || val === undefined) return val;

    if (val instanceof Blob) {
      return { __aetheris_type: "Blob", mime: val.type, data: buf2b64(await val.arrayBuffer()) };
    }
    if (val instanceof ArrayBuffer) {
      return { __aetheris_type: "ArrayBuffer", data: buf2b64(val) };
    }
    if (ArrayBuffer.isView(val)) {
      return {
        __aetheris_type: "TypedArray",
        ctor: val.constructor.name,
        data: buf2b64(val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength)),
      };
    }
    if (Array.isArray(val)) {
      var out = new Array(val.length);
      for (var i = 0; i < val.length; i++) out[i] = await encodevalue(val[i]);
      return out;
    }
    if (typeof val === "object" && val.constructor === Object) {
      var obj = {};
      var ek = Object.keys(val);
      for (var ei = 0; ei < ek.length; ei++) obj[ek[ei]] = await encodevalue(val[ek[ei]]);
      return obj;
    }
    return val;
  }

  function decodevalue(val) {
    if (val === null || val === undefined || typeof val !== "object") return val;

    if (val.__aetheris_type === "Blob") {
      return new Blob([b642buf(val.data)], { type: val.mime || "" });
    }
    if (val.__aetheris_type === "ArrayBuffer") {
      return b642buf(val.data);
    }
    if (val.__aetheris_type === "TypedArray") {
      var buf = b642buf(val.data);
      var Ctor = globalThis[val.ctor];
      return Ctor ? new Ctor(buf) : new Uint8Array(buf);
    }
    if (Array.isArray(val)) return val.map(decodevalue);

    var obj = {};
    var dk = Object.keys(val);
    for (var di = 0; di < dk.length; di++) obj[dk[di]] = decodevalue(val[dk[di]]);
    return obj;
  }

  // read all keys + values from every store in a database
  function dumpdb(name) {
    return new Promise(function (resolve) {
      var done = false;

      try {
        var req = indexedDB.open(name);

        req.onerror = function () {
          if (!done) { done = true; resolve(null); }
        };

        req.onsuccess = function (e) {
          if (done) return;
          var db = e.target.result;
          var stores = Array.from(db.objectStoreNames);

          if (!stores.length) {
            done = true;
            db.close();
            resolve({});
            return;
          }

          var out = {};
          var pending = stores.length * 2; // getAll + getAllKeys per store

          function tick() {
            if (--pending === 0 && !done) {
              done = true;
              db.close();
              resolve(out);
            }
          }

          try {
            var tx = db.transaction(stores, "readonly");

            stores.forEach(function (s) {
              out[s] = { keys: [], values: [] };
              tx.objectStore(s).getAll().onsuccess     = function (ev) { out[s].values = ev.target.result; tick(); };
              tx.objectStore(s).getAllKeys().onsuccess  = function (ev) { out[s].keys   = ev.target.result; tick(); };
            });

            tx.onerror = function () {
              if (!done) { done = true; db.close(); resolve(out); }
            };
          } catch (_) {
            if (!done) { done = true; db.close(); resolve(out); }
          }
        };
      } catch (_) {
        if (!done) { done = true; resolve(null); }
      }
    });
  }

  // well-known databases that games create — fallback if indexedDB.databases() isn't available
  var KNOWN_DBS = [
    "$scramjet", "__scramjet_controller", "/idbfs", "/idbfs-test", "/userfs",
    "CachedXMLHttpRequests", "UnityCache", "firebase-heartbeat-database",
    "firebaseLocalStorageDb", "gameFilesDB", "localforage",
  ];

  function listdbs() {
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem("idbNames") || "[]"); } catch (_) {}

    if (indexedDB.databases) {
      return indexedDB.databases()
        .then(function (dbs) {
          var names = dbs.map(function (d) { return d.name; });
          return Array.from(new Set(saved.concat(names)));
        })
        .catch(function () {
          return saved.length ? saved : KNOWN_DBS;
        });
    }

    return Promise.resolve(saved.length ? saved : KNOWN_DBS);
  }

  function prettysize(n) {
    if (n < 1024)              return n + " B";
    if (n < 1024 * 1024)      return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function isios() {
    var ua = navigator.userAgent;
    return /iP(ad|hone|od)/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && !window.MSStream);
  }

  // trigger a download. on iOS we show a save link instead because programmatic
  // clicks don't work reliably.
  function downloadblob(blob, filename) {
    if (isios()) {
      var statusel = document.getElementById("data-status");
      var old = statusel ? statusel.querySelector(".download-link") : null;
      if (old) old.remove();

      var href = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.className = "download-link";
      link.download = filename;
      link.href = href;
      link.textContent = '📥 Press and choose "Save to Files"';
      link.style.cssText = "display:block;text-align:center;margin-top:10px;padding:8px 16px;background:rgba(255,255,255,0.1);border-radius:8px;text-decoration:none;color:inherit;cursor:pointer;font-size:0.9em;";
      setTimeout(function () { URL.revokeObjectURL(href); }, 60000);

      showmsg("iOS/iPadOS detected (" + prettysize(blob.size) + "): ");
      if (statusel) statusel.appendChild(link);

      var hint = document.createElement("div");
      hint.style.cssText = "font-size:0.85em;margin-top:8px;opacity:0.8;";
      hint.textContent = 'Tap and hold the link above, then select "Download Linked File" or "Save to Files".';
      if (statusel) statusel.appendChild(hint);
      return;
    }

    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  window.exportdata = async function () {
    showmsg("exporting...");

    try {
      var ls = snapshotls();
      var dbnames = await listdbs();

      // build JSON incrementally so we can show progress and avoid one giant string
      var parts = [];
      var size = 0;

      function emit(str) { parts.push(str); size += str.length; }

      emit('{\n  "localStorage": ');
      emit(JSON.stringify(ls, null, 2).replace(/\n/g, "\n  "));

      var dbs = [];
      for (var di2 = 0; di2 < dbnames.length; di2++) {
        showmsg("checking " + dbnames[di2] + "...");
        if (await dbexists(dbnames[di2])) dbs.push(dbnames[di2]);
      }

      if (dbs.length) {
        emit(',\n  "indexedDB": {');

        var firstdb = true;
        for (var dbi = 0; dbi < dbs.length; dbi++) {
          var dbname = dbs[dbi];
          showmsg("exporting " + dbname + "... (" + prettysize(size) + " so far)");
          var dump = await dumpdb(dbname);
          if (!dump || Object.keys(dump).length === 0) continue;

          if (!firstdb) emit(",");
          firstdb = false;
          emit("\n    " + JSON.stringify(dbname) + ": {");

          var firststore = true;
          var storekeys = Object.keys(dump);
          for (var si = 0; si < storekeys.length; si++) {
            var sname = storekeys[si];
            var store = dump[sname];
            if (!firststore) emit(",");
            firststore = false;

            emit("\n      " + JSON.stringify(sname) + ": {");
            emit('\n        "keys": ' + JSON.stringify(store.keys || []));
            emit(',\n        "values": [');

            var vals = store.values || [];
            for (var i = 0; i < vals.length; i++) {
              var encoded = await encodevalue(vals[i]);
              emit((i === 0 ? "\n          " : ",\n          ") + JSON.stringify(encoded));

              // yield to the main thread every 500 rows so the UI stays responsive
              if (i > 0 && i % 500 === 0) {
                showmsg("exporting " + dbname + "/" + sname + " — " + i + "/" + vals.length + " (" + prettysize(size) + ")");
                await new Promise(function (r) { setTimeout(r, 0); });
              }
            }

            emit("\n        ]\n      }");
          }

          emit("\n    }");
        }

        emit("\n  }");
      }

      emit("\n}\n");

      showmsg("building file (" + prettysize(size) + ")...");

      var blob = new Blob(parts, { type: "application/json" });
      parts.length = 0;
      var filename = "aetheris-" + new Date().toISOString().slice(0, 10) + ".json";

      downloadblob(blob, filename);

      if (!isios()) {
        showmsg("done! (" + prettysize(blob.size) + ") check your downloads folder.");
      }
    } catch (err) {
      showmsg("export failed: " + err.message, true);
      console.error(err);
    }
  };

  // clear + rewrite a single database from exported data
  function restoredb(dbname, storedata) {
    return new Promise(function (resolve) {
      var req = indexedDB.open(dbname);

      req.onerror = function () { resolve(); };
      req.onsuccess = function (e) {
        var db = e.target.result;
        var existing = Array.from(db.objectStoreNames);
        var targets = Object.keys(storedata).filter(function(s) { return existing.indexOf(s) !== -1; });

        if (!targets.length) { db.close(); return resolve(); }

        try {
          var tx = db.transaction(targets, "readwrite");
          var pending = targets.length;

          targets.forEach(function (name) {
            var os = tx.objectStore(name);
            var raw = storedata[name];
            var rows = (Array.isArray(raw) ? raw : (raw.values || [])).map(decodevalue);
            var keys = Array.isArray(raw) ? null : (raw.keys || null);
            var hasKeyPath = os.keyPath !== null;

            var cr = os.clear();
            cr.onsuccess = function () {
              if (!rows.length) {
                if (--pending === 0) { db.close(); resolve(); }
                return;
              }

              var left = rows.length;
              rows.forEach(function (row, i) {
                var pr = (!hasKeyPath && keys && keys[i] !== undefined)
                  ? os.put(row, keys[i])
                  : os.put(row);
                pr.onsuccess = pr.onerror = function () {
                  if (--left === 0 && --pending === 0) { db.close(); resolve(); }
                };
              });
            };

            cr.onerror = function () {
              if (--pending === 0) { db.close(); resolve(); }
            };
          });
        } catch (_) {
          db.close();
          resolve();
        }
      };
    });
  }

  window.importdata = async function (event) {
    var file = event.target.files[0];
    if (!file) return;

    event.target.value = "";
    showmsg("importing...");

    try {
      var data = JSON.parse(await file.text());

      if (data.localStorage && typeof data.localStorage === "object") {
        var lskeys = Object.keys(data.localStorage);
        for (var li = 0; li < lskeys.length; li++) {
          try { localStorage.setItem(lskeys[li], data.localStorage[lskeys[li]]); } catch (e) {}
        }
      }

      if (data.indexedDB && typeof data.indexedDB === "object") {
        var idbkeys = Object.keys(data.indexedDB);
        for (var ii = 0; ii < idbkeys.length; ii++) {
          await restoredb(idbkeys[ii], data.indexedDB[idbkeys[ii]]);
        }
      }

      if (!data.localStorage && !data.indexedDB) {
        throw new Error("doesn't look like a valid aetheris export");
      }

      showmsg("done! reloading in 1.5s...");
      setTimeout(function () { location.reload(); }, 1500);

    } catch (err) {
      showmsg("import failed: " + err.message, true);
      console.error(err);
    }
  };

});
