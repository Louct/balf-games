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

var GAMES_CACHE_KEY = "__gamesCache_v2";
var GAMES_CACHE_TTL = 5 * 60 * 1000;

function getcachedgames() {
  try {
    var raw = sessionStorage.getItem(GAMES_CACHE_KEY);
    if (!raw) return null;
    var cached = JSON.parse(raw);
    if (Date.now() - cached.ts < GAMES_CACHE_TTL) return cached.data;
  } catch (e) {}
  return null;
}

function setcachedgames(data) {
  try {
    sessionStorage.setItem(GAMES_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
  } catch (e) {}
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
  var cached = getcachedgames();
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
