// Draws the 1200×675 X share card on a canvas.
const C = { wall: "#cdd3cc", enamel: "#ebe3cd", red: "#d8352a", amber: "#efb026", blk: "#2b2b2b" };
const DARK = { [C.red]: "#8f1f17", [C.amber]: "#a8780f", [C.blk]: "#000" };

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function circle(ctx, x, y, r, fill, stroke) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); } }
function socket(ctx, x, y) { circle(ctx, x, y, 19, "#c9a24b", "#7a5f22"); circle(ctx, x, y, 13, "#e0c278"); circle(ctx, x, y, 8, "#1d1a14"); }
function cable(ctx, pts, color) {
  for (const [w, c] of [[10, DARK[color]], [6, color]]) {
    ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.bezierCurveTo(...pts[1], ...pts[2], ...pts[3]);
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.stroke();
  }
}
function pluggedIn(ctx, x, y, color, i) {
  const d = DARK[color];
  cable(ctx, [[x, y + 40], [x, y + 140], [x + (i % 2 ? 10 : -10), y + 260], [x + (i % 2 ? 14 : -8), 700]], color);
  rr(ctx, x - 9, y + 10, 18, 34, 5); ctx.fillStyle = d; ctx.fill();
  rr(ctx, x - 8, y + 10, 13, 33, 4); ctx.fillStyle = color; ctx.fill();
  circle(ctx, x, y, 15, d); circle(ctx, x, y - 1, 12.5, color);
  ctx.beginPath(); ctx.ellipse(x - 4, y - 5, 4, 2.5, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fill();
}
function loose(ctx, x, y, rot, color) {
  const d = DARK[color];
  ctx.save(); ctx.translate(x, y); ctx.rotate((rot * Math.PI) / 180);
  cable(ctx, [[0, 40], [0, 90], [20, 130], [10, 260]], color);
  rr(ctx, -10, 4, 20, 40, 5); ctx.fillStyle = d; ctx.fill();
  rr(ctx, -8, 4, 15, 38, 4); ctx.fillStyle = color; ctx.fill();
  rr(ctx, -13, 0, 26, 8, 2); ctx.fillStyle = "#9aa0a3"; ctx.fill();
  rr(ctx, -4, -32, 8, 32, 2); ctx.fillStyle = "#b8bec1"; ctx.fill(); ctx.strokeStyle = "#5d6366"; ctx.lineWidth = 1; ctx.stroke();
  circle(ctx, 0, -34, 5, "#b8bec1", "#5d6366");
  ctx.restore();
}

function wrap(ctx, text, maxW) {
  const words = text.split(" "); const lines = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}

export async function drawShareCard({ accountId, removed, removedFull, remainingColors }) {
  await Promise.all([document.fonts.load("800 84px \"Bricolage Grotesque\""), document.fonts.load("400 24px \"Bricolage Grotesque\""), document.fonts.load("600 20px \"Bricolage Grotesque\"")]);
  const cv = document.createElement("canvas"); cv.width = 1200; cv.height = 675;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = C.wall; ctx.fillRect(0, 0, 1200, 675);

  // panel: remaining plugs + empty sockets for the removed ones
  const slots = [];
  const keep = remainingColors.slice(0, 7 - Math.min(removed.length, 4));
  const empties = Math.min(removed.length, 4);
  keep.forEach((c) => slots.push(c));
  for (let i = 0; i < empties; i++) slots.splice(Math.min(slots.length, 1 + i * 2), 0, null);
  const PX = 640, PY = 150, W = Math.max(240, 60 + slots.length * 60), H = 150;
  ctx.fillStyle = "rgba(0,0,0,.14)"; rr(ctx, PX + 6, PY + 10, W, H, 14); ctx.fill();
  ctx.fillStyle = C.enamel; rr(ctx, PX, PY, W, H, 14); ctx.fill(); ctx.strokeStyle = "#bfb393"; ctx.lineWidth = 1.5; ctx.stroke();
  for (const [a, b] of [[PX + 20, PY + 20], [PX + W - 20, PY + 20], [PX + 20, PY + H - 20], [PX + W - 20, PY + H - 20]]) circle(ctx, a, b, 6, "#c9bd9a", "#9c8f6c");
  slots.forEach((c, i) => { const x = PX + 60 + i * 60, y = PY + 75; socket(ctx, x, y); });
  slots.forEach((c, i) => { if (c) pluggedIn(ctx, PX + 60 + i * 60, PY + 75, c, i); });
  removed.slice(0, 4).forEach((c, i) => loose(ctx, PX + 90 + i * 85, 500 + (i % 2) * 50, [-28, 22, -12, 16][i], c));

  // text
  ctx.fillStyle = "#000"; ctx.font = "800 26px \"Bricolage Grotesque\""; ctx.fillText("Unplug", 64, 92);
  ctx.fillStyle = "#4a524c"; ctx.font = "400 24px \"Bricolage Grotesque\""; ctx.fillText(accountId, 64, 200);
  ctx.fillStyle = "#000"; ctx.font = "800 84px \"Bricolage Grotesque\"";
  const n = removed.length;
  ctx.fillText("Unplugged", 60, 290);
  ctx.fillText(`${n} app${n === 1 ? "" : "s"}.`, 60, 368);
  if (removedFull > 0) {
    ctx.font = "400 26px \"Bricolage Grotesque\"";
    const t = removedFull === 1 ? "Including 1 that could do anything with my account." : `Including ${removedFull} that could do anything with my account.`;
    wrap(ctx, t, 480).forEach((l, i) => ctx.fillText(l, 64, 430 + i * 36));
  }
  ctx.fillStyle = "#000"; rr(ctx, 64, 560, 316, 52, 6); ctx.fill();
  ctx.fillStyle = "#f6f1e4"; ctx.font = "600 21px \"Bricolage Grotesque\""; ctx.fillText("Check your NEAR account", 84, 593);
  return cv;
}
