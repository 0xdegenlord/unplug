// Read-only NEAR data layer. Fetches every access key on an account and everything
// that can be learned about each one from public RPC.

const NETWORKS = {
  mainnet: {
    rpc: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org", "https://free.rpc.fastnear.com"],
    archival: ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"],
    explorer: "https://nearblocks.io",
    suffix: ".near",
    intents: "intents.near",
    api: "https://api.fastnear.com",
  },
  testnet: {
    rpc: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
    archival: ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"],
    explorer: "https://testnet.nearblocks.io",
    suffix: ".testnet",
    intents: "intents.testnet",
    api: "https://test.api.fastnear.com",
  },
};

export function getNetworkId() {
  const q = new URLSearchParams(location.search).get("network");
  if (q === "testnet" || q === "mainnet") {
    try { localStorage.setItem("unplug.network", q); } catch {}
    return q;
  }
  try { return localStorage.getItem("unplug.network") || "mainnet"; } catch { return "mainnet"; }
}
export const NETWORK_ID = getNetworkId();
export const NET = NETWORKS[NETWORK_ID];

let rpcId = 0;
async function call(urls, method, params) {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const json = await res.json();
      if (json.error) {
        const e = new Error(json.error?.cause?.name || json.error?.data || json.error?.message || "RPC error");
        e.rpc = json.error;
        // An answer from the chain (unknown account etc.) is final; don't try the next node.
        if (json.error?.cause?.name && json.error.cause.name !== "INTERNAL_ERROR" && json.error.cause.name !== "TOO_MANY_REQUESTS") throw Object.assign(e, { final: true });
        throw e;
      }
      return json.result;
    } catch (e) {
      lastErr = e;
      if (e.final) throw e;
    }
  }
  throw lastErr;
}
export const rpc = (method, params) => call(NET.rpc, method, params);
const archival = (method, params) => call(NET.archival, method, params);

let FINALITY = "final";
export const setFinality = (f) => (FINALITY = f);
const query = (params) => rpc("query", { finality: FINALITY, ...params });

export function normalizeAccount(input) {
  let a = (input || "").trim().toLowerCase().replace(/^@/, "");
  if (!a) return "";
  // Implicit accounts (64 hex) and EVM-style 0x accounts are left as typed.
  if (/^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a)) return a;
  if (!a.includes(".")) a += NET.suffix;
  return a;
}

