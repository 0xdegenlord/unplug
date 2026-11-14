// Friendly names for well-known NEAR contracts. Anything not listed is shown by its contract id.
const KNOWN = {
  "skyward.near": "Skyward Finance",
  "v2.ref-farming.near": "Ref Farming",
  "boostfarm.ref-labs.near": "Ref Boost Farm",
  "inscription.near": "NEAT Inscriptions",
  "app.herewallet.near": "HERE Wallet",
  "storage.herewallet.near": "HERE Wallet",
  "tkn.near": "Tkn Farm",
  "lst.rhealab.near": "Rhea",
  "veax.near": "Veax",
  "v1.social08.testnet": "NEAR Social",
  "v2.ref-finance.near": "Ref Finance",
  "ref-finance.near": "Ref Finance",
  "contract.main.burrow.near": "Burrow",
  "social.near": "NEAR Social",
  "intents.near": "NEAR Intents",
  "wrap.near": "Wrapped NEAR",
  "meta-pool.near": "Meta Pool",
  "linear-protocol.near": "LiNEAR",
  "meme-cooking.near": "Meme Cooking",
  "game.hot.tg": "HOT",
  "potlock.near": "Potlock",
  "v1.potlock.near": "Potlock",
  "donate.potlock.near": "Potlock",
  "app.nearcrowd.near": "NEARCrowd",
  "marketplace.paras.near": "Paras",
  "x.paras.near": "Paras",
  "v1.orderbook.near": "Orderly",
  "asset-manager.orderly-network.near": "Orderly",
  "spot.spin-fi.near": "Spin",
  "v1.jumbo_exchange.near": "Jumbo",
  "dclv2.ref-labs.near": "Ref DCL",
  "token.sweat": "Sweat",
  "claim.sweat": "Sweat",
  "nearvoting.near": "NEAR Voting",
  "mintbase1.near": "Mintbase",
  "simple.market.mintbase1.near": "Mintbase",
  "v1.nearnames.near": "NEAR Names",
  "near": "NEAR",
  "relay.aurora": "Aurora",
  "aurora": "Aurora",
  "pixelbazaar5-tow69.testnet": "Pixel Bazaar",
};

// Website for each project, used to show its logo.
const DOMAINS = {
  "Ref Finance": "ref.finance", "Ref Farming": "ref.finance", "Ref Boost Farm": "ref.finance", "Ref DCL": "ref.finance",
  "Burrow": "burrow.finance", "NEAR Social": "near.social", "NEAR Intents": "near-intents.org", "Wrapped NEAR": "near.org",
  "Meta Pool": "metapool.app", "LiNEAR": "linearprotocol.org", "Meme Cooking": "meme.cooking", "HOT": "hot-labs.org",
  "Potlock": "potlock.org", "NEARCrowd": "nearcrowd.com", "Paras": "paras.id", "Orderly": "orderly.network",
  "Spin": "spin.fi", "Jumbo": "jumbo.exchange", "Sweat": "sweateconomy.com", "Mintbase": "mintbase.xyz",
  "Aurora": "aurora.dev", "Skyward Finance": "skyward.finance", "HERE Wallet": "herewallet.app",
  "Rhea": "rhea.finance", "Veax": "veax.com", "NEAT Inscriptions": "neatprotocol.ai", "NEAR": "near.org",
};

const PALETTE = ["#3d6b5a", "#5a4fb0", "#c26b2a", "#7a7f3a", "#2f5f8a", "#9b3d5c", "#6b4a2f", "#2f6f6f", "#8a5a1f", "#4a5a8a"];

export function appInfo(receiverId) {
  if (!receiverId) return null;
  let name = KNOWN[receiverId];
  if (!name) {
    // Try the parent account: "contract.main.burrow.near" -> "burrow.near"
    const parts = receiverId.split(".");
    for (let i = 1; i < parts.length - 1 && !name; i++) name = KNOWN[parts.slice(i).join(".")];
  }
  const label = name || receiverId;
  let h = 0;
  for (const ch of receiverId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const letter = (name || receiverId.replace(/^(app|v\d+|contract|game|main)\./, "")).replace(/[^a-z0-9]/gi, "").charAt(0).toUpperCase() || "?";
  const domain = name && DOMAINS[name];
  return { name: label, known: !!name, letter, color: PALETTE[h % PALETTE.length], logo: domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null };
}
