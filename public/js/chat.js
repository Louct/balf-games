var autologin  = localStorage.getItem("dmAutoLogin") !== "false";
var authtoken  = autologin
  ? (localStorage.getItem("dmToken") || sessionStorage.getItem("dmToken") || "")
  : (sessionStorage.getItem("dmToken") || "");
var myusername = localStorage.getItem("dmUsername") || "";
var activeconvo = null, polltimer = null, inboxtimer = null;
var inboxcache = [], lastmsgtime = 0, lastdatelabel = "";
var POLL_MS = 2500;

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

function getdeviceid() {
  var stored = localStorage.getItem("dmDeviceId");
  if (stored && /^[a-f0-9]{64}$/.test(stored)) return stored;
  var bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  var hex = Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
  localStorage.setItem("dmDeviceId", hex);
  return hex;
}

function showpw(){ document.getElementById("f-pass").type="text"; }
function hidepw(){ document.getElementById("f-pass").type="password"; }

var keepchk = document.getElementById("keep-chk");
keepchk.checked = autologin;
keepchk.addEventListener("change", function() {
  autologin = keepchk.checked;
  localStorage.setItem("dmAutoLogin", autologin ? "true" : "false");
  if (!autologin) localStorage.removeItem("dmToken");
  else if (authtoken) localStorage.setItem("dmToken", authtoken);
});

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
    var deviceId = getdeviceid();
    var body = { username: u, password: p, deviceId: deviceId };
    var r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    var d = await r.json();
    if (!d.ok) { e.textContent = d.error || "Something went wrong."; return; }
    if (currenttab === "register") {
      var lr = await fetch("/api/accounts/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p, deviceId: deviceId }) });
      var ld = await lr.json();
      if (!ld.ok) { e.textContent = ld.error || "couldn't log you in after registering."; return; }
      savetoken(ld.token); myusername = ld.username;
    } else { savetoken(d.token); myusername = d.username; }
    localStorage.setItem("dmUsername", myusername);
    showapp();
  } catch(_) { e.textContent = "Network error."; }
}
document.getElementById("f-user").addEventListener("keydown", function(e) { if (e.key === "Enter") document.getElementById("f-pass").focus(); });
document.getElementById("f-pass").addEventListener("keydown", function(e) { if (e.key === "Enter") submitauth(); });

function showapp() {
  document.getElementById("auth-page").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("my-name").textContent = myusername;
  document.getElementById("my-av").textContent = ini(myusername);
  syncalbtn();
  loadinbox();
  inboxtimer = setInterval(loadinbox, 6000);
}

function showauth() {
  document.getElementById("app").style.display = "none";
  document.getElementById("auth-page").style.display = "flex";
  clearInterval(polltimer);
  clearInterval(inboxtimer);
  polltimer = inboxtimer = null;
  activeconvo = null;
}

(async function() {
  if (!authtoken) return;
  try {
    var r = await fetch("/api/accounts/me", { headers: { "Authorization": "Bearer " + authtoken } });
    var d = await r.json();
    if (d.ok) { myusername = d.username; localStorage.setItem("dmUsername", myusername); showapp(); }
    else { cleartoken(); localStorage.removeItem("dmUsername"); myusername = ""; }
  } catch(_) {}
})();

function syncalbtn() {
  var b = document.getElementById("al-btn");
  if (!b) return;
  b.textContent = autologin ? "🔒" : "🔓";
  b.title = autologin ? "Auto-login ON" : "Auto-login OFF";
  b.style.opacity = autologin ? "1" : "0.45";
}

function toggleautologin() {
  autologin = !autologin;
  localStorage.setItem("dmAutoLogin", autologin ? "true" : "false");
  keepchk.checked = autologin;
  if (!autologin) localStorage.removeItem("dmToken");
  else if (authtoken) localStorage.setItem("dmToken", authtoken);
  syncalbtn();
}

async function logout() {
  try { await fetch("/api/accounts/logout", { method: "POST", headers: { "Authorization": "Bearer " + authtoken } }); } catch(_) {}
  cleartoken();
  myusername = "";
  localStorage.removeItem("dmUsername");
  showauth();
}

