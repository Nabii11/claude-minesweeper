// Pixel-art helpers (port of src/sprites.py + src/pixelfont.py metrics).
// Everything is painted with fillRect at integer scales, so the art stays crisp.

import { THEME, PALETTE, GLYPHS, DIGITS_BOLD, MAPS, MASCOT, NUMBER_COLORS } from "./data.js";

export const T = THEME;
export { MAPS, NUMBER_COLORS };

export const GLYPH_W = 5;
export const ADVANCE = 6;
export const CAP_H = 7;
export const BOLD_W = 6;
export const BOLD_H = 8;
export const BIG_W = 24;
export const BIG_H = 16;

export const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

/** "#rrggbb" + alpha -> rgba() string. */
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

export function mascot(face = "normal", altLegs = false, armsUp = false) {
  return MASCOT[`${face}|${altLegs ? 1 : 0}|${armsUp ? 1 : 0}`];
}

export function mapSize(rows) {
  return [rows[0].length, rows.length];
}

/** Paint a character map with its top-left at (x, y). */
export function drawMap(ctx, rows, x, y, scale, recolor = null, opacity = 1) {
  if (opacity < 1) {
    ctx.save();
    ctx.globalAlpha *= opacity;
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const n = row.length;
    let c = 0;
    while (c < n) {
      const key = row[c];
      if (key === ".") { c++; continue; }
      let run = c + 1;
      while (run < n && row[run] === key) run++;
      ctx.fillStyle = (recolor && recolor[key]) || PALETTE[key];
      ctx.fillRect(x + c * scale, y + r * scale, (run - c) * scale, scale);
      c = run;
    }
  }
  if (opacity < 1) ctx.restore();
}

/** Paint the "#" pixels of a glyph-like map in one colour. */
function drawBits(ctx, rows, x, y, scale) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      if (row[c] !== "#") { c++; continue; }
      let run = c + 1;
      while (run < row.length && row[run] === "#") run++;
      ctx.fillRect(x + c * scale, y + r * scale, (run - c) * scale, scale);
      c = run;
    }
  }
}

export function glyph(ch) {
  if (GLYPHS[ch]) return GLYPHS[ch];
  const base = ch.normalize("NFKD")[0];
  return GLYPHS[base] || GLYPHS["?"];
}

export function textWidth(text, scale = 1) {
  return text.length ? (text.length * ADVANCE - 1) * scale : 0;
}

/** Bitmap text with its cap-top at (x, y). Returns the drawn width. */
export function drawText(ctx, text, x, y, scale, color, shadow = null) {
  if (shadow) drawText(ctx, text, x + scale, y + scale, scale, shadow);
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    drawBits(ctx, glyph(ch), cx, y, scale);
    cx += ADVANCE * scale;
  }
  return textWidth(text, scale);
}

export function drawTextCentered(ctx, text, rx, ry, rw, rh, scale, color, shadow = null) {
  const w = textWidth(text, scale);
  const h = CAP_H * scale;
  drawText(ctx, text, rx + Math.floor((rw - w) / 2), ry + Math.floor((rh - h) / 2), scale, color, shadow);
}

export function drawBoldDigit(ctx, digit, x, y, scale, color) {
  ctx.fillStyle = color;
  drawBits(ctx, DIGITS_BOLD[String(digit)], x, y, scale);
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A sprite rendered to its own canvas (for icons in the DOM). */
export function mapCanvas(rows, scale, recolor = null) {
  const [w, h] = mapSize(rows);
  const c = makeCanvas(w * scale, h * scale);
  drawMap(c.getContext("2d"), rows, 0, 0, scale, recolor);
  return c;
}

/** Small seeded PRNG (mulberry32) for repeatable dither/glitch patterns. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
