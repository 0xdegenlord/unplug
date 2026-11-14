import "./style.css";
import { setFinality, loadAccount, loadIntentsKeys, loadStorage, lastUsed, normalizeAccount, formatNear, NETWORK_ID, NET, explorerAccount, explorerTx, explorerBlock } from "./near.js";
import { appInfo } from "./apps.js";
import { drawShareCard } from "./share.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const root = document.getElementById("root");
const RED = "#d8352a", AMB = "#efb026", BLK = "#2b2b2b";
const DARK = { [RED]: "#8f1f17", [AMB]: "#a8780f", [BLK]: "#000" };
const HOLD_MS = 2500;
const plugIcon = (n = 15, c = "currentColor") => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/></svg>`;
const ICON_PLUG = plugIcon();
const ICON_OK = (c = "#fff", s = 12) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="4" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>`;

// wallet is loaded lazily so the landing page stays fast
let W = null, walletAcc = null;
async function wallet() {
  if (!W) {
    W = await import("./wallet.js");
    walletAcc = await W.initWallet();
    W.onWalletChange((a) => { walletAcc = a; onWallet(); });
  }
  return W;
}

const S = { accountId: null, data: null, loading: false, error: null, progress: "", filter: "all", sort: "risk", q: "", selected: new Set(), selI: new Set(), selS: new Set(), open: new Set(), holding: false,
  tab: "all", intents: undefined, storage: undefined, storageProg: "", used: {} };
const YEAR = 365 * 864e5;

