window.games = window.games || [];
window.gamesloaded = false;

var gamesources = [
  "assets/data/velara.json",
  "assets/data/gnmath.json",
  "assets/data/petezah.json",
  "assets/data/truffled.json",
  "assets/data/aetheris.json",
  "assets/data/igroutka.json"
];

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizegame(rawgame, fallbacksource) {
  if (!rawgame || typeof rawgame !== "object") return null;

  var game = {};
  var keys = Object.keys(rawgame);
  for (var i = 0; i < keys.length; i++) game[keys[i]] = rawgame[keys[i]];

  if (!game.title && game.name) game.title = game.name;
  if (!game.image && game.img)  game.image = game.img;

  if (!game.source) game.source = fallbacksource || "unknown";

  if (!game.id) {
    game.id = game.url || game.html || game.source + "-" + slugify(game.title);
  } else {
    game.id = String(game.id);
  }

  return game;
}

var GAMES_CACHE_TTL = 5 * 60 * 1000;
var GAMES_IDB = "aetheris-games-cache";
var GAMES_STORE = "cache";
var GAMES_IDB_KEY = "games";

function opengamecache() {
  return new Promise(function(resolve) {
    try {
      var req = indexedDB.open(GAMES_IDB, 1);
      req.onupgradeneeded = function(e) { e.target.result.createObjectStore(GAMES_STORE); };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function() { resolve(null); };
    } catch (e) { resolve(null); }
  });
}

async function getcachedgames() {
  var db = await opengamecache();
  if (!db) return null;
  return new Promise(function(resolve) {
    try {
      var tx = db.transaction(GAMES_STORE, "readonly");
      var get = tx.objectStore(GAMES_STORE).get(GAMES_IDB_KEY);
      get.onsuccess = function() {
        db.close();
        var v = get.result;
        resolve(v && Date.now() - v.ts < GAMES_CACHE_TTL ? v.data : null);
      };
      get.onerror = function() { db.close(); resolve(null); };
    } catch (e) { db.close(); resolve(null); }
  });
}

async function setcachedgames(data) {
  var db = await opengamecache();
  if (!db) return;
  try {
    var tx = db.transaction(GAMES_STORE, "readwrite");
    tx.objectStore(GAMES_STORE).put({ ts: Date.now(), data: data }, GAMES_IDB_KEY);
    tx.oncomplete = function() { db.close(); };
    tx.onerror = function() { db.close(); };
  } catch (e) { db.close(); }
}

async function fetchjson(url) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, 8000);
  try {
    var res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadgamesdata() {
  var cached = await getcachedgames();
  if (cached) {
    window.games = cached;
    window.gamesloaded = true;
    window.dispatchEvent(new Event("gamesloaded"));
    return window.games;
  }

  var results = await Promise.allSettled(
    gamesources.map(function(file) {
      var sourcename = file.split("/").pop().replace(/\.json$/i, "");
      return fetchjson(file).then(function(data) {
        if (Array.isArray(data)) {
          return data.map(function(g) { return normalizegame(g, sourcename); }).filter(Boolean);
        } else if (data && Array.isArray(data.games)) {
          return data.games.map(function(g) { return normalizegame(g, sourcename); }).filter(Boolean);
        } else {
          console.warn("Unexpected JSON shape:", file, data);
          return [];
        }
      });
    })
  );

  var merged = [];
  for (var i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      merged = merged.concat(results[i].value);
    } else {
      console.error("Failed to load games source:", results[i].reason);
    }
  }

  merged.sort(function(a, b) {
    var sourcecompare = (a.source || "").localeCompare(b.source || "");
    if (sourcecompare !== 0) return sourcecompare;
    return (a.title || "").localeCompare(b.title || "");
  });

  window.games = merged;
  window.gamesloaded = true;
  setcachedgames(merged);

  window.dispatchEvent(new Event("gamesloaded"));

  return window.games;
}

window.gamesready = window.gamesready || loadgamesdata();
