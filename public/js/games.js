var PLACEHOLDER = "/assets/images/placeholder.png";
// 200 cards per idle chunk: fewer scheduler round-trips for the ~15k game
// catalog, still small enough to keep each chunk off the critical path
var CHUNK = 200;

function getgames() {
  return Array.isArray(window.games) ? window.games : [];
}

function gamesource(game) {
  return (game && game.source) || "aetheris";
}

var __initSourceFilter = null;

// one delegated click listener for every card grid (main, favorites, popular).
// with ~15k games the old per-card listeners meant 15k closures for no gain.
if (typeof document !== "undefined") {
  document.addEventListener("click", function(e) {
    var card = e.target && e.target.closest ? e.target.closest(".card-item") : null;
    if (!card || !card.dataset.id) return;
    window.location.href = "/load.html?game=" + encodeURIComponent(card.dataset.id);
  });
}

function makecard(game) {
  var card  = document.createElement("div");
  var img   = document.createElement("img");
  var label = document.createElement("h4");

  card.classList.add("card-item");
  card.dataset.id     = String(game.id);
  card.dataset.source = gamesource(game);
  // precomputed for the filter pass — avoids a querySelector("h4") per card
  // on every keystroke across the whole grid
  card.dataset.title  = String(game.title || game.name || "untitled").toLowerCase();

  if (__initSourceFilter && __initSourceFilter !== "all" && card.dataset.source !== __initSourceFilter) {
    card.style.display = "none";
  }

  img.loading        = "lazy";
  img.decoding       = "async";
  img.referrerPolicy = "no-referrer";
  img.alt            = (game.title || game.name || "Game") + " icon";
  img.src            = game.image || game.img || PLACEHOLDER;

  img.onerror = function() {
    if (img.dataset.fallbackApplied === "true") return;
    img.dataset.fallbackApplied = "true";
    img.src = PLACEHOLDER;
  };

  label.textContent = game.title || game.name || "Untitled";
  card.appendChild(img);
  card.appendChild(label);

  return card;
}

var queuenext = typeof requestIdleCallback === "function"
  ? function(fn) { requestIdleCallback(fn, { timeout: 300 }); }
  : function(fn) { setTimeout(fn, 0); };

// live list of every rendered card in the main grid + favorites. the search
// box is wired against this immediately and cards join as chunks render, so
// the page is interactive long before the full catalog is on screen.
var renderedcards = [];

function buildgamecards() {
  var allgames = getgames();
  if (!allgames.length) return;

  var gamesbyid = {};
  allgames.forEach(function(game) { gamesbyid[String(game.id)] = game; });

  var gamecards      = document.querySelector("#gamecards");
  var favoritescards = document.querySelector("#favoritedgames");

  if (!gamecards) {
    console.error("couldnt find #gamecards");
    return;
  }

  gamecards.innerHTML = "";
  if (favoritescards) favoritescards.innerHTML = "";
  renderedcards = [];

  var sourcefilterel = document.querySelector("#source-filter");
  __initSourceFilter = (sourcefilterel ? sourcefilterel.value : "") || "all";

  var favoritedids = JSON.parse(localStorage.getItem("favoritedGames") || "[]");

  function isfavorite(game) {
    if (favoritedids.indexOf(game.id) !== -1) return true;
    // favorites saved before id deduping may hold the raw shared id
    return !!game.rawid && favoritedids.indexOf(game.rawid) !== -1;
  }

  var mainlist = [];
  var favfrag  = document.createDocumentFragment();

  allgames.forEach(function(game) {
    if (isfavorite(game) && favoritescards) {
      var favcard = makecard(game);
      favfrag.appendChild(favcard);
      renderedcards.push(favcard);
    } else {
      mainlist.push(game);
    }
  });
  if (favoritescards) favoritescards.appendChild(favfrag);

  // wire search + filters NOW, then announce the data. both used to wait for
  // every chunk to render AND the popular-games network fetch — on a slow
  // connection the search box was dead for seconds.
  setsearchandfilter(gamesbyid);
  document.dispatchEvent(new Event("gamesrendered"));
  showpopulargames(gamesbyid);

  var cursor = 0;

  function renderchunk() {
    var frag = document.createDocumentFragment();
    var end  = Math.min(cursor + CHUNK, mainlist.length);
    for (var i = cursor; i < end; i++) {
      var card = makecard(mainlist[i]);
      frag.appendChild(card);
      renderedcards.push(card);
    }
    gamecards.appendChild(frag);
    cursor = end;

    if (cursor < mainlist.length) {
      queuenext(renderchunk);
    }
  }

  renderchunk();
}

