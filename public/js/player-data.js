// Load only the relevant catalog; apps no longer download the entire game list.
window.playerDataReady = new Promise(function (resolve, reject) {
  var isApp = new URLSearchParams(location.search).has("app");
  var script = document.createElement("script");
  script.src = isApp
    ? "/assets/data/apps.js?v=20260907.1"
    : "/assets/data/games.js?v=20260907.1";
  script.onload = function () {
    Promise.resolve(isApp ? window.appsready : window.gamesready).then(
      resolve,
      reject,
    );
  };
  script.onerror = function () {
    reject(
      new Error(
        "The catalog loader could not be downloaded. Check your connection.",
      ),
    );
  };
  document.head.appendChild(script);
});
