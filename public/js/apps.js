var APP_PLACEHOLDER = "./assets/images/placeholder.png";

function getapps() {
  if (Array.isArray(window.apps)) return window.apps;
  if (typeof apps !== "undefined" && Array.isArray(apps)) return apps;
  return [];
}

function fiximagepath(raw, fallback) {
  if (!fallback) fallback = APP_PLACEHOLDER;
  if (!raw || typeof raw !== "string") return fallback;
  var p = raw.trim();
  if (!p) return fallback;

  if (/^(https?:|data:|blob:)/i.test(p)) return p;
  if (p.charAt(0) === "." || p.charAt(0) === "/") return p;

  return "./" + p.replace(/^\/+/, "");
}

async function loadexternalimage(el, src) {
  try {
    var res = await fetch(src, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
    if (res.ok) {
      el.src = URL.createObjectURL(await res.blob());
      return;
    }
  } catch (e) {}

  try {
    var res2 = await fetch(src, { mode: "no-cors", credentials: "omit", referrerPolicy: "no-referrer" });
    var blob = await res2.blob();
    if (blob.size > 0) {
      el.src = URL.createObjectURL(blob);
      return;
    }
  } catch (e) {}

  el.dataset.fallbackApplied = "true";
  el.src = APP_PLACEHOLDER;
}

function buildappcards() {
  var apps = getapps();
  if (!apps.length) return;

  var grid     = document.querySelector("#appcards");
  var favgrid  = document.querySelector("#favoritedapps");
  var favlabel = document.querySelector("#favorited-apps-label");
  if (!grid) return;

  grid.innerHTML = "";
  if (favgrid) favgrid.innerHTML = "";

  var favids = JSON.parse(localStorage.getItem("favoritedApps") || "[]");

  for (var i = 0; i < apps.length; i++) {
    var app   = apps[i];
    var card  = document.createElement("div");
    var img   = document.createElement("img");
    var label = document.createElement("h4");

    card.classList.add("card-item");
    card.dataset.id = String(app.id || "");

    img.loading  = "lazy";
    img.decoding = "async";
    img.alt      = app.title || "App icon";

    var src = fiximagepath(app.image || app.icon || app.img || "");
    if (/^https?:/i.test(src)) {
      img.src = APP_PLACEHOLDER;
      loadexternalimage(img, src);
    } else {
      img.src = src;
      img.onerror = (function(imgref) {
        return function() {
          if (imgref.dataset.fallbackApplied === "true") return;
          imgref.dataset.fallbackApplied = "true";
          imgref.src = APP_PLACEHOLDER;
        };
      })(img);
    }

    label.textContent = app.title || "Untitled";
    card.appendChild(img);
    card.appendChild(label);

    card.addEventListener("click", (function(appref) {
      return function() {
        window.location.href = "/load.html?app=" + encodeURIComponent(appref.id);
      };
    })(app));

    if (favids.indexOf(app.id) !== -1 && favgrid) {
      favgrid.appendChild(card);
    } else {
      grid.appendChild(card);
    }
  }

  if (favlabel && favgrid) {
    favlabel.style.display = favgrid.children.length ? "block" : "none";
  }

  var searchbox = document.querySelector("#search-box");
  if (searchbox) {
    var fresh = searchbox.cloneNode(true);
    searchbox.parentNode.replaceChild(fresh, searchbox);

    fresh.addEventListener("input", function() {
      var q = fresh.value.trim().toLowerCase();
      var cards = document.querySelectorAll("#appcards .card-item, #favoritedapps .card-item");
      for (var j = 0; j < cards.length; j++) {
        var h4 = cards[j].querySelector("h4");
        var title = (h4 ? h4.textContent : "").toLowerCase();
        cards[j].style.display = (!q || title.indexOf(q) !== -1) ? "" : "none";
      }
    });
  }
}

window.addEventListener("appsloaded", buildappcards, { once: true });

if (getapps().length) buildappcards();
