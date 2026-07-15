var PLACEHOLDER = "/assets/images/placeholder.png";
var CHUNK = 80;

function getgames() {
  return Array.isArray(window.games) ? window.games : [];
}

function gamesource(game) {
  return (game && game.source) || "aetheris";
}

var __initSourceFilter = null;

function makecard(game) {
  var card  = document.createElement("div");
  var img   = document.createElement("img");
  var label = document.createElement("h4");

  card.classList.add("card-item");
  card.dataset.id     = String(game.id);
  card.dataset.source = gamesource(game);

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

  card.addEventListener("click", function() {
    window.location.href = "/load.html?game=" + encodeURIComponent(game.id);
  });

  return card;
}

var queuenext = typeof requestIdleCallback === "function"
  ? function(fn) { requestIdleCallback(fn, { timeout: 300 }); }
  : function(fn) { setTimeout(fn, 0); };

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

  var sourcefilterel = document.querySelector("#source-filter");
  __initSourceFilter = (sourcefilterel ? sourcefilterel.value : "") || "all";

  var favoritedids = JSON.parse(localStorage.getItem("favoritedGames") || "[]");

  var mainlist = [];
  var favfrag  = document.createDocumentFragment();

  allgames.forEach(function(game) {
    if (favoritedids.indexOf(game.id) !== -1 && favoritescards) {
      favfrag.appendChild(makecard(game));
    } else {
      mainlist.push(game);
    }
  });
  if (favoritescards) favoritescards.appendChild(favfrag);

  var cursor = 0;

  function renderchunk() {
    var frag = document.createDocumentFragment();
    var end  = Math.min(cursor + CHUNK, mainlist.length);
    for (var i = cursor; i < end; i++) {
      frag.appendChild(makecard(mainlist[i]));
    }
    gamecards.appendChild(frag);
    cursor = end;

    if (cursor < mainlist.length) {
      queuenext(renderchunk);
    } else {
      showpopulargames(gamesbyid).then(function() {
        setsearchandfilter(gamesbyid);
        document.dispatchEvent(new Event("gamesrendered"));
      });
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

  var cardcache = Array.from(document.querySelectorAll("#gamecards .card-item, #favoritedgames .card-item"));
  window.__refreshCardCache = function() {
    cardcache = Array.from(document.querySelectorAll("#gamecards .card-item, #favoritedgames .card-item"));
  };

  function applyfilters() {
    var query      = (searchinput ? searchinput.value : "").trim().toLowerCase();
    var source     = (sourcefilter ? sourcefilter.value : "") || "all";
    var activetags = window.__activeTags;

    cardcache.forEach(function(card) {
      var game    = gamesbyid[card.dataset.id];
      var h4      = card.querySelector("h4");
      var title   = (h4 ? h4.textContent : "").toLowerCase();
      var gsource = gamesource(game);

      var matchessearch = !query || title.indexOf(query) !== -1;
      var matchessource = source === "all" || gsource === source;
      var matchtags     = true;

      if (activetags && activetags.size > 0 && game) {
        var gametags = (Array.isArray(game.tags) && game.tags.length) ? game.tags : [];
        var tagarr = [];
        activetags.forEach(function(t) { tagarr.push(t); });
        matchtags = tagarr.some(function(t) { return gametags.indexOf(t) !== -1; });
      }

      card.style.display = (matchessearch && matchessource && matchtags) ? "" : "none";
    });

    var favcontainer = document.getElementById("favoritedgames");
    var favlabel     = document.getElementById("favorites-label");
    if (favcontainer && favlabel) {
      var anyvisible = false;
      for (var i = 0; i < favcontainer.children.length; i++) {
        if (favcontainer.children[i].style.display !== "none") { anyvisible = true; break; }
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