export const YOCTO = 10n ** 24n;
export function formatNear(yocto, digits = 4) {
  if (yocto == null) return null;
  const v = BigInt(yocto);
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// ---------- block-height → date ----------
const DATE_CACHE_KEY = `unplug.blockdates.${NETWORK_ID}`;
let dateCache = {};
try { dateCache = JSON.parse(localStorage.getItem(DATE_CACHE_KEY) || "{}"); } catch {}
function saveDates() { try { localStorage.setItem(DATE_CACHE_KEY, JSON.stringify(dateCache)); } catch {} }

let headCache = null;
async function head() {
  if (headCache) return headCache;
  const b = await rpc("block", { finality: "final" });
  headCache = { height: b.header.height, ts: b.header.timestamp / 1e6 };
  return headCache;
}

async function blockDate(height) {
  if (dateCache[height]) return { ms: dateCache[height], exact: true };
  try {
    const b = await archival("block", { block_id: height });
    const ms = Math.round(b.header.timestamp / 1e6);
    dateCache[height] = ms; saveDates();
    return { ms, exact: true };
  } catch {
    // Archival node unavailable: estimate from the chain head (~1.1 s per block on average).
    const h = await head();
    return { ms: h.ts - (h.height - height) * 1100, exact: false };
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------- receiver contract status ----------
const EMPTY_CODE = "11111111111111111111111111111111";
async function contractStatus(accountId) {
  try {
    const r = await query({ request_type: "view_account", account_id: accountId });
    return r.code_hash === EMPTY_CODE ? "no-contract" : "live";
  } catch (e) {
    if (String(e.message).includes("UNKNOWN_ACCOUNT")) return "deleted";
    return "unknown";
  }
}

// ---------- on-chain logo: many NEAR contracts are tokens or NFT collections with an icon ----------
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
async function viewJson(contract, method, args = {}) {
  const r = await query({ request_type: "call_function", account_id: contract, method_name: method, args_base64: b64(args) });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
}
async function contractIcon(contract) {
  for (const m of ["ft_metadata", "nft_metadata"]) {
    try {
      const md = await viewJson(contract, m);
      const icon = md?.icon;
      if (typeof icon === "string" && /^(data:image\/|https:\/\/)/.test(icon)) return { icon, name: md.name || null };
    } catch {}
  }
  return null;
}

// ---------- main entry ----------
export async function loadAccount(accountId, onProgress = () => {}, opts = {}) {
  if (opts.quick) {
    const [acct, list] = await Promise.all([
      query({ request_type: "view_account", account_id: accountId }),
      query({ request_type: "view_access_key_list", account_id: accountId }),
    ]);
    return { accountId, balance: acct.amount, keys: list.keys.map(parseKey) };
  }
  onProgress("Looking up account");
  const acct = await query({ request_type: "view_account", account_id: accountId });
  onProgress("Reading keys");
  const list = await query({ request_type: "view_access_key_list", account_id: accountId });
  const keys = list.keys.map((k) => parseKey(k));

  onProgress("Checking apps");
  const receivers = [...new Set(keys.filter((k) => k.receiverId).map((k) => k.receiverId))];
  const statuses = Object.fromEntries(await pool(receivers, 6, async (r) => [r, await contractStatus(r)]));

  onProgress("Finding app logos");
  const live = receivers.filter((r) => statuses[r] === "live");
  const icons = Object.fromEntries(await pool(live, 6, async (r) => [r, await contractIcon(r)]));

  onProgress("Dating keys");
  await pool(keys, 4, async (k) => {
    if (k.receiverId) { k.contract = statuses[k.receiverId]; k.chainIcon = icons[k.receiverId] || null; }
    if (k.createdHeight) {
      const d = await blockDate(k.createdHeight);
      k.createdMs = d.ms; k.createdExact = d.exact;
    }
  });

  return {
    accountId,
    balance: acct.amount,
    locked: acct.locked,
    storageUsage: acct.storage_usage,
    hasContract: acct.code_hash !== EMPTY_CODE,
    blockHeight: list.block_height,
    keys,
  };
}

function parseKey(k) {
  const perm = k.access_key.permission;
  const nonce = Number(k.access_key.nonce);
  // Since protocol 1.21 a new key's nonce starts at (block height × 1,000,000) and grows by one per use.
  const createdHeight = nonce >= 1e6 ? Math.floor(nonce / 1e6) : null;
  const uses = createdHeight ? nonce - createdHeight * 1e6 : nonce;
  const base = { publicKey: k.public_key, nonce, createdHeight, uses };
  if (perm === "FullAccess") return { ...base, full: true, receiverId: null, methodNames: [], allowance: null };
  const fc = perm.FunctionCall;
  return { ...base, full: false, receiverId: fc.receiver_id, methodNames: fc.method_names || [], allowance: fc.allowance ?? null };
}

export function explorerAccount(id) { return `${NET.explorer}/address/${id}`; }
export function explorerTx(hash) { return `${NET.explorer}/txns/${hash}`; }
export function explorerBlock(h) { return `${NET.explorer}/blocks/${h}`; }


// ---------- NEAR Intents: keys allowed to sign intents for this account ----------
export async function loadIntentsKeys(accountId) {
  try {
    const keys = await viewJson(NET.intents, "public_keys_of", { account_id: accountId });
    return Array.isArray(keys) ? keys.map(String) : [];
  } catch { return null; } // null = couldn't check
}

// ---------- Storage deposits (NEP-145) left in apps and tokens ----------
async function tokenList(accountId) {
  try {
    const r = await fetch(`${NET.api}/v1/account/${accountId}/ft`);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.tokens || []).map((t) => t.contract_id).filter(Boolean);
  } catch { return []; }
}
export async function loadStorage(accountId, extraContracts = [], onProgress = () => {}) {
  const contracts = [...new Set([...(await tokenList(accountId)), ...extraContracts])].slice(0, 80);
  let done = 0;
  const rows = await pool(contracts, 6, async (c) => {
    let bal = null;
    try { bal = await viewJson(c, "storage_balance_of", { account_id: accountId }); } catch {}
    onProgress(++done, contracts.length);
    if (!bal || !bal.total) return null;
    const total = BigInt(bal.total), available = BigInt(bal.available || "0");
    let tokenBalance = null;
    try { tokenBalance = String(await viewJson(c, "ft_balance_of", { account_id: accountId })); } catch {}
    let reclaim = 0n, method = null;
    if (available > 0n) { reclaim = available; method = "storage_withdraw"; }
    else if (tokenBalance === "0") { reclaim = total; method = "storage_unregister"; }
    const meta = await contractIcon(c);
    return { contract: c, total: total.toString(), available: available.toString(), tokenBalance, reclaim: reclaim.toString(), method, icon: meta?.icon || null, metaName: meta?.name || null };
  });
  return rows.filter(Boolean);
}

// ---------- Last used: binary search the key's nonce through archival history ----------
async function nonceAt(accountId, publicKey, height) {
  try {
    const r = await call(NET.archival, "query", { request_type: "view_access_key", account_id: accountId, public_key: publicKey, block_id: height });
    return Number(r.nonce);
  } catch (e) {
    if (String(e.message).includes("UNKNOWN_ACCESS_KEY")) return -1;
    throw e;
  }
}
export async function lastUsed(accountId, key, headHeight) {
  if (!key.createdHeight || key.uses === 0) return null;
  let lo = key.createdHeight, hi = headHeight;
  // smallest height where the nonce already equals today's nonce
  for (let i = 0; i < 40 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const n = await nonceAt(accountId, key.publicKey, mid);
    if (n >= key.nonce) hi = mid; else lo = mid;
  }
  const d = await blockDate(hi);
  return { height: hi, ms: d.ms, exact: d.exact };
}
