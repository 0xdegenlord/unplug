import "./polyfill.js";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { actionCreators } from "@near-js/transactions";
import { PublicKey } from "@near-js/crypto";
import { NETWORK_ID } from "./near.js";

let selector, modal;
const listeners = new Set();

export async function initWallet() {
  selector = await setupWalletSelector({
    network: NETWORK_ID,
    modules: [setupMyNearWallet(), setupMeteorWallet(), setupHereWallet(), setupIntearWallet()],
  });
  // No contractId: signing in never adds a new key to the user's account.
  modal = setupModal(selector, { description: "Connect the account you want to clean up." });
  selector.store.observable.subscribe(() => listeners.forEach((fn) => fn(current())));
  return current();
}

export function current() {
  const acc = selector?.store.getState().accounts.find((a) => a.active) || selector?.store.getState().accounts[0];
  return acc ? { accountId: acc.accountId, publicKey: acc.publicKey || null } : null;
}

export const onWalletChange = (fn) => listeners.add(fn);
export const connect = () => modal.show();
export async function disconnect() {
  const w = await selector.wallet();
  await w.signOut();
}

const TGAS = 1_000_000_000_000n;
// Everything the user picked, as few transactions as possible:
// one DeleteKey batch on the account, one intents.near batch, one call per storage refund.
export async function unplugAll(accountId, { keys = [], intentsKeys = [], storage = [] }, intentsContract) {
  const w = await selector.wallet();
  const txs = [];
  if (keys.length) txs.push({ signerId: accountId, receiverId: accountId, actions: keys.map((pk) => actionCreators.deleteKey(PublicKey.from(pk))) });
  if (intentsKeys.length) txs.push({ signerId: accountId, receiverId: intentsContract, actions: intentsKeys.map((pk) => actionCreators.functionCall("remove_public_key", { public_key: pk }, 30n * TGAS, 1n)) });
  for (const s of storage) {
    const args = s.method === "storage_withdraw" ? {} : { force: false };
    txs.push({ signerId: accountId, receiverId: s.contract, actions: [actionCreators.functionCall(s.method, args, 30n * TGAS, 1n)] });
  }
  if (txs.length === 1) { const o = await w.signAndSendTransaction(txs[0]); return o ? [o] : o; }
  return w.signAndSendTransactions({ transactions: txs });
}

// One transaction with one DeleteKey action per key.
export async function deleteKeys(accountId, publicKeys) {
  const w = await selector.wallet();
  return w.signAndSendTransaction({
    signerId: accountId,
    receiverId: accountId,
    actions: publicKeys.map((pk) => actionCreators.deleteKey(PublicKey.from(pk))),
  });
}

// Free, gasless signature that reveals which public key this wallet signs with (NEP-413).
export async function findMyKey(accountId) {
  const w = await selector.wallet();
  if (!w.signMessage) throw new Error("This wallet can't show its key. Try another wallet.");
  sessionStorage.setItem("unplug.findKeyFor", accountId);
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const res = await w.signMessage({
    message: "Unplug: show which key this wallet uses. This is free and changes nothing.",
    recipient: location.host || "unplug",
    nonce,
    callbackUrl: location.href.split("#")[0] + `#/${encodeURIComponent(accountId)}`,
  });
  return res?.publicKey || null;
}