// ---------- routing ----------
function route() {
  document.querySelector(".toast")?.remove(); document.querySelector(".sheet")?.remove();
  const m = location.hash.match(/^#\/([^/?]+)/);
  if (m) { const v = decodeURIComponent(m[1]); v.includes(",") ? openMany(v) : openAccount(v); }
  else renderLanding();
}
window.addEventListener("hashchange", route);

function go(accountId) { location.hash = `#/${encodeURIComponent(accountId)}`; }

// ---------- classification ----------
function risk(k) { return k.full ? "full" : k.allowance == null ? "amb" : "fn"; }
const RANK = { full: 0, amb: 1, fn: 2 };
const COLOR = { full: RED, amb: AMB, fn: BLK };
function myKey() {
  if (walletAcc && walletAcc.accountId === S.accountId && walletAcc.publicKey) return walletAcc.publicKey;
  try { return localStorage.getItem(`unplug.myKey.${S.accountId}`); } catch { return null; }
}
function isMine(k) { const m = myKey(); return !!m && m === k.publicKey; }
function monthYear(k) {
  if (!k.createdHeight) return "Before 2021";
  if (!k.createdMs) return "…";
  const d = new Date(k.createdMs).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return k.createdExact ? d : `≈ ${d}`;
}
function describe(k) {
  if (k.full) {
    if (isMine(k)) return { name: "This wallet", sub: "The key your connected wallet uses", ava: "✓", color: "#000" };
    const used = !k.createdHeight ? "use count unknown" : k.uses === 0 ? "never used" : `used ${k.uses.toLocaleString()} ${k.uses === 1 ? "time" : "times"}`;
    const c = fullClue(k);
    return { name: c ? c.title : "Wallet key", sub: c ? (c.title.startsWith("Unused") ? c.sub : `${c.sub}, ${used}`) : `From a wallet or device, ${used}`, ava: "!", color: c?.color || "#8a8f88" };
  }
  const a = appInfo(k.receiverId);
  if (!a.known && k.chainIcon?.name) a.name = k.chainIcon.name;
  const logo = a.logo || k.chainIcon?.icon || null;
  const bits = [];
  if (a.known) bits.push(k.receiverId);
  else if (k.methodNames.length) bits.push(k.methodNames.length === 1 ? `only ${k.methodNames[0]}()` : `${k.methodNames.length} methods`);
  if (k.contract === "deleted") bits.push("app contract is gone");
  else if (k.contract === "no-contract") bits.push("no contract there anymore");
  if (k.uses === 0) bits.push("never used");
  if (!a.known && k.chainIcon?.name) bits.unshift(k.receiverId);
  return { name: a.name, sub: bits.join(", ") || "Any method on this contract", ava: a.letter, color: a.color, logo };
}

// Hints for telling full access keys apart. The chain doesn't say which device added a key,
// but age and use count are strong clues.
function fullClue(k) {
  const fulls = S.data.keys.filter((x) => x.full && !isMine(x));
  if (fulls.length < 2) return null;
  const h = (x) => x.createdHeight ?? 0;
  const oldest = [...fulls].sort((a, b) => h(a) - h(b) || b.uses - a.uses)[0];
  const most = [...fulls].filter((x) => x.createdHeight).sort((a, b) => b.uses - a.uses)[0];
  if (k === oldest) return { title: "Oldest wallet key", sub: "Probably your seed phrase", color: "#5a6b5e" };
  if (k === most && most.uses > 0) return { title: "Most used wallet key", sub: "Probably the wallet you use most", color: "#5a6b5e" };
  if (k.createdHeight && k.uses === 0) return { title: "Unused wallet key", sub: "Never used to sign anything", color: "#b0473c" };
  return null;
}
function counts(keys) {
  const c = { all: keys.length, full: 0, amb: 0, fn: 0 };
  keys.forEach((k) => c[risk(k)]++);
  return c;
}
const MONTH = 30 * 864e5;
function unusedWhy(k) {
  if (isMine(k)) return null;
  if (k.contract === "deleted" || k.contract === "no-contract") return "gone";
  if (k.createdHeight && k.uses === 0) return "never";
  const lu = lastUsedMs(k);
  if (lu && Date.now() - lu > YEAR) return "idle";
  return null;
}
const isRecent = (k) => k.createdMs && Date.now() - k.createdMs < MONTH;
function catKeys(cat, sub = "any") {
  const ks = S.data.keys;
  if (cat === "wallet") {
    const w = ks.filter((k) => k.full);
    if (sub === "this") return w.filter(isMine);
    if (sub === "other") return w.filter((k) => !isMine(k));
    return w;
  }
  if (cat === "apps") return ks.filter((k) => !k.full);
  if (cat === "unused") return ks.filter((k) => { const w = unusedWhy(k); return w && (sub === "any" || sub === w); });
  if (cat === "recent") return ks.filter(isRecent);
  return ks;
}
function visibleKeys() {
  const q = S.q.trim().toLowerCase();
  let ks = catKeys(S.tab, S.filter);
  if (q) ks = ks.filter((k) => { const d = describe(k); return [d.name, k.receiverId, k.publicKey, ...k.methodNames].some((v) => v && v.toLowerCase().includes(q)); });
  const t = (k) => k.createdHeight || 0;
  const sorters = {
    risk: (a, b) => RANK[risk(a)] - RANK[risk(b)] || t(a) - t(b),
    newest: (a, b) => t(b) - t(a),
    oldest: (a, b) => t(a) - t(b),
    used: (a, b) => b.uses - a.uses,
  };
  return ks.sort(sorters[S.sort]);
}
const jackOrder = () => [...S.data.keys].sort((a, b) => RANK[risk(a)] - RANK[risk(b)] || (a.createdHeight || 0) - (b.createdHeight || 0));

// ---------- LANDING ----------
function renderLanding() {
  S.accountId = null; S.data = null;
  document.title = "Unplug: see every app plugged into your NEAR account";
  const form = (id, dark) => `<form class="lookup" data-form="${id}">
      <label class="sr" for="acct-${id}">NEAR account</label>
      <input id="acct-${id}" autocomplete="off" spellcheck="false" placeholder="alice.near" ${id === "top" ? "autofocus" : ""}>
      <button class="btn ${dark ? "b-red" : "b-black"}" type="submit">Check my account</button>
      <div class="err" role="alert"></div></form>`;
  const meter = (l, c) => `<span class="meter">${[1, 2, 3].map((i) => `<i style="--c:${i <= l ? c : "#ddd5c0"}"></i>`).join("")}</span>`;
  const ck = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="4"><path d="M5 12l5 5 9-10"/></svg>`;
  const feats = [
    ["keys", "Every key on your account, in plain words", "Each app you log into adds a key. Unplug lists them all and says what each one can do, when it was added and when it was last used.", "Full control, one app with no gas limit, or one app with a limit.",
      `<div class="card">${[["!", "#5a6b5e", "Wallet key", 3, RED, "2 days ago", 0], ["R", "#3d6b5a", "Ref Finance", 2, AMB, "1 yr ago", 1], ["P", "#7a4a2f", "Paras", 1, BLK, "Never used", 1], ["S", "#5a4fb0", "Skyward Finance", 1, BLK, "App is gone", 1]]
        .map((r, i) => `<div class="lrow drop" style="--d:${i * 120}ms"><span class="ava" style="background:${r[1]}">${r[0]}</span><b>${r[2]}</b>${meter(r[3], r[4])}<span class="${r[6] ? "stale" : "muted"}" style="width:96px;text-align:right">${r[5]}</span></div>`).join("")}</div>`],
    ["intents", "Hidden NEAR Intents keys", "NEAR Intents keeps its own list of keys that can trade and withdraw for you. Removing a key from your account doesn't remove it there. Unplug finds the ones left behind.", "No wallet shows you this list.",
      `<div class="two-col"><div><div class="capt">Your account keys</div><div class="card"><div class="lrow mono">8hFk…7cz</div><div class="lrow mono">3kqP…x0d</div></div></div>
        <div><div class="capt">Keys on NEAR Intents</div><div class="card"><div class="lrow mono">8hFk…7cz<span class="muted r">Also on account</span></div><div class="lrow mono pulse">Zz9r…orph<b class="warnt r">Left behind</b></div></div></div></div>
        <div class="callout">This key can still trade your Intents balance. <b>Remove it.</b></div>`],
    ["stuck", "Get back NEAR stuck in old apps", "Tokens and apps hold a small NEAR deposit for every account that used them. Unplug adds up what you can take back and returns it in one go.", "Tokens you still hold are never touched.",
      `<div class="stuck"><div class="card">${[["R", "#3d6b5a", "Ref Finance", "0.085"], ["C", "#6aa84f", "Cool Token", "0.00125"], ["P", "#9b3d5c", "Potlock", "0.02"], ["M", "#c26b2a", "Meme Cooking", "0.0042"]]
        .map((r, i) => `<div class="lrow slide" style="--d:${i * 140}ms"><span class="ava" style="background:${r[1]}">${r[0]}</span><span style="flex:1">${r[2]}</span><b class="gain">+${r[3]}</b></div>`).join("")}</div>
        <div class="total"><div class="muted">You get back</div><div class="big" data-count="0.11">0.11</div><b>NEAR</b></div></div>`],
    ["tidy", "Clean up in one tap", "Not sure what to remove? One button picks the safe ones: keys never used, apps that no longer exist, keys idle for a year, and NEAR you can get back.", "It never picks a key that can control your whole account.",
      `<span class="btn b-out press" style="background:var(--paper)">Pick the safe ones</span><div class="card" style="margin-top:14px">${[[0, "Wallet key", "never picked"], [1, "Paras", "never used"], [1, "Skyward Finance", "app is gone"], [1, "Ref Farming", "idle 2 years"], [0, "NEAR Social", "used last week"]]
        .map((r, i) => `<div class="lrow ${r[0] ? "tick" : ""}" style="--d:${600 + i * 180}ms"><span class="cbx">${ck}</span><b>${r[1]}</b><span class="muted r">${r[2]}</span></div>`).join("")}</div>`],
    ["accounts", "All your accounts side by side", "Type a few accounts separated by commas and see how many keys each one has and how risky they are.", "Then open any of them to clean it up.",
      [["towhid.near", [RED, RED, RED, AMB, BLK, BLK, BLK, BLK], "17 keys, 5 wallet keys"], ["trading.near", [RED, AMB, AMB, BLK], "4 keys, 1 wallet key"], ["old-airdrop.near", [RED, RED, AMB, AMB, AMB, BLK], "6 keys, 2 wallet keys"]]
        .map((r, i) => `<div class="card acc stack" style="--d:${i * 160}ms"><b>${r[0]}</b><span class="strip">${r[1].map((c, j) => `<i style="background:${c};--d:${i * 160 + 300 + j * 60}ms"></i>`).join("")}</span><span class="muted r">${r[2]}</span></div>`).join("")],
  ];
  root.innerHTML = `
  <div class="landing">
    <div class="hero-wrap">
      <nav><a class="word" href="#/">Unplug</a><div class="navright" id="lnav"></div></nav>
      <div class="board" aria-hidden="true">${landingBoard()}</div>
      <main class="hero">
        <h1>Every app you signed into is still plugged in.</h1>
        <p>See what has access to your NEAR account, remove the ones you don't use, and get back NEAR left in old apps.</p>
        ${form("top")}
        <div class="hint2">Free and read only. Have more than one account? Separate them with commas.</div>
        <div class="jump">${feats.map((f) => `<button data-jump="${f[0]}">${["Every key, explained", "Hidden Intents keys", "Stuck NEAR", "One-tap cleanup", "All your accounts"][feats.indexOf(f)]}</button>`).join("")}</div>
      </main>
    </div>
    <section class="lsec">
      <div class="kick">What Unplug checks</div>
      <h2>Five things your wallet doesn't show you.</h2>
      ${feats.map((f, i) => `<div class="feat ${i % 2 ? "flip" : ""}" id="f-${f[0]}">
        <div class="ftxt"><h3>${f[1]}</h3><p>${f[2]}</p><div class="why">${f[3]}</div></div>
        <div class="vis reveal"><span class="screw" style="left:12px;top:12px"></span><span class="screw" style="right:12px;top:12px"></span>${f[4]}</div></div>`).join("")}
    </section>
    <section class="how"><div class="lsec inner">
      <div class="kick">How it works</div>
      <h2>Look, pick, hold.</h2>
      <div class="steps3 reveal">
        <div class="step"><div class="muted">Step 1</div><h4>Look up an account</h4><p>Type any NEAR account. You don't need a wallet to look.</p><div class="fake">alice.near</div></div>
        <div class="step"><div class="muted">Step 2</div><h4>Pick what to remove</h4><p>Tick keys and deposits, or let one tap pick the safe ones.</p>
          <div class="minis">${[[1, "Paras"], [1, "Old Intents key"], [0, "NEAR Social"]].map((r, i) => `<div class="${r[0] ? "tick" : ""}" style="--d:${300 + i * 250}ms"><span class="cbx">${ck}</span>${r[1]}</div>`).join("")}</div></div>
        <div class="step"><div class="muted">Step 3</div><h4>Slide, then hold</h4><p>Slide to connect your wallet, then hold for 2 seconds. One signature does it all.</p>
          <div class="holddemo"><i></i><span>Hold to remove 3 keys</span></div></div>
      </div>
      <div class="safe">
        <div><b>Read only until you say so</b><span>Looking never needs a wallet.</span></div>
        <div><b>Never adds a key</b><span>Connecting doesn't plug in another app.</span></div>
        <div><b>The wallet you use is protected</b><span>Its key can't be picked.</span></div>
        <div><b>Can't lock you out</b><span>Your last wallet key always stays.</span></div>
      </div>
    </div></section>
    <footer class="lfoot"><h2>What's plugged into yours?</h2>${form("bottom", true)}</footer>
  </div>`;
  root.querySelectorAll("[data-form]").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    const list = f.querySelector("input").value.split(/[\s,]+/).map(normalizeAccount).filter(Boolean);
    if (!list.length) { f.querySelector(".err").textContent = "Type a NEAR account, like alice.near"; return; }
    go([...new Set(list)].join(","));
  }));
  root.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => document.getElementById(`f-${b.dataset.jump}`).scrollIntoView({ behavior: "smooth", block: "center" })));
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in"); io.unobserve(e.target);
    const c = e.target.querySelector("[data-count]");
    if (c) { const to = +c.dataset.count, t0 = performance.now(); const f = (n) => { const p = Math.min(1, (n - t0) / 1200); c.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(2); if (p < 1) requestAnimationFrame(f); }; setTimeout(() => requestAnimationFrame(f), 500); }
  }), { threshold: 0.35 });
  root.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  paintLandingNav();
  wallet().then(paintLandingNav).catch(() => {});
}
function paintLandingNav() {
  const n = $("#lnav"); if (!n) return;
  n.innerHTML = walletAcc
    ? `<button class="btn b-black" id="mine">Open ${esc(walletAcc.accountId)}</button>`
    : `<span class="pillacct solo">NEAR <span class="net">${NETWORK_ID}</span></span><button class="btn b-black" id="lconn">Connect wallet</button>`;
  $("#mine")?.addEventListener("click", () => go(walletAcc.accountId));
  $("#lconn")?.addEventListener("click", async () => { try { (await wallet()).connect(); } catch (e) { console.error(e); } });
}
function socket(x, y, r = 21) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#c9a24b" stroke="#7a5f22" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="${r * .71}" fill="#e0c278"/><circle cx="${x}" cy="${y}" r="${r * .43}" fill="#1d1a14"/>`;
}
function bigPlug(x, y, color, endX, endY, sag) {
  const d = DARK[color], sy = y + 48, p = `M${x} ${sy} C ${x} ${sy + sag}, ${endX} ${endY - 220}, ${endX} ${endY}`;
  return `<path d="${p}" stroke="rgba(0,0,0,.16)" stroke-width="12" fill="none" transform="translate(5,8)"/>
   <path d="${p}" stroke="${d}" stroke-width="11" fill="none" stroke-linecap="round"/><path d="${p}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>
   <rect x="${x - 11}" y="${y + 12}" width="22" height="40" rx="5" fill="${d}"/><rect x="${x - 9}" y="${y + 12}" width="16" height="38" rx="4" fill="${color}"/>
   <rect x="${x - 14}" y="${y + 8}" width="28" height="8" rx="2" fill="#9aa0a3" stroke="#5d6366"/>
   <circle cx="${x}" cy="${y}" r="17" fill="${d}"/><circle cx="${x}" cy="${y - 1}" r="14" fill="${color}"/><ellipse cx="${x - 5}" cy="${y - 6}" rx="5" ry="3" fill="rgba(255,255,255,.35)"/>`;
}
function landingBoard() {
  const L = [["???", "full access", RED, RED], ["burrow", "no gas limit", AMB], ["social.near", "0.25 N", BLK], ["ref-finance", "no gas limit", AMB]];
  const ends = [30, 210, 330, 500];
  let s = `<svg viewBox="0 0 520 1100" preserveAspectRatio="xMidYMin meet">
   <rect x="16" y="18" width="500" height="210" rx="14" fill="rgba(0,0,0,.14)"/>
   <rect x="10" y="8" width="500" height="210" rx="14" fill="#ebe3cd" stroke="#bfb393" stroke-width="1.5"/>
   <rect x="20" y="18" width="480" height="190" rx="8" fill="none" stroke="#d6cbaa"/>`;
  [[32, 30], [488, 30], [32, 196], [488, 196]].forEach(([a, b]) => s += `<circle cx="${a}" cy="${b}" r="6" fill="#c9bd9a" stroke="#9c8f6c"/><line x1="${a - 4}" y1="${b - 4}" x2="${a + 4}" y2="${b + 4}" stroke="#7d7255" stroke-width="1.5"/>`);
  L.forEach(([l, sub, c, lc], i) => {
    const x = 86 + i * 116, y = 138;
    s += `<g transform="rotate(${[-2, 1, -1, 2][i]} ${x} 76)"><rect x="${x - 48}" y="56" width="96" height="40" rx="3" fill="#fbf8ef" stroke="#cfc4a4"/><text x="${x - 40}" y="74" font-family="Kalam" font-size="15.5" fill="${lc || "#1b1b1b"}">${l}</text><text x="${x - 40}" y="89" font-family="Kalam" font-size="11.5" fill="#5a5a52">${sub}</text></g>`;
    s += socket(x, y);
  });
  L.forEach(([, , c], i) => { const x = 86 + i * 116; s += `<g class="sway d${i}">${bigPlug(x, 138, c, ends[i], 1100, 150 + (i % 2) * 60)}</g>`; });
  return s + `</svg>`;
}

// ---------- APP ----------
async function openAccount(raw) {
  const accountId = normalizeAccount(raw);
  if (accountId !== S.accountId) { S.selected.clear(); S.selI.clear(); S.selS.clear(); S.open.clear(); S.filter = "all"; S.q = ""; S.tab = "all"; S.used = {}; }
  S.intents = undefined; S.storage = undefined;
  S.accountId = accountId; S.loading = true; S.error = null; S.data = null; S.progress = "Looking up account";
  document.title = `${accountId} on Unplug`;
  renderApp();
  wallet().then(() => { if (S.accountId === accountId) { paintNav(); paintPanel(); paintDock(); } }).catch(() => {});
  try {
    const data = await loadAccount(accountId, (p) => { S.progress = p; const el = $("#progress"); if (el) el.textContent = p; });
    if (S.accountId !== accountId) return;
    S.data = data; S.loading = false;
    renderApp();
    handleReturn();
    loadExtras(accountId);
  } catch (e) {
    if (S.accountId !== accountId) return;
    S.loading = false;
    S.error = String(e.message).includes("UNKNOWN_ACCOUNT") ? `${accountId} doesn't exist on NEAR ${NETWORK_ID}.` : "Couldn't reach NEAR right now. Try again in a moment.";
    renderApp();
  }
}

function renderApp() {
  root.innerHTML = `
  <div class="app">
    <nav>
      <a class="word" href="#/">Unplug</a>
      <label class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#646a63" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <span class="sr">Search</span><input id="q" placeholder="Search apps, contracts or keys" value="${esc(S.q)}"></label>
      <div class="navright" id="nav"></div>
    </nav>
    <div id="body"></div>
  </div>
  <div class="dock hidden" id="dock"></div>`;
  $("#q").addEventListener("input", (e) => { S.q = e.target.value; paintPanel(); });
  paintNav();
  const body = $("#body");
  if (S.loading) { body.innerHTML = `<div class="state"><h2><span class="loader"></span>Checking ${esc(S.accountId)}</h2><p id="progress">${esc(S.progress)}</p></div>`; return; }
  if (S.error) { body.innerHTML = `<div class="state"><h2>${esc(S.error)}</h2><p><a href="#/">Try another account</a></p></div>`; return; }
  body.innerHTML = `
    <div class="layout">
      <aside class="side" id="side" aria-label="Categories"></aside>
      <div class="main">
        <section class="banner head" id="banner">
          <span class="screw" style="left:12px;top:12px"></span><span class="screw" style="left:12px;bottom:12px"></span>
          <div id="bannertext"></div>
          <svg class="jacks" id="jacks"></svg>
        </section>
        <div class="tiles" id="tiles"></div>
        <div class="sechead" id="sechead"></div>
        <div class="table" role="table" aria-label="Keys on ${esc(S.accountId)}">
          <div class="tr th" role="row" id="thead"></div>
          <div id="rows"></div>
        </div>
      </div>
    </div>`;
  paintBanner(); paintTabs(); paintPanel(); paintDock();
}

function paintNav() {
  const n = $("#nav"); if (!n) return;
  const viewing = S.accountId;
  if (walletAcc && walletAcc.accountId === viewing) {
    n.innerHTML = (S.data && !myKey() ? `<button class="btn b-out" id="findkey">Which key is mine?</button>` : "") +
      `<span class="pillacct">${esc(viewing)} <span class="net">${NETWORK_ID}</span><button class="btn" id="disc">Disconnect</button></span>`;
  } else {
    n.innerHTML = `<span class="pillacct solo">Viewing ${esc(viewing)} <span class="net">read only</span></span>` +
      (walletAcc ? `<button class="btn b-out" id="mine">Open ${esc(walletAcc.accountId)}</button>` : `<button class="btn b-black" id="conn">Connect wallet</button>`);
  }
  $("#findkey")?.addEventListener("click", async () => {
    try {
      const pk = await (await wallet()).findMyKey(S.accountId);
      if (pk) saveMyKey(S.accountId, pk);
    } catch (e) { toast({ error: true, title: "Couldn't check the key", body: esc(String(e.message || e).slice(0, 160)) }); }
  });
  $("#disc")?.addEventListener("click", async () => { await (await wallet()).disconnect(); });
  $("#conn")?.addEventListener("click", async () => { try { (await wallet()).connect(); } catch (e) { console.error(e); toast({ error: true, title: "Couldn't open wallets", body: "Refresh the page and try again." }); } });
  $("#mine")?.addEventListener("click", () => go(walletAcc.accountId));
}

function saveMyKey(accountId, pk) {
  try { localStorage.setItem(`unplug.myKey.${accountId}`, pk); } catch {}
  S.selected.delete(pk);
  const found = S.data?.keys.some((k) => k.publicKey === pk);
  toast({ title: found ? "Found your key" : "Your wallet uses a different key", body: found ? "It's marked as Your login and can't be unplugged. Any other full access key is one this wallet doesn't use." : "This wallet signed with a key that isn't on this account." });
  if (S.data) { paintNav(); paintBanner(); paintPanel(); paintDock(); }
}
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function paintBanner() {
  const d = S.data, c = counts(d.keys);
  const line = c.full <= 1 && c.amb === 0 ? "Nothing risky here. Only what you need is plugged in."
    : c.full >= 2 ? `${c.full} have full control of your account. You only need one, plus a backup.`
    : `${plural(c.amb, "app key has", "app keys have")} no gas limit.`;
  $("#bannertext").innerHTML = `
    <h1>${plural(d.keys.length, "key", "keys")} on ${esc(d.accountId)}</h1>
    <div class="bs">${esc(line)}</div>
    <div class="meta"><span>Balance ${formatNear(d.balance, 2)} NEAR</span><a href="${explorerAccount(d.accountId)}" target="_blank" rel="noopener">See on NearBlocks</a><button class="copy" id="refresh" style="margin:0">Refresh</button></div>`;
  $("#refresh").addEventListener("click", () => openAccount(S.accountId));
  paintJacks(); paintTiles();
}
function paintTiles() {
  const el = $("#tiles"); if (!el || !S.data) return;
  const wallets = S.data.keys.filter((k) => k.full).length;
  const unused = catKeys("unused").length;
  const got = (S.storage || []).reduce((t, x) => t + BigInt(x.reclaim), 0n);
  const mineKnown = !!myKey();
  const connected = walletAcc && walletAcc.accountId === S.accountId;
  el.innerHTML = `
    <div class="tile"><div class="n red">${wallets}</div><div class="l">${wallets === 1 ? "Wallet key" : "Wallet keys"} with full control</div>
      ${wallets > 1 ? `<button class="go" data-act="${mineKnown ? "cat:wallet" : connected ? "findkey" : "connect"}">${mineKnown ? "See which are other wallets" : connected ? "Check which one is yours" : "Connect to see which is yours"}</button>` : `<span class="go muted">That's all you need</span>`}</div>
    <div class="tile"><div class="n amb">${unused}</div><div class="l">${unused === 1 ? "Key" : "Keys"} unused or for apps that are gone</div>
      ${unused ? `<button class="go" data-act="tidy">Pick the safe ones</button>` : `<span class="go muted">Nothing to clean</span>`}</div>
    <div class="tile"><div class="n grn">${S.storage === undefined ? "…" : formatNear(got, 3)} <span>NEAR</span></div><div class="l">You can get back from old apps</div>
      ${S.storage === undefined ? `<span class="go muted">Checking your apps…</span>` : got > 0n ? `<button class="go" data-act="cat:storage">See where</button>` : `<span class="go muted">Nothing left behind</span>`}</div>`;
}
function paintJacks(pull = 0) {
  const svg = $("#jacks"); if (!svg) return;
  const extra = S.data.keys.length > 16;
  const ks = jackOrder().slice(0, 16), gap = 45, w = ks.length * gap + 10 + (extra ? 70 : 0), h = 130;
  svg.setAttribute("width", w); svg.setAttribute("height", h); svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  let s = "";
  ks.forEach((k, i) => {
    const x = 24 + i * gap, y = 26, c = COLOR[risk(k)], d = DARK[c];
    s += socket(x, y, 15);
    const p = S.selected.has(k.publicKey) ? pull : 0;
    const bend = ((i % 3) - 1) * 12;
    s += `<g class="plug" style="transform:translate(0px,${p * 26}px) rotate(${p * (i % 2 ? 8 : -8)}deg);transform-origin:${x}px ${y}px;opacity:${1 - p * .25}">
      ${p > 0 ? `<rect x="${x - 3}" y="${y - 30}" width="6" height="${Math.min(24, p * 30)}" rx="2" fill="#b8bec1" stroke="#5d6366"/>` : ""}
      <path d="M${x} ${y + 30} C ${x} ${y + 60}, ${x + bend} ${y + 75}, ${x + bend * .8} ${y + 104}" stroke="${d}" stroke-width="8" fill="none"/>
      <path d="M${x} ${y + 30} C ${x} ${y + 60}, ${x + bend} ${y + 75}, ${x + bend * .8} ${y + 104}" stroke="${c}" stroke-width="5" fill="none"/>
      <rect x="${x - 7}" y="${y + 8}" width="14" height="26" rx="4" fill="${d}"/><rect x="${x - 6}" y="${y + 8}" width="10" height="25" rx="3" fill="${c}"/>
      <circle cx="${x}" cy="${y}" r="12" fill="${d}"/><circle cx="${x}" cy="${y - 1}" r="10" fill="${c}"/><ellipse cx="${x - 3}" cy="${y - 5}" rx="3.5" ry="2" fill="rgba(255,255,255,.35)"/></g>`;
  });
  if (extra) s += `<text x="${w - 4}" y="32" text-anchor="end" font-size="14" font-weight="600" fill="#646a63">+${S.data.keys.length - 16}</text><text x="${w - 4}" y="50" text-anchor="end" font-size="12" fill="#646a63">more</text>`;
  svg.innerHTML = s;
}

function locked(k) {
  if (isMine(k)) return "mine";
  // Never let the last full access key go: the account would be locked forever.
  if (k.full) {
    const fulls = S.data.keys.filter((x) => x.full);
    const others = fulls.filter((x) => x.publicKey !== k.publicKey && !S.selected.has(x.publicKey));
    if (!S.selected.has(k.publicKey) && others.length === 0) return "last";
  }
  return null;
}

function paintTable() {
  const rowsEl = $("#rows"); if (!rowsEl || !S.data) return;
  const ks = visibleKeys();
  if (!ks.length) { rowsEl.innerHTML = `<div class="empty">${S.q ? "Nothing matches that search." : "No keys in this group."}</div>`; return; }
  rowsEl.innerHTML = ks.map((k) => {
    const d = describe(k), r = risk(k), sel = S.selected.has(k.publicKey), lk = locked(k), open = S.open.has(k.publicKey);
    const lvl = r === "full" ? 3 : r === "amb" ? 2 : 1;
    const meter = `<span class="meter" aria-hidden="true">${[1, 2, 3].map((i) => `<i style="background:${i <= lvl ? COLOR[r] : "#ddd5c0"}"></i>`).join("")}</span>`;
    const chip = `<span class="perm">${meter}<span><b>${lvl === 3 ? "Full control" : lvl === 2 ? "One app, no gas limit" : "One app, limited"}</b>${k.methodNames.length ? `<small>${esc(k.methodNames.slice(0, 3).join(", ") + (k.methodNames.length > 3 ? ` +${k.methodNames.length - 3}` : ""))}</small>` : ""}</span></span>`;
    const gas = 0 && k.full ? `<span class="muted">All</span>` : k.allowance == null ? `<span class="muted">No limit</span>` : `<span class="muted">${formatNear(k.allowance)} NEAR</span>`;
    const act = lk === "mine" ? `<span class="mine">In use here</span>` : lk === "last" ? `<span class="mine">Your only wallet key</span>`
      : `<button class="unplug ${k.full ? "full" : ""}" data-unplug="${esc(k.publicKey)}">Remove</button>`;
    return `<div class="tr row ${sel ? "sel" : ""} ${sel && S.holding ? "pulling" : ""}" role="row" data-pk="${esc(k.publicKey)}" aria-expanded="${open}">
      <span><button class="cb ${sel ? "on" : ""}" data-cb="${esc(k.publicKey)}" ${lk ? "disabled" : ""} aria-label="Select ${esc(d.name)}" aria-pressed="${sel}">${sel ? ICON_OK() : ""}</button></span>
      <span class="appc">${d.logo ? `<span class="ava logo" style="background:#fff"><img src="${esc(d.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.style.background='${d.color}';this.parentNode.textContent='${esc(d.ava)}'"></span>` : `<span class="ava" style="background:${d.color}">${esc(d.ava)}</span>`}<span style="min-width:0"><b>${esc(d.name)}</b><small>${esc(d.sub)}</small></span></span>
      <span class="c-perm">${chip}</span>
      <span class="c-gas">${usedShort(k)}</span>
      <span class="c-added muted">${monthYear(k)}</span>
      <span class="c-act" style="justify-self:end">${act}</span>
    </div>
    <dl class="detail ${open ? "open" : ""}">
      <div class="wide"><dt>Public key</dt><dd>${esc(k.publicKey)}<button class="copy" data-copy="${esc(k.publicKey)}">Copy</button></dd></div>
      <div><dt>Can call</dt><dd>${k.full ? "Anything, including sending all tokens, adding keys and deleting the account" : k.methodNames.length ? esc(k.methodNames.join(", ")) : `Any method on ${esc(k.receiverId)}`}</dd></div>
      <div><dt>Contract</dt><dd>${k.full ? "Not limited to one" : `<a href="${explorerAccount(k.receiverId)}" target="_blank" rel="noopener">${esc(k.receiverId)}</a>${k.contract === "deleted" ? " (account deleted)" : k.contract === "no-contract" ? " (no contract deployed)" : ""}`}</dd></div>
      <div><dt>Gas allowance left</dt><dd>${k.full ? "Unlimited" : k.allowance == null ? "Unlimited" : `${formatNear(k.allowance, 6)} NEAR`}</dd></div>
      <div><dt>Times used</dt><dd>${k.createdHeight ? k.uses.toLocaleString() : "Unknown (older key)"}</dd></div>
      <div><dt>Added</dt><dd>${k.createdMs ? new Date(k.createdMs).toLocaleString("en-US", { dateStyle: "medium", timeStyle: k.createdExact ? "short" : undefined }) + (k.createdExact ? "" : " (estimated)") : "Before 2021"}${k.createdHeight ? `, <a href="${explorerBlock(k.createdHeight)}" target="_blank" rel="noopener">block ${k.createdHeight.toLocaleString()}</a>` : ""}</dd></div>
      <div><dt>Last used</dt><dd>${lastUsedText(k, true)}</dd></div>
      <div><dt>Nonce</dt><dd>${k.nonce.toLocaleString()}</dd></div>
    </dl>`;
  }).join("");
}

// table interactions (delegated once)
document.addEventListener("click", (e) => {
  const tb = e.target.closest("[data-tab]");
  if (tb) { S.tab = tb.dataset.tab; S.filter = "any"; paintTabs(); paintPanel(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const sb = e.target.closest("[data-sub]");
  if (sb) { S.filter = sb.dataset.sub; paintPanel(); return; }
  const ac = e.target.closest("[data-act]");
  if (ac) {
    const a = ac.dataset.act;
    if (a === "tidy") tidyUp();
    else if (a === "findkey") $("#findkey")?.click();
    else if (a === "connect") wallet().then((w) => w.connect()).catch(() => {});
    else if (a.startsWith("cat:")) { S.tab = a.slice(4); S.filter = a === "cat:wallet" ? "other" : "any"; paintTabs(); paintPanel(); }
    else if (a === "pickall") { (S.storage || []).forEach((x) => { if (BigInt(x.reclaim) > 0n) S.selS.add(x.contract); }); afterSelect(); }
    return;
  }
  const ci = e.target.closest("[data-ci]"), cs = e.target.closest("[data-cs]");
  if (ci) { const v = ci.dataset.ci; S.selI.has(v) ? S.selI.delete(v) : S.selI.add(v); afterSelect(); return; }
  if (cs) { if (cs.disabled) return; const v = cs.dataset.cs; S.selS.has(v) ? S.selS.delete(v) : S.selS.add(v); afterSelect(); return; }
  const cb = e.target.closest("[data-cb]"), un = e.target.closest("[data-unplug]"), cp = e.target.closest("[data-copy]");
  if (cp) { navigator.clipboard?.writeText(cp.dataset.copy); cp.textContent = "Copied"; setTimeout(() => (cp.textContent = "Copy"), 1200); return; }
  if (cb) { if (cb.disabled) return; toggle(cb.dataset.cb); return; }
  if (un) { S.selected = new Set([un.dataset.unplug]); S.selI.clear(); S.selS.clear(); afterSelect(); $("#dock")?.scrollIntoView?.({ block: "nearest" }); return; }
  const row = e.target.closest(".row");
  if (row && !e.target.closest("a")) { const pk = row.dataset.pk; S.open.has(pk) ? S.open.delete(pk) : S.open.add(pk); paintPanel(); }
});
function toggle(pk) { S.selected.has(pk) ? S.selected.delete(pk) : S.selected.add(pk); afterSelect(); }
function afterSelect() { paintPanel(); paintTabs(); paintJacks(); paintDock(); }

// ---------- dock: slide to connect / hold to unplug ----------
function onWallet() {
  if (S.accountId && S.data) { paintNav(); paintBanner(); paintPanel(); paintDock(); }
  else if (S.accountId) paintNav();
  else paintLandingNav();
  if (!S.accountId && walletAcc && sessionStorage.getItem("unplug.goMine")) { sessionStorage.removeItem("unplug.goMine"); go(walletAcc.accountId); }
}

function selectedKeys() { return S.data ? S.data.keys.filter((k) => S.selected.has(k.publicKey)) : []; }

function selection() {
  const keys = selectedKeys();
  const ikeys = [...S.selI];
  const storage = (S.storage || []).filter((x) => S.selS.has(x.contract));
  const near = storage.reduce((t, x) => t + BigInt(x.reclaim), 0n);
  return { keys, ikeys, storage, near, total: keys.length + ikeys.length + storage.length };
}
function actionLabel(sel) {
  const unplug = sel.keys.length + sel.ikeys.length;
  const parts = [];
  if (unplug) parts.push(`remove ${plural(unplug, "key", "keys")}`);
  if (sel.storage.length) parts.push(`get back ${formatNear(sel.near, 4)} NEAR`);
  return parts.join(" and ");
}
function paintDock() {
  const dock = $("#dock"); if (!dock) return;
  const sel = selection();
  if (!sel.total || !S.data) { dock.classList.add("hidden"); dock.innerHTML = ""; return; }
  dock.classList.remove("hidden");
  const label = `${sel.total} picked`;
  const fullSel = sel.keys.filter((k) => k.full).length;
  const keepsFull = S.data.keys.some((k) => k.full && !S.selected.has(k.publicKey));
  const top = !keepsFull ? `<div class="note warn">Keep at least one full access key, or no one can ever use this account again.</div>`
    : fullSel ? `<div class="note warn">${plural(fullSel, "full access key", "full access keys")} selected. Make sure the key you keep is the one you have a backup of.</div>` : "";
  const what = actionLabel(sel);

  if (!walletAcc) {
    dock.innerHTML = `${top}<div class="dockrow"><div class="count">${label}</div>
      <div class="bar" id="slide" role="slider" aria-label="Slide to connect wallet" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
        <div class="lbl">Slide to connect your wallet <span style="opacity:.5">››</span></div>
        <div class="knob" id="knob">${plugIcon(22, "#fff")}</div></div></div>`;
    bindSlide();
    return;
  }
  if (walletAcc.accountId !== S.accountId) {
    dock.innerHTML = `<div class="dockrow"><div class="count">${label}</div>
      <button class="bar light" id="switch"><span class="lbl">Connected as ${esc(walletAcc.accountId)}. Switch to ${esc(S.accountId)} to continue</span></button></div>`;
    $("#switch").addEventListener("click", async () => { const w = await wallet(); await w.disconnect(); w.connect(); });
    return;
  }
  const holdText = what.charAt(0).toUpperCase() + what.slice(1);
  dock.innerHTML = `<div class="steps hidden" id="steps"></div>${top}<div class="dockrow"><div class="count">${label}</div>
    <div class="bar hold" id="hold" role="button" tabindex="0" aria-label="Hold to ${esc(what)}" ${keepsFull ? "" : 'aria-disabled="true" style="opacity:.45;cursor:not-allowed"'}>
      <div class="fill" id="fill"></div><div class="lbl" id="hlbl">${plugIcon(20)}Hold to ${esc(what)}</div></div></div>`;
  if (keepsFull) bindHold(sel, holdText);
}

function bindSlide() {
  const bar = $("#slide"), knob = $("#knob");
  let startX = 0, max = 0, x = 0, dragging = false;
  const set = (v) => { x = Math.max(0, Math.min(max, v)); knob.style.left = `${6 + x}px`; bar.querySelector(".lbl").style.opacity = String(1 - (x / max) * .8); bar.setAttribute("aria-valuenow", Math.round((x / max) * 100)); };
  const done = async () => {
    set(max);
    try { (await wallet()).connect(); }
    catch (e) { console.error(e); toast({ error: true, title: "Couldn't open wallets", body: "Refresh the page and try again." }); }
    finally { setTimeout(() => { knob.classList.remove("drag"); set(0); }, 400); }
  };
  knob.addEventListener("pointerdown", (e) => { dragging = true; knob.setPointerCapture(e.pointerId); knob.classList.add("drag"); max = bar.clientWidth - 64; startX = e.clientX - x; });
  knob.addEventListener("pointermove", (e) => { if (dragging) set(e.clientX - startX); });
  const up = () => { if (!dragging) return; dragging = false; knob.classList.remove("drag"); if (x >= max * .92) done(); else set(0); };
  knob.addEventListener("pointerup", up); knob.addEventListener("pointercancel", up);
  bar.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") { e.preventDefault(); max = bar.clientWidth - 64; done(); } });
}

function bindHold(sel, holdText) {
  const bar = $("#hold"), fill = $("#fill"), lbl = $("#hlbl"), steps = $("#steps");
  const txCount = (sel.keys.length ? 1 : 0) + (sel.ikeys.length ? 1 : 0) + sel.storage.length;
  const doing = [sel.keys.length + sel.ikeys.length ? `${plural(sel.keys.length + sel.ikeys.length, "key", "keys")}` : "", sel.storage.length ? `${formatNear(sel.near, 4)} NEAR` : ""].filter(Boolean).join(" + ");
  let t0 = 0, raf = 0, active = false, finished = false;
  const st = (p) => {
    const ic = (state) => state === "ok" ? ICON_OK("#2f5a33", 14) : state === "wait" ? `<span class="ic-wait"></span>` : `<span class="ic-todo"></span>`;
    const a = p > .3 ? "ok" : "wait", b = p >= 1 ? "ok" : p > .3 ? "wait" : "todo", c = p >= 1 ? "ok" : "todo";
    steps.innerHTML = `<span>${ic(a)}${plural(txCount, "transaction", "transactions")} built</span><span class="${b === "todo" ? "todo" : ""}">${ic(b)}${p >= 1 ? `${doing} ready` : `Preparing ${doing}`}</span><span class="${c === "todo" ? "todo" : ""}">${ic(c)}${S.data.keys.some((k) => isMine(k)) ? "Your login stays" : "Your other keys stay"}</span>`;
  };
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / HOLD_MS);
    fill.style.width = `${p * 100}%`; paintJacks(p); st(p);
    lbl.innerHTML = `${plugIcon(20)}${p < 1 ? "Keep holding" : "Opening wallet…"}`;
    if (p < 1) raf = requestAnimationFrame(frame); else complete();
  };
  const start = (e) => {
    if (active || finished) return; e?.preventDefault?.();
    active = true; S.holding = true; t0 = performance.now(); steps.classList.remove("hidden");
    document.querySelectorAll(".row.sel").forEach((r) => r.classList.add("pulling"));
    raf = requestAnimationFrame(frame);
  };
  const cancel = () => {
    if (!active || finished) return;
    active = false; S.holding = false; cancelAnimationFrame(raf);
    fill.style.transition = "width .25s"; fill.style.width = "0"; setTimeout(() => (fill.style.transition = ""), 260);
    paintJacks(0); steps.classList.add("hidden");
    document.querySelectorAll(".row.pulling").forEach((r) => r.classList.remove("pulling"));
    lbl.innerHTML = `${plugIcon(20)}Hold to ${esc(holdText.charAt(0).toLowerCase() + holdText.slice(1))}`;
  };
  const complete = async () => {
    finished = true; active = false;
    const pks = sel.keys.map((k) => k.publicKey);
    const pending = { accountId: S.accountId, pks, ikeys: sel.ikeys, storage: sel.storage.map((x) => x.contract), near: sel.near.toString(),
      removed: [...sel.keys.map((k) => COLOR[risk(k)]), ...sel.ikeys.map(() => RED)], removedFull: sel.keys.filter((k) => k.full).length, at: Date.now() };
    sessionStorage.setItem("unplug.pending", JSON.stringify(pending));
    try {
      const outs = await (await wallet()).unplugAll(S.accountId, { keys: pks, intentsKeys: sel.ikeys, storage: sel.storage }, NET.intents);
      // Popup / extension wallets return here; redirect wallets come back via the URL instead.
      if (outs && outs.length) {
        sessionStorage.removeItem("unplug.pending");
        const failed = outs.find((o) => o?.status?.Failure);
        if (failed && outs.length === 1) throw new Error(JSON.stringify(failed.status.Failure).slice(0, 160));
        const last = outs[outs.length - 1];
        success(pending, last?.transaction?.hash || last?.transaction_outcome?.id, failed);
      }
    } catch (err) {
      sessionStorage.removeItem("unplug.pending");
      S.holding = false; paintJacks(0); paintDock(); paintPanel();
      toast({ error: true, title: "Nothing was unplugged", body: friendlyErr(err) });
    }
  };
  bar.addEventListener("pointerdown", start);
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => bar.addEventListener(ev, cancel));
  bar.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
  bar.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") cancel(); });
}
function friendlyErr(err) {
  const m = String(err?.message || err || "");
  if (/reject|cancel|denied|closed/i.test(m)) return "You closed the wallet before signing. Your keys are untouched.";
  return m ? `The wallet said: ${m.slice(0, 160)}` : "The wallet didn't finish. Your keys are untouched.";
}


// ---------- extras: intents keys, storage deposits, last used ----------
async function loadExtras(accountId, refresh = false) {
  loadIntentsKeys(accountId).then((ks) => { if (S.accountId !== accountId) return; S.intents = ks; paintTabs(); if (S.tab === "intents") paintPanel(); });
  const contracts = [...new Set(S.data.keys.filter((k) => k.receiverId).map((k) => k.receiverId))];
  loadStorage(accountId, contracts, (d, t) => { if (S.accountId !== accountId) return; S.storageProg = `${d} of ${t}`; if (S.tab === "storage" && !S.storage) paintPanel(); })
    .then((rows) => { if (S.accountId !== accountId) return; S.storage = rows.sort((a, b) => (BigInt(b.reclaim) > BigInt(a.reclaim) ? 1 : -1)); paintTabs(); if (S.tab === "storage") paintPanel(); })
    .catch(() => { if (S.accountId === accountId) { S.storage = []; paintTabs(); } });
  if (!refresh) findLastUsed(accountId);
}
async function findLastUsed(accountId) {
  const keys = S.data.keys.filter((k) => k.createdHeight && k.uses > 0);
  let i = 0;
  const worker = async () => {
    while (i < keys.length) {
      const k = keys[i++];
      const cacheKey = `unplug.used.${k.publicKey}.${k.nonce}`;
      let v = null;
      try { v = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch {}
      if (!v) { try { v = await lastUsed(accountId, k, S.data.blockHeight); if (v) localStorage.setItem(cacheKey, JSON.stringify(v)); } catch { v = { failed: true }; } }
      if (S.accountId !== accountId) return;
      S.used[k.publicKey] = v;
      const cell = document.querySelector(`.row[data-pk="${CSS.escape(k.publicKey)}"] .c-gas`);
      if (cell) { cell.innerHTML = usedShort(k); if (S.tab === "unused") paintTabs(); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
function lastUsedMs(k) { const v = S.used[k.publicKey]; return v && v.ms ? v.ms : null; }
function ago(ms) {
  const d = (Date.now() - ms) / 864e5;
  if (d < 1) return "today"; if (d < 2) return "yesterday"; if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`; const y = Math.floor(d / 365); return `${y} yr${y > 1 ? "s" : ""} ago`;
}
function lastUsedText(k, long) {
  if (!k.createdHeight) return "Unknown (older key)";
  if (k.uses === 0) return "Never";
  const v = S.used[k.publicKey];
  if (!v) return long ? "Checking history…" : "checking…";
  if (v.failed) return "Couldn't check";
  return long ? `${new Date(v.ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}${v.exact ? "" : " (estimated)"}, <a href="${explorerBlock(v.height)}" target="_blank" rel="noopener">block ${v.height.toLocaleString()}</a>` : ago(v.ms);
}
function usedShort(k) {
  const lu = lastUsedText(k, false);
  const stale = k.uses === 0 || (lastUsedMs(k) && Date.now() - lastUsedMs(k) > YEAR);
  const txt = lu === "Never" ? "Never" : lu.charAt(0).toUpperCase() + lu.slice(1);
  return `<span class="${stale ? "stale" : "muted"}">${txt}</span>`;
}
function usedCell(k) {
  const lu = lastUsedText(k, false);
  const stale = k.uses === 0 || (lastUsedMs(k) && Date.now() - lastUsedMs(k) > YEAR);
  return `<span class="two"><span class="muted">Added ${monthYear(k)}</span><small class="${stale ? "stale" : ""}">Used ${lu === "Never" ? "never" : lu}</small></span>`;
}

// One tap: select everything that is clearly safe to remove. Never touches full access keys.
function tidyUp() {
  const now = Date.now();
  S.selected.clear();
  for (const k of S.data.keys) {
    if (k.full || locked(k)) continue;
    const dead = k.contract === "deleted" || k.contract === "no-contract";
    const lu = lastUsedMs(k) || (k.uses === 0 ? null : k.createdMs);
    const old = lu ? now - lu > YEAR : false;
    if (k.uses === 0 || dead || old) S.selected.add(k.publicKey);
  }
  const keySet = new Set(S.data.keys.map((k) => k.publicKey));
  (S.intents || []).forEach((pk) => { if (!keySet.has(pk)) S.selI.add(pk); });
  (S.storage || []).forEach((x) => { if (BigInt(x.reclaim) > 0n) S.selS.add(x.contract); });
  afterSelect();
  const n = S.selected.size + S.selI.size + S.selS.size;
  S.tab = "unused"; S.filter = "any"; paintTabs(); paintPanel();
  toast({ title: n ? `Picked ${plural(n, "item", "items")}` : "Nothing obvious to remove", body: n ? "Keys never used, idle for a year or for apps that are gone, Intents keys left behind and NEAR you can get back. Check them, then hold to confirm. Wallet keys are never picked." : "Everything here looks in use." });
}

// ---------- tabs ----------
const CATS = [
  ["all", "All keys", "Everything that can sign for you"],
  ["wallet", "Wallet keys", "Can do anything with your account"],
  ["apps", "App keys", "Each limited to one app"],
  ["unused", "Unused", "Never used, idle a year, or app gone"],
  ["recent", "Added recently", "In the last 30 days"],
  null,
  ["intents", "Intents keys", "Can trade on NEAR Intents"],
  ["storage", "NEAR to get back", "Left behind in old apps"],
];
function catCount(id) {
  if (id === "intents") return S.intents === undefined ? "…" : S.intents === null ? "?" : S.intents.length;
  if (id === "storage") return S.storage === undefined ? "…" : formatNear(S.storage.reduce((t, x) => t + BigInt(x.reclaim), 0n), 3);
  return catKeys(id).length;
}
function catPicked(id) {
  if (id === "intents") return S.selI.size;
  if (id === "storage") return S.selS.size;
  return catKeys(id).filter((k) => S.selected.has(k.publicKey)).length;
}
function paintTabs() {
  const el = $("#side"); if (!el || !S.data) return;
  el.innerHTML = CATS.map((c) => {
    if (!c) return `<div class="sdiv"></div>`;
    const [id, name, desc] = c, p = catPicked(id);
    return `<button class="cat ${S.tab === id ? "on" : ""}" data-tab="${id}" aria-current="${S.tab === id}"><span class="ct"><span class="cn">${name}</span><small>${desc}</small></span>
      <span class="cr"><b>${catCount(id)}</b>${p ? `<span class="badge">${p} picked</span>` : ""}</span></button>`;
  }).join("");
  paintTiles();
}
const SEC = {
  all: ["All keys", "Every key that can sign for this account. Tick the ones you don't use."],
  wallet: ["Wallet keys", "Each of these can do anything with your account. You only need one, plus a backup."],
  apps: ["App keys", "Added when you signed into an app. Each one only works with that app."],
  unused: ["Unused", "Keys you probably don't need anymore. Wallet keys are never picked for you."],
  recent: ["Added recently", "Keys added in the last 30 days. Check you recognise every one."],
};
function paintPanel() {
  if (!S.data || !$("#rows")) return;
  if (S.tab === "intents") return paintIntents();
  if (S.tab === "storage") return paintStorage();
  const [title, desc] = SEC[S.tab] || SEC.all;
  const subs = S.tab === "unused" ? [["any", "Any reason"], ["never", "Never used"], ["idle", "Idle a year"], ["gone", "App gone"]]
    : S.tab === "wallet" && myKey() ? [["any", "All"], ["this", "This wallet"], ["other", "Other wallets"]] : null;
  if (!subs || !subs.some(([id]) => id === S.filter)) S.filter = "any";
  $("#sechead").innerHTML = `<div><h2>${title}</h2><p>${desc}</p>
    ${subs ? `<div class="subs">${subs.map(([id, l]) => `<button class="sub ${S.filter === id ? "on" : ""}" data-sub="${id}">${l} <b>${catKeys(S.tab, id).length}</b></button>`).join("")}</div>` : ""}</div>
    <div class="secact">
      <label class="sort">Sort <select id="sort">
        <option value="risk"${S.sort === "risk" ? " selected" : ""}>Riskiest first</option>
        <option value="newest"${S.sort === "newest" ? " selected" : ""}>Newest</option>
        <option value="oldest"${S.sort === "oldest" ? " selected" : ""}>Oldest</option>
        <option value="used"${S.sort === "used" ? " selected" : ""}>Most used</option></select></label>
      ${S.tab === "wallet" ? "" : `<button class="btn b-out" data-act="tidy">Pick the safe ones</button>`}</div>`;
  $("#sort").addEventListener("change", (e) => { S.sort = e.target.value; paintTable(); });
  $("#thead").className = "tr th"; $("#thead").innerHTML = `<span></span><span>App</span><span>What it can do</span><span>Last used</span><span>Added</span><span></span>`;
  paintTable();
}
function paintTools() { paintPanel(); }
function paintIntents() {
  const rows = $("#rows");
  $("#thead").className = "tr th ti"; $("#thead").innerHTML = `<span></span><span>Key</span><span>What it can do</span><span>Also on your account?</span><span></span>`;
  $("#sechead").innerHTML = `<div><h2>Intents keys</h2><p>NEAR Intents keeps its own list of keys that can trade and withdraw for ${esc(S.accountId)}. Removing a key from your account doesn't remove it here.</p></div>`;
  if (S.intents === undefined) { rows.innerHTML = `<div class="empty"><span class="loader"></span>Reading ${esc(NET.intents)}…</div>`; return; }
  if (S.intents === null) { rows.innerHTML = `<div class="empty">Couldn't read NEAR Intents right now. Press Refresh to try again.</div>`; return; }
  if (!S.intents.length) { rows.innerHTML = `<div class="empty">No NEAR Intents keys on this account. Nothing to clean up here.</div>`; return; }
  const onAcct = new Set(S.data.keys.map((k) => k.publicKey));
  const meter = `<span class="meter" aria-hidden="true">${[1, 2, 3].map(() => `<i style="background:${RED}"></i>`).join("")}</span>`;
  rows.innerHTML = S.intents.filter((pk) => !S.q || pk.toLowerCase().includes(S.q.toLowerCase())).map((pk) => {
    const sel = S.selI.has(pk), on = onAcct.has(pk), mine = myKey() === pk;
    return `<div class="tr row ti ${sel ? "sel" : ""}" role="row">
      <span><button class="cb ${sel ? "on" : ""}" data-ci="${esc(pk)}" aria-pressed="${sel}" aria-label="Select key">${sel ? ICON_OK() : ""}</button></span>
      <span class="appc"><span class="ava" style="background:#1f1f1f">I</span><span style="min-width:0"><b>${mine ? "This wallet, on Intents" : "Intents key"}</b><small>${esc(pk.slice(0, 18))}…${esc(pk.slice(-6))} <button class="copy" data-copy="${esc(pk)}">Copy</button></small></span></span>
      <span class="perm">${meter}<span><b>Trade and withdraw</b><small>Your NEAR Intents balance</small></span></span>
      <span>${on ? `<span class="muted">Yes</span>` : `<b class="warnt">No, left behind</b>`}</span>
      <span style="justify-self:end"><button class="unplug full" data-ci="${esc(pk)}">${sel ? "Picked" : "Remove"}</button></span>
    </div>`;
  }).join("");
}
function paintStorage() {
  const rows = $("#rows");
  $("#thead").className = "tr th ts"; $("#thead").innerHTML = `<span></span><span>App or token</span><span>Held</span><span>You get back</span><span>Why</span><span></span>`;
  const any = (S.storage || []).some((x) => BigInt(x.reclaim) > 0n);
  $("#sechead").innerHTML = `<div><h2>NEAR to get back</h2><p>Apps and tokens hold a small deposit from you. Take back what they no longer need. Tokens you still hold are left alone.</p></div>
    ${any ? `<div class="secact"><button class="btn b-out" data-act="pickall">Pick all I can get back</button></div>` : ""}`;
  if (S.storage === undefined) { rows.innerHTML = `<div class="empty"><span class="loader"></span>Checking your apps and tokens ${esc(S.storageProg)}…</div>`; return; }
  if (!S.storage.length) { rows.innerHTML = `<div class="empty">No deposits found in your apps or tokens.</div>`; return; }
  rows.innerHTML = S.storage.filter((x) => !S.q || x.contract.includes(S.q.toLowerCase())).map((x) => {
    const a = appInfo(x.contract), name = a.known ? a.name : x.metaName || x.contract, logo = a.logo || x.icon;
    const can = BigInt(x.reclaim) > 0n, sel = S.selS.has(x.contract);
    const why = x.method === "storage_withdraw" ? "Spare deposit the app isn't using" : x.method === "storage_unregister" ? "You hold none of this token" : x.tokenBalance && x.tokenBalance !== "0" ? "You still hold this token" : "The app still needs it";
    return `<div class="tr row ts ${sel ? "sel" : ""}" role="row">
      <span><button class="cb ${sel ? "on" : ""}" data-cs="${esc(x.contract)}" ${can ? "" : "disabled"} aria-pressed="${sel}" aria-label="Select ${esc(name)}">${sel ? ICON_OK() : ""}</button></span>
      <span class="appc">${logo ? `<span class="ava logo" style="background:#fff"><img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.style.background='${a.color}';this.parentNode.textContent='${esc(a.letter)}'"></span>` : `<span class="ava" style="background:${a.color}">${esc(a.letter)}</span>`}<span style="min-width:0"><b>${esc(name)}</b><small>${esc(x.contract)}</small></span></span>
      <span class="muted">${formatNear(x.total, 5)} NEAR</span>
      <span>${can ? `<b class="gain">${formatNear(x.reclaim, 5)} NEAR</b>` : `<span class="muted">Nothing</span>`}</span>
      <span class="muted" style="font-size:13.5px">${why}</span>
      <span style="justify-self:end">${can ? `<button class="unplug" data-cs="${esc(x.contract)}">${sel ? "Picked" : "Get it back"}</button>` : ""}</span>
    </div>`;
  }).join("");
}

// ---------- several accounts at once ----------
async function openMany(raw) {
  const ids = [...new Set(raw.split(",").map(normalizeAccount).filter(Boolean))].slice(0, 10);
  S.accountId = null; S.data = null;
  document.title = "Your accounts on Unplug";
  root.innerHTML = `<div class="app"><nav><a class="word" href="#/">Unplug</a><div class="navright"><span class="pillacct solo">${ids.length} accounts <span class="net">${NETWORK_ID}</span></span></div></nav>
    <section class="banner"><span class="screw" style="left:14px;top:14px"></span><span class="screw" style="right:14px;top:14px"></span><span class="screw" style="left:14px;bottom:14px"></span><span class="screw" style="right:14px;bottom:14px"></span>
      <div><h1 id="mh">Checking ${ids.length} accounts</h1><div class="bs" id="ms">Open one to clean it up. Each account needs its own wallet to unplug.</div></div></section>
    <div class="cards" id="cards">${ids.map((id) => `<a class="acard" href="#/${encodeURIComponent(id)}" data-acc="${esc(id)}"><b>${esc(id)}</b><span class="muted"><span class="loader" style="width:14px;height:14px;border-width:2px"></span>Checking…</span></a>`).join("")}</div></div>`;
  let tk = 0, tf = 0, ta = 0;
  await Promise.all(ids.map(async (id) => {
    const card = document.querySelector(`[data-acc="${CSS.escape(id)}"]`);
    try {
      const d = await loadAccount(id, () => {}, { quick: true });
      const c = counts(d.keys); tk += c.all; tf += c.full; ta += c.amb;
      const bars = d.keys.map((k) => COLOR[risk(k)]).sort((a, b) => [RED, AMB, BLK].indexOf(a) - [RED, AMB, BLK].indexOf(b)).slice(0, 24).map((c) => `<i style="background:${c}"></i>`).join("");
      card.innerHTML = `<b>${esc(id)}</b><span class="strip">${bars}</span><span class="muted">${plural(c.all, "key", "keys")}: <span style="color:#a3241b">${c.full} full access</span>, ${c.amb} no gas limit</span><span class="open">Open ›</span>`;
    } catch (e) {
      card.innerHTML = `<b>${esc(id)}</b><span class="muted">${String(e.message).includes("UNKNOWN_ACCOUNT") ? "Doesn't exist" : "Couldn't load"}</span>`;
    }
    $("#mh").textContent = `${plural(tk, "key", "keys")} across ${plural(ids.length, "account", "accounts")}`;
    $("#ms").textContent = `${tf} can do anything with their account. ${ta} ${ta === 1 ? "has" : "have"} no gas limit. Open one to clean it up.`;
  }));
}

// ---------- results ----------
function handleReturn() {
  const href = location.href;
  const hashes = (href.match(/[?&]transactionHashes=([^&#]+)/) || [])[1], code = (href.match(/[?&]errorCode=([^&#]+)/) || [])[1];
  if (!hashes && !code) return;
  const pending = JSON.parse(sessionStorage.getItem("unplug.pending") || "null");
  sessionStorage.removeItem("unplug.pending");
  history.replaceState(null, "", location.pathname + location.hash.replace(/[?&](transactionHashes|errorCode|errorMessage)=[^&]*/g, ""));
  if (hashes && pending) success(pending, decodeURIComponent(hashes).split(",").pop());
  else if (code) toast({ error: true, title: "Nothing was unplugged", body: "You closed the wallet before signing. Your keys are untouched." });
}
async function success(pending, hash, partial) {
  S.selected.clear(); S.selI.clear(); S.selS.clear(); S.holding = false;
  // Take things off the board right away; the chain view can lag a few seconds.
  const gone = new Set(pending.pks || []);
  if (S.data) S.data.keys = S.data.keys.filter((k) => !gone.has(k.publicKey));
  if (S.intents) S.intents = S.intents.filter((k) => !(pending.ikeys || []).includes(k));
  if (S.storage) S.storage = S.storage.filter((x) => !(pending.storage || []).includes(x.contract));
  if (S.data) { paintBanner(); paintTabs(); paintPanel(); paintDock(); }
  const n = pending.removed.length, got = BigInt(pending.near || "0");
  const title = [n ? `Removed ${plural(n, "key", "keys")}` : "", got > 0n ? `${n ? "got" : "Got"} back ${formatNear(got, 4)} NEAR` : ""].filter(Boolean).join(" and ");
  toast({ title: title || "Done", body: `${partial ? "Some steps failed, check your wallet history." : "Confirmed on NEAR."}${hash ? ` <a href="${explorerTx(hash)}" target="_blank" rel="noopener">View transaction</a>` : ""}`, share: n ? pending : null });
  if (gone.size) refreshUntilGone(pending.accountId, gone);
  setTimeout(() => { if (S.accountId === pending.accountId) loadExtras(pending.accountId, true); }, 4000);
}
async function refreshUntilGone(accountId, gone, tries = 6) {
  setFinality("optimistic");
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (S.accountId !== accountId) break;
    try {
      const data = await loadAccount(accountId, () => {}, { quick: true });
      if (S.accountId !== accountId) break;
      const still = data.keys.some((k) => gone.has(k.publicKey));
      if (!still || i === tries - 1) {
        data.blockHeight = data.blockHeight || S.data?.blockHeight; S.data = { ...S.data, ...data, keys: data.keys.map((k) => ({ ...(S.data?.keys.find((o) => o.publicKey === k.publicKey) || {}), ...k })) };
        paintBanner(); paintTabs(); paintPanel(); paintDock();
        if (still) toast({ error: true, title: "Still showing on NEAR", body: "The key is still on the account. Check the transaction in your wallet, then press Refresh." });
        break;
      }
    } catch {}
  }
  setFinality("final");
}
function toast({ title, body, error, share }) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = `toast ${error ? "err" : ""}`; t.setAttribute("role", "status");
  t.innerHTML = `<div class="ok">${error ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg>` : ICON_OK("#fff", 18)}</div>
    <div style="flex:1;min-width:0"><h3>${esc(title)}</h3><p>${body}</p><div class="acts">${share ? `<button class="btn b-black" id="shareBtn">Share on X</button>` : ""}<button class="btn b-ghost" id="dismiss">Dismiss</button></div></div>`;
  document.body.appendChild(t);
  $("#dismiss", t).addEventListener("click", () => t.remove());
  if (share) $("#shareBtn", t).addEventListener("click", () => openShare(share));
  if (error || !share) setTimeout(() => t.remove(), error ? 7000 : 9000);
}
async function openShare(p) {
  const remaining = S.data ? jackOrder().map((k) => COLOR[risk(k)]) : [BLK, BLK];
  const cv = await drawShareCard({ accountId: p.accountId, removed: p.removed, removedFull: p.removedFull, remainingColors: remaining });
  const url = cv.toDataURL("image/png");
  const n = p.removed.length;
  const text = `I just unplugged ${plural(n, "app", "apps")} from my NEAR account${p.removedFull ? `, including ${plural(p.removedFull, "key that could do anything", "keys that could do anything")}` : ""}.\n\nCheck what's plugged into yours:`;
  const site = location.origin + location.pathname;
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.innerHTML = `<div class="card" role="dialog" aria-label="Share card"><img src="${url}" alt="Share card: ${esc(p.accountId)} unplugged ${n} apps">
    <div class="acts"><a class="btn b-black" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(site)}">Post on X</a>
    <button class="btn b-out" id="cpy">Copy image</button><a class="btn b-out" download="unplug-${esc(p.accountId)}.png" href="${url}">Download</a><button class="btn b-ghost" id="cls">Close</button></div>
    <div class="hint">Copy or download the image, then paste it into your post.</div></div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  $("#cls", sheet).addEventListener("click", () => sheet.remove());
  $("#cpy", sheet).addEventListener("click", async (e) => {
    try { const blob = await new Promise((r) => cv.toBlob(r, "image/png")); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); e.target.textContent = "Copied"; }
    catch { e.target.textContent = "Use Download instead"; }
  });
}

// ---------- boot ----------
{
  const m = location.href.match(/[#&?]publicKey=([^&#]+)/);
  const forAcc = sessionStorage.getItem("unplug.findKeyFor");
  if (m && forAcc) {
    const pk = decodeURIComponent(m[1]);
    try { localStorage.setItem(`unplug.myKey.${forAcc}`, pk); } catch {}
    sessionStorage.removeItem("unplug.findKeyFor");
    history.replaceState(null, "", location.pathname + `#/${encodeURIComponent(forAcc)}`);
  }
}
if (/[?&]transactionHashes=/.test(location.search) && !location.hash) {
  const p = JSON.parse(sessionStorage.getItem("unplug.pending") || "null");
  if (p) location.hash = `#/${encodeURIComponent(p.accountId)}`;
}
route();

if (import.meta.env.DEV) window.__setWallet = (a) => { walletAcc = a; onWallet(); };
