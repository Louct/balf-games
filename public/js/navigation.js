(function() {
  function gotoapp(page) {
    if (window.parent && window.parent !== window) {
      if (typeof window.parent.navigateApp === "function") {
        window.parent.navigateApp(page);
      } else {
        window.parent.postMessage({ type: "navigate", page: page }, location.origin);
      }
    } else {
      window.location.href = "./index.html";
    }
  }

  document.addEventListener("click", function(e) {
    var link = e.target.closest("a[href]");
    if (!link) return;

    var pagemap = {
      "./index.html": "home",
      "index.html": "home",
      "./home.html": "home",
      "home.html": "home",
      "./settings.html": "settings",
      "settings.html": "settings",
      "./about.html": "about",
      "about.html": "about"
    };

    var page = pagemap[link.getAttribute("href")];
    if (page && window.self !== window.top) {
      e.preventDefault();
      gotoapp(page);
    }
  });

  window.gotoapp = gotoapp;
})();