async function showpopulargames(gamesbyid) {
  var container = document.querySelector("#populargames");
  var label     = document.querySelector("#popular-label");
  if (!container) return;

  var topids = [];
  try {
    var key = "__popularGames";
    var TTL = 5 * 60 * 1000;
    var raw = sessionStorage.getItem(key);
    var ts  = parseInt(sessionStorage.getItem(key + "_ts") || "0", 10);

    if (raw && Date.now() - ts < TTL) {
      topids = JSON.parse(raw).slice(0, 10);
    } else {
      var res  = await fetch("/api/plays/top");
      var data = await res.json();
      sessionStorage.setItem(key, JSON.stringify(data));
      sessionStorage.setItem(key + "_ts", String(Date.now()));
      topids = data.slice(0, 10);
    }
  } catch (e) {}

  container.innerHTML = "";

  if (!topids.length) {
    if (label) label.style.display = "none";
    return;
  }

  if (label) label.style.display = "block";

  for (var i = 0; i < topids.length; i++) {
    var game = gamesbyid[topids[i]];
    if (game) container.appendChild(makecard(game));
  }
}

function debounce(fn, ms) {
  var t;
  return function() {
    var args = arguments;
    var self = this;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(self, args); }, ms);
  };
}

function setsearchandfilter(gamesbyid) {
  var searchinput  = document.querySelector("#search-box");
  var sourcefilter = document.querySelector("#source-filter");

  window.__refreshCardCache = function() {
    // cards now register themselves in renderedcards as chunks render; this
    // hook is kept for compatibility and just re-reads from the DOM
    renderedcards = Array.from(document.querySelectorAll("#gamecards .card-item, #favoritedgames .card-item"));
  };

  function applyfilters() {
    var query      = (searchinput ? searchinput.value : "").trim().toLowerCase();
    var source     = (sourcefilter ? sourcefilter.value : "") || "all";
    var activetags = window.__activeTags;

    var hasquery = !!query;
    var hassource = source !== "all";
    var hastags = !!(activetags && activetags.size > 0);

    // common case: nothing to filter — flip everything visible and run
    if (!hasquery && !hassource && !hastags) {
      for (var vi = 0; vi < renderedcards.length; vi++) renderedcards[vi].style.display = "";
    } else {
      var tagarr = [];
      if (hastags) activetags.forEach(function(t) { tagarr.push(t); });

      for (var i = 0; i < renderedcards.length; i++) {
        var card = renderedcards[i];

        var matchessearch = !hasquery || card.dataset.title.indexOf(query) !== -1;
        var matchessource = !hassource || card.dataset.source === source;
        var matchtags     = true;

        if (hastags) {
          var game = gamesbyid[card.dataset.id];
          var gametags = (game && Array.isArray(game.tags) && game.tags.length) ? game.tags : [];
          matchtags = tagarr.some(function(t) { return gametags.indexOf(t) !== -1; });
        }

        card.style.display = (matchessearch && matchessource && matchtags) ? "" : "none";
      }
    }

    var favcontainer = document.getElementById("favoritedgames");
    var favlabel     = document.getElementById("favorites-label");
    if (favcontainer && favlabel) {
      var anyvisible = false;
      for (var fi = 0; fi < favcontainer.children.length; fi++) {
        if (favcontainer.children[fi].style.display !== "none") { anyvisible = true; break; }
      }
      favlabel.style.display = anyvisible ? "block" : "none";
    }
  }

  window.__applyFilters = applyfilters;

  if (searchinput) searchinput.addEventListener("input", debounce(applyfilters, 150));
  if (sourcefilter) sourcefilter.addEventListener("change", applyfilters);

  applyfilters();
}

if (window.gamesloaded) {
  buildgamecards();
} else {
  window.addEventListener("gamesloaded", buildgamecards, { once: true });
}
