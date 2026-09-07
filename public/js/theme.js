// runs before DOMContentLoaded to prevent FOUC — using var intentionally for
// max browser compat since this is a blocking script in <head>.
(function () {
  var THEME_KEY = "aetheris-theme";
  var BG_KEY = "aetheris-customBg";

  // migrate from the old storage keys (one-time)
  if (
    !Aetheris.storage.getItem(THEME_KEY) &&
    Aetheris.storage.getItem("theme")
  ) {
    Aetheris.storage.setItem(THEME_KEY, Aetheris.storage.getItem("theme"));
    Aetheris.storage.removeItem("theme");
  }
  if (
    !Aetheris.storage.getItem(BG_KEY) &&
    Aetheris.storage.getItem("customBg")
  ) {
    Aetheris.storage.setItem(BG_KEY, Aetheris.storage.getItem("customBg"));
    Aetheris.storage.removeItem("customBg");
  }

  var themes = {
    dark: {
      bg: "linear-gradient(135deg, #0f0f0f 0%, #161616 40%, #0a0a0a 100%)",
      bgc: "#0f0f0f",
      color: "#e5e5e5",
    },
    "charcoal-gold": {
      bg: "linear-gradient(135deg, #0f0f0f 0%, #161616 40%, #0a0a0a 100%)",
      bgc: "#0f0f0f",
      color: "#e5e5e5",
    },
    "dark-blue": {
      bg: "linear-gradient(#020617, #000)",
      bgc: "#020617",
      color: "#e5e7eb",
    },
  };

  var validthemes = { dark: 1, "charcoal-gold": 1, "dark-blue": 1 };

  var bgoverlay = null;
  function getoverlay() {
    if (bgoverlay && bgoverlay.isConnected) return bgoverlay;
    bgoverlay = document.createElement("div");
    bgoverlay.id = "custom-bg-overlay";
    bgoverlay.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;background-size:cover;background-position:center;background-repeat:no-repeat;";
    document.body.insertBefore(bgoverlay, document.body.firstChild);
    return bgoverlay;
  }

  function removeoverlay() {
    if (bgoverlay && bgoverlay.parentNode)
      bgoverlay.parentNode.removeChild(bgoverlay);
    bgoverlay = null;
  }

  var t = Aetheris.storage.getItem(THEME_KEY) || "dark";
  if (!validthemes[t]) {
    t = "dark";
    Aetheris.storage.setItem(THEME_KEY, t);
  }

  function apply(theme) {
    document.documentElement.setAttribute("theme", theme);
    if (document.body) {
      document.body.setAttribute("theme", theme);
      var custombg = Aetheris.storage.getItem(BG_KEY);
      if (custombg) {
        document.documentElement.classList.add("has-custom-bg");
        document.body.classList.add("has-custom-bg");
        document.body.style.setProperty(
          "background-image",
          "none",
          "important",
        );
        document.body.style.backgroundSize = "";
        document.body.style.backgroundPosition = "";
        document.body.style.backgroundRepeat = "";
        document.body.style.backgroundAttachment = "";
        var el = getoverlay();
        el.style.backgroundImage = "url(" + JSON.stringify(custombg) + ")";
      } else if (themes[theme]) {
        document.documentElement.classList.remove("has-custom-bg");
        document.body.classList.remove("has-custom-bg");
        removeoverlay();
        document.body.style.setProperty(
          "background-image",
          themes[theme].bg,
          "important",
        );
        document.body.style.setProperty(
          "background-color",
          themes[theme].bgc,
          "important",
        );
        document.body.style.backgroundSize = "";
        document.body.style.backgroundPosition = "";
        document.body.style.backgroundRepeat = "";
        document.body.style.backgroundAttachment = "";
      }
    }
  }

  document.documentElement.setAttribute("theme", t);
  Aetheris.applyTheme = function (theme) {
    if (!validthemes[theme]) return;
    t = theme;
    apply(t);
  };
  if (document.body) {
    apply(t);
  } else {
    var applied = false;
    function earlyapply() {
      if (applied) return;
      if (document.body) {
        applied = true;
        apply(t);
      }
    }
    new MutationObserver(function (_, obs) {
      if (document.body) {
        obs.disconnect();
        earlyapply();
      }
    }).observe(document.documentElement, { childList: true });
    document.addEventListener("DOMContentLoaded", earlyapply, { once: true });
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin) return;
    if (window.parent !== window && e.source !== window.parent) return;
    if (e.data && e.data.type === "theme-changed" && e.data.theme) {
      var incoming = e.data.theme;
      if (!validthemes[incoming]) return;
      t = incoming;
      Aetheris.storage.setItem(THEME_KEY, t);
      apply(t);
    }
    if (e.data && e.data.type === "bg-changed") {
      if (e.data.dataurl) {
        Aetheris.storage.setItem(BG_KEY, e.data.dataurl);
      } else {
        Aetheris.storage.removeItem(BG_KEY);
      }
      apply(t);
    }
  });
})();
