// Shared DM/auth logic for chat.html and minichat.html. Both pages used to
// carry identical inline copies of this code that had already started to
// drift; anything non-rendering lives here now. The pages keep their own
// showapp()/showauth()/rendering and define them AFTER this script loads —
// only user-triggered flows (submitauth) may call into them.
var autologin  = localStorage.getItem("dmAutoLogin") !== "false";
var authtoken  = autologin
  ? (localStorage.getItem("dmToken") || sessionStorage.getItem("dmToken") || "")
  : (sessionStorage.getItem("dmToken") || "");
var myusername = localStorage.getItem("dmUsername") || "";

function savetoken(t) {
  authtoken = t;
  sessionStorage.setItem("dmToken", t);
  if (autologin) localStorage.setItem("dmToken", t);
  else localStorage.removeItem("dmToken");
}

function cleartoken() {
  authtoken = "";
  sessionStorage.removeItem("dmToken");
  localStorage.removeItem("dmToken");
}

function ini(n) {
  return String(n || "?").slice(0, 2).toUpperCase();
}

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function timeago(ts) {
  var d = Date.now() - ts;
  if (d < 60000) return "now";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  if (d < 86400000) return Math.floor(d / 3600000) + "h";
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

// the ONE device id generator (home.html and load.html used to carry
// slightly different copies writing the same localStorage key)
async function getdeviceid() {
  var stored = localStorage.getItem("dmDeviceId");
  if (stored && /^[a-f0-9]{64}$/.test(stored)) return stored;

  var hex;
  if (crypto.getRandomValues) {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    hex = Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
  } else {
    // last resort for ancient browsers: hash a fingerprint. still 64 hex chars.
    var raw = [
      navigator.userAgent, navigator.language, Date.now(), Math.random(),
      screen.width, screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ].join("|");
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    hex = Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  localStorage.setItem("dmDeviceId", hex);
  return hex;
}

var currenttab = "login";
function switchtab(t) {
  currenttab = t;
  document.getElementById("tab-login").classList.toggle("active", t === "login");
  document.getElementById("tab-reg").classList.toggle("active", t === "register");
  document.getElementById("auth-submit").textContent = t === "login" ? "Log in" : "Register";
  document.getElementById("auth-err").textContent = "";
}

async function submitauth() {
  var u = document.getElementById("f-user").value.trim();
  var p = document.getElementById("f-pass").value;
  var e = document.getElementById("auth-err");
  e.textContent = "";
  if (!u || !p) { e.textContent = "Fill in both fields."; return; }
  var ep = currenttab === "login" ? "/api/accounts/login" : "/api/accounts/register";
  try {
    var deviceId = await getdeviceid();
    var r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p, deviceId: deviceId }) });
    var d = await r.json();
    if (!d.ok) { e.textContent = d.error || "Something went wrong."; return; }
    // register returns a session token directly now — no second login call
    savetoken(d.token);
    myusername = d.username;
    localStorage.setItem("dmUsername", myusername);
    showapp();
  } catch(_) { e.textContent = "Network error."; }
}

// auth-form wiring only exists on the chat pages; home.html and load.html
// load this file purely for the helpers above, so guard the element access
if (document.getElementById("f-user") && document.getElementById("f-pass")) {
  document.getElementById("f-user").addEventListener("keydown", function(e) { if (e.key === "Enter") document.getElementById("f-pass").focus(); });
  document.getElementById("f-pass").addEventListener("keydown", function(e) { if (e.key === "Enter") submitauth(); });
}