async function confirmdelete() {
  try { await fetch("/api/accounts/delete", { method: "DELETE", headers: { "Authorization": "Bearer " + authtoken } }); } catch(_) {}
  closemodal("modal-del");
  cleartoken();
  myusername = "";
  localStorage.removeItem("dmUsername");
  showauth();
}

function openwipe() {
  document.getElementById("wipe-ok").style.display = "none";
  openmodal("modal-wipe");
}

async function confirmwipe() {
  var deviceid = getdeviceid();
  try { await fetch("/api/accounts/delete-all-mine", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: deviceid }) }); } catch(_) {}
  ["dmToken","dmUsername","dmAutoLogin","dmDeviceId"].forEach(function(k) { localStorage.removeItem(k); sessionStorage.removeItem(k); });
  Object.keys(localStorage).filter(function(k) { return k.indexOf("dm") === 0; }).forEach(function(k) { localStorage.removeItem(k); });
  authtoken = "";
  myusername = "";
  var ok = document.getElementById("wipe-ok");
  ok.textContent = "Done. You can register a new account.";
  ok.style.display = "block";
  setTimeout(function() { closemodal("modal-wipe"); showauth(); }, 1600);
}

async function loadinbox() {
  try {
    var r = await fetch("/api/dm-inbox", { headers: { "Authorization": "Bearer " + authtoken } });
    var d = await r.json();
    if (!d.ok) return;
    inboxcache = d.conversations;
    renderinbox(inboxcache);
  } catch(_) {}
}

function filterinbox() {
  var q = document.getElementById("srch").value.trim().toLowerCase();
  renderinbox(q ? inboxcache.filter(function(c) { return c.with.toLowerCase().indexOf(q) !== -1; }) : inboxcache);
}

function renderinbox(cs) {
  var el = document.getElementById("tg-list");
  el.innerHTML = "";
  if (!cs.length) { el.innerHTML = '<div class="tg-empty-l">no convos yet.<br>start one above!</div>'; notifybadge(0); return; }
  var totalunread = 0;
  cs.forEach(function(c) {
    var isactive = c.with.toLowerCase() === activeconvo;
    var unread = isactive ? 0 : (c.unread || 0);
    if (!isactive) totalunread += unread;
    var it = document.createElement("div");
    it.className = "tg-ci" + (isactive ? " active" : "");
    var badge = unread > 0 ? '<span class="tg-unread-badge">' + (unread > 99 ? '99+' : unread) + '</span>' : "";
    it.innerHTML = '<div class="av sm">' + ini(c.with) + '</div>'
      + '<div class="tg-cb"><div class="tg-ct"><span class="tg-cn">' + esc(c.with) + '</span>'
      + '<span class="tg-ctime">' + timeago(c.lastTime) + '</span></div>'
      + '<div class="tg-cprev">' + esc(c.lastMessage) + '</div></div>' + badge;
    it.addEventListener("click", function() { openconvo(c.with.toLowerCase()); });
    el.appendChild(it);
  });
  notifybadge(totalunread);
}

function notifybadge(count) {
  try { window.parent.postMessage({ type: "chat-unread", count: count }, location.origin); } catch(_) {}
}

function openconvo(u) {
  activeconvo = u;
  lastmsgtime = 0;
  lastdatelabel = "";
  document.getElementById("tg-empty").style.display = "none";
  var ac = document.getElementById("tg-active");
  ac.style.display = "flex";
  document.getElementById("chat-name").textContent = u;
  document.getElementById("chat-av").textContent = ini(u);
  document.getElementById("tg-msgs").innerHTML = "";
  document.querySelectorAll(".tg-ci").forEach(function(el) {
    var name = el.querySelector(".tg-cn");
    el.classList.toggle("active", (name && name.textContent || "").toLowerCase() === u);
  });
  clearInterval(polltimer);
  loadmsgs();
  polltimer = setInterval(loadmsgs, POLL_MS);
  setTimeout(function() { document.getElementById("tg-inp").focus(); }, 50);
  fetch("/api/dm-inbox/read/" + encodeURIComponent(u), { method: "POST", headers: { "Authorization": "Bearer " + authtoken } }).catch(function() {});
  setTimeout(function() { if (inboxcache.length) renderinbox(inboxcache); }, 150);
}

async function loadmsgs() {
  if (!activeconvo) return;
  try {
    var r = await fetch("/api/dm/" + encodeURIComponent(activeconvo) + "?after=" + lastmsgtime, { headers: { "Authorization": "Bearer " + authtoken } });
    var msgs = await r.json();
    if (!Array.isArray(msgs) || !msgs.length) return;
    var box = document.getElementById("tg-msgs");
    var atbottom = box.scrollHeight - box.scrollTop <= box.clientHeight + 80;
    msgs.forEach(function(m) {
      var dl = new Date(m.time).toLocaleDateString([], { month: "long", day: "numeric" });
      if (dl !== lastdatelabel) {
        var s = document.createElement("div");
        s.className = "tg-datesep";
        s.innerHTML = "<span>" + dl + "</span>";
        box.appendChild(s);
        lastdatelabel = dl;
      }
      box.appendChild(makemsgel(m));
    });
    lastmsgtime = msgs[msgs.length - 1].time;
    if (atbottom) box.scrollTop = box.scrollHeight;
  } catch(_) {}
}

function makemsgel(msg) {
  var mine = msg.from.toLowerCase() === myusername.toLowerCase();
  var w = document.createElement("div");
  w.className = "tg-msg " + (mine ? "mine" : "theirs");
  var ts = new Date(msg.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  w.innerHTML = (!mine ? '<div class="tg-who">' + esc(msg.from) + '</div>' : "")
    + '<div class="tg-bub">' + esc(msg.message) + '</div>'
    + '<div class="tg-meta"><span class="tg-ts">' + ts + '</span>'
    + (mine ? '<span class="tg-tick">✓✓</span>' : "") + '</div>';
  return w;
}

async function senddm() {
  if (!activeconvo) return;
  var inp = document.getElementById("tg-inp");
  var text = inp.value.trim();
  if (!text) return;
  inp.value = "";
  await fetch("/api/dm/" + encodeURIComponent(activeconvo), { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + authtoken }, body: JSON.stringify({ message: text }) });
  loadmsgs();
  loadinbox();
}
document.getElementById("tg-inp").addEventListener("keydown", function(e) { if (e.key === "Enter") senddm(); });

var searchtimer = null;

async function searchusers(q) {
  if (q.length < 2) { document.getElementById("user-list").innerHTML = ""; return; }
  try {
    var r = await fetch("/api/accounts/search?q=" + encodeURIComponent(q), { headers: { "Authorization": "Bearer " + authtoken } });
    var d = await r.json();
    if (d.ok) renderuserlist(d.users);
  } catch(_) {}
}

function renderuserlist(users) {
  var box = document.getElementById("user-list");
  box.innerHTML = "";
  users.forEach(function(u) {
    var el = document.createElement("div");
    el.className = "uitem";
    el.innerHTML = '<div class="uav">' + ini(u) + '</div>' + esc(u);
    el.addEventListener("click", function() { closemodal("modal-newdm"); openconvo(u.toLowerCase()); loadinbox(); });
    box.appendChild(el);
  });
}

function opennewdm() {
  document.getElementById("user-search").value = "";
  document.getElementById("user-list").innerHTML = "";
  openmodal("modal-newdm");
  setTimeout(function() { document.getElementById("user-search").focus(); }, 60);
}

function filterusers() {
  var q = document.getElementById("user-search").value.trim();
  clearTimeout(searchtimer);
  searchtimer = setTimeout(function() { searchusers(q); }, 200);
}

document.getElementById("user-search").addEventListener("input", filterusers);
document.getElementById("user-search").addEventListener("keydown", function(e) { if (e.key === "Escape") closemodal("modal-newdm"); });

function openmodal(id) { document.getElementById(id).style.display = "flex"; }
function closemodal(id) { document.getElementById(id).style.display = "none"; }
function bgclose(e, id) { if (e.target === e.currentTarget) closemodal(id); }

function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function timeago(ts) {
  var d = Date.now() - ts;
  if (d < 60000) return "now";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  if (d < 86400000) return Math.floor(d / 3600000) + "h";
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}
