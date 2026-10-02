// Boot screen: a fake 90s BIOS POST, a CRT flicker, then the animated title card
// (port of src/ui/splash.py, laid out for a portrait phone screen).
//
// Timeline (ms):
//    0    - 1250  BIOS text types itself out
//    1250 - 1450  CRT collapses to a line and re-opens
//    1450 - 3700  title dithers in, Claude walks on, "By Nabil" types, loading bar fills
//    3700 - 3900  CRT switch-off, then onDone()
// A tap skips straight to the switch-off.

import { T, MAPS, BAYER4, CAP_H, ADVANCE, BIG_W, BIG_H, drawMap, drawText, drawTextCentered, glyph, mapSize, mascot, textWidth } from "./sprites.js";
import { ditherBackground } from "./tiles.js";

const TITLE_1 = "CLAUDE";
const TITLE_2 = "MINEWEEPER";
const BYLINE = "By Nabil";

const BIOS_END = 1250;
const FLICKER_END = 1450;
const LOGO_END = 3700;
const OFF_MS = 200;
const CHAR_MS = 7;

function biosLines(t) {
  const out = ["CLAUDE BIOS v1.0", "Copyright (C) 1995 Claude", ""];
  const script = [
    [120, "CPU   : CLAUDE-486 DX2 66MHz"],
    [300, "memory"],
    [640, "VIDEO : CRT ORANGE ..... OK"],
    [800, "SOUND : 8-BIT SQUARE ... OK"],
    [960, "loading"],
  ];
  for (const [start, text] of script) {
    if (t < start) break;
    if (text === "memory") {
      const kb = Math.floor(Math.min(640, ((t - start) / 280) * 640) / 16) * 16;
      out.push(`MEMORY: ${String(kb).padStart(3, " ")}K${kb >= 640 ? " OK" : ""}`);
    } else if (text === "loading") {
      const dots = Math.min(6, Math.floor((t - start) / 40));
      out.push("MINES.SYS " + ".".repeat(dots) + (t > start + 260 ? " OK" : ""));
    } else {
      out.push(text.slice(0, Math.floor((t - start) / CHAR_MS)));
    }
  }
  return out;
}

/** [top, bottom] safe-area insets in CSS px (env() is only resolved on real properties). */
function safeInsets() {
  let probe = document.getElementById("safe-probe");
  if (!probe) {
    probe = document.createElement("div");
    probe.id = "safe-probe";
    probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;" +
      "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return [parseFloat(cs.paddingTop) || 0, parseFloat(cs.paddingBottom) || 0];
}

/** Bitmap text revealed pixel-by-pixel through a 4x4 Bayer matrix (level 0..16). */
function ditherText(ctx, text, x, y, scale, color, shadow, level) {
  if (level <= 0) return;
  if (level >= 16) { drawText(ctx, text, x, y, scale, color, shadow); return; }
  let cx = x;
  for (const ch of text) {
    glyph(ch).forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== "#") continue;
        const gx = (cx - x) / scale + c;
        if (BAYER4[r % 4][gx % 4] >= level) continue;
        const px = cx + c * scale, py = y + r * scale;
        if (shadow) { ctx.fillStyle = shadow; ctx.fillRect(px + scale, py + scale, scale, scale); }
        ctx.fillStyle = color;
        ctx.fillRect(px, py, scale, scale);
      }
    });
    cx += ADVANCE * scale;
  }
}

export class Splash {
  constructor(canvas, sound, onDone) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.sound = sound;
    this.onDone = onDone;
    this.t0 = performance.now();
    this.offAt = null;
    this.done = false;
    this.bootPlayed = false;
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.sound.unlock();
      this.skip();
    });
    requestAnimationFrame(() => this._tick());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.W = Math.round(window.innerWidth * dpr);
    this.H = Math.round(window.innerHeight * dpr);
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.bg = ditherBackground(Math.max(2, Math.round(2 * dpr)));
    this.bgPattern = this.ctx.createPattern(this.bg, "repeat");
  }

  skip() {
    if (this.offAt === null) this.offAt = this._now();
  }

  _now() {
    return performance.now() - this.t0;
  }

  _tick() {
    if (this.done) return;
    const now = this._now();
    if (!this.bootPlayed && now >= FLICKER_END) {
      this.bootPlayed = true;
      this.sound.play("boot");
    }
    if (this.offAt === null && now >= LOGO_END) this.offAt = now;
    if (this.offAt !== null && now >= this.offAt + OFF_MS) {
      this.done = true;
      window.removeEventListener("resize", this._onResize);
      this.onDone();
      return;
    }
    this._paint(now);
    requestAnimationFrame(() => this._tick());
  }

  // Screen area inside the safe-area insets (notch, home bar).
  _screen() {
    const [sat, sab] = safeInsets();
    const m = Math.round(12 * this.dpr);
    const top = Math.round(sat * this.dpr) + m, bottom = Math.round(sab * this.dpr) + m;
    return [m, top, this.W - 2 * m, this.H - top - bottom];
  }

  _paint(now) {
    const ctx = this.ctx;
    ctx.fillStyle = T.BLACK;
    ctx.fillRect(0, 0, this.W, this.H);
    const scr = this._screen();
    const [x, y, w, h] = scr;
    const f = Math.max(1, Math.round(this.dpr));
    ctx.fillStyle = T.RUST;
    ctx.fillRect(x - 2 * f, y - 2 * f, w + 4 * f, h + 4 * f);
    ctx.fillStyle = T.VOID;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (now < BIOS_END + 100) this._paintBios(ctx, scr, now);
    else this._paintLogo(ctx, scr, now);
    this._paintTransitions(ctx, scr, now);
    ctx.restore();
  }

  _paintBios(ctx, [x0, y0, w, h], now) {
    const longest = textWidth("CPU   : CLAUDE-486 DX2 66MHz", 1);
    const s = Math.max(1, Math.floor((w - 32 * this.dpr) / longest));
    const lineH = (CAP_H + 4) * s;
    const x = x0 + Math.round(16 * this.dpr), y = y0 + Math.round(20 * this.dpr);
    const lines = biosLines(now);
    lines.forEach((text, i) => {
      const color = i === 0 ? T.BRIGHT : text.endsWith("OK") ? T.AMBER : i < 3 ? T.DARK : T.GLOW;
      drawText(ctx, text, x, y + i * lineH, s, color);
    });
    // Blinking block cursor after the last line
    if (Math.floor(now / 180) % 2 === 0 && lines.length) {
      const last = lines[lines.length - 1];
      const cx = x + textWidth(last, s) + (last ? s * 2 : 0);
      ctx.fillStyle = T.BRIGHT;
      ctx.fillRect(cx, y + (lines.length - 1) * lineH, 5 * s, CAP_H * s);
    }
    // "Energy Star"-style badge: Claude in a box, under the text.
    const bs = s * 2;
    const [mw, mh] = mapSize(MAPS.MINE);
    const bw = (mw + 14) * bs, bh = (mh + 14) * bs;
    const bx = x0 + Math.round((w - bw) / 2), by = y + 9 * lineH;
    ctx.fillStyle = T.DARK;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = T.BLACK;
    ctx.fillRect(bx + s, by + s, bw - 2 * s, bh - 2 * s);
    drawMap(ctx, MAPS.MINE, bx + Math.round((bw - mw * bs) / 2), by + 3 * bs, bs);
    drawTextCentered(ctx, "CLAUDE", bx, by + bh - 9 * s - 3 * bs, bw, 9 * s, s, T.BRIGHT);
    drawText(ctx, "Tap to skip", x, y0 + h - Math.round(20 * this.dpr) - CAP_H * s, s, T.RUST);
  }

  _paintLogo(ctx, [x0, y0, w, h], now) {
    const t = now - FLICKER_END + 200;   // logo already visible while the CRT re-opens
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = this.bgPattern;
    ctx.fillRect(x0, y0, w, h);
    ctx.restore();
    const cx = x0 + Math.round(w / 2);

    // Sizes from the screen width.
    const s1 = Math.max(2, Math.floor((w * 0.78) / textWidth(TITLE_1, 1)));
    const s2 = Math.max(1, Math.floor((w * 0.78) / textWidth(TITLE_2, 1)));
    const s3 = Math.max(1, Math.floor(s2 * 0.6));
    const scale = Math.max(2, Math.floor((w * 0.42) / BIG_W));
    const gap = Math.round(14 * this.dpr);
    const block = BIG_H * scale + gap * 2 + CAP_H * s1 + gap + CAP_H * s2 + gap * 1.5 + CAP_H * s3;
    const ground = y0 + Math.max(gap, Math.round((h - block) / 2 - h * 0.06));

    // Claude walks in from the left, stops centre stage and does a happy hop.
    const targetX = cx - Math.floor((BIG_W * scale) / 2);
    const walk = Math.min(1, Math.max(0, t / 650));
    const mx = Math.floor(x0 - BIG_W * scale + (targetX - x0 + BIG_W * scale) * (1 - (1 - walk) ** 2));
    let my = ground;
    let face = "normal", alt = false, cheer = false;
    if (walk < 1) {
      alt = Math.floor(t / 110) % 2 === 1;
      if (alt) my -= scale;
    } else if (t > 1500 && t < 2100) {
      face = "win";
      alt = cheer = Math.floor(t / 150) % 2 === 1;
      if (alt) my -= 2 * scale;
    } else if (Math.floor(t / 100) % 30 === 0) {
      face = "blink";
    }
    ctx.fillStyle = T.EMBER;
    ctx.fillRect(targetX + 4 * scale, ground + BIG_H * scale + scale, (BIG_W - 8) * scale, scale);
    drawMap(ctx, mascot(face, alt, cheer), mx, my, scale);

    // Title dithers in (ordered-dither dissolve), then glows.
    const y1 = ground + BIG_H * scale + gap * 2;
    const level = Math.floor(Math.min(16, Math.max(0, ((t - 300) / 450) * 16)));
    ditherText(ctx, TITLE_1, cx - Math.floor(textWidth(TITLE_1, s1) / 2), y1, s1, T.BRIGHT, T.RUST, level);
    const y2 = y1 + CAP_H * s1 + gap;
    const level2 = Math.floor(Math.min(16, Math.max(0, ((t - 480) / 450) * 16)));
    ditherText(ctx, TITLE_2, cx - Math.floor(textWidth(TITLE_2, s2) / 2), y2, s2, T.AMBER, T.RUST, level2);

    // Sparks twinkle in the corners of the title card once it's in.
    if (level2 >= 16) {
      const ss = Math.max(1, Math.floor(s2 / 2));
      const [sw, sh] = mapSize(MAPS.SPARK);
      const twinkle = Math.floor(t / 200) % 2;
      [[-1, y1 - sh * ss - gap], [1, y2 + CAP_H * s2 + gap * 0.4]].forEach(([side, sy], i) => {
        const hot = (twinkle === 0) === (i === 0);
        const sx = side < 0 ? x0 + gap : x0 + w - gap - sw * ss;
        drawMap(ctx, MAPS.SPARK, sx, Math.round(sy), ss, hot ? { H: T.GLOW, O: T.BRIGHT } : null);
      });
    }

    // "By Nabil" types itself out.
    const y3 = y2 + CAP_H * s2 + Math.round(gap * 1.5);
    const chars = Math.floor(Math.max(0, t - 1100) / 70);
    const by = BYLINE.slice(0, chars);
    const bw = textWidth(BYLINE, s3);
    drawText(ctx, by, cx - Math.floor(bw / 2), y3, s3, T.GLOW, T.RUST);
    if (chars > 0 && chars <= BYLINE.length && Math.floor(now / 150) % 2 === 0) {
      ctx.fillStyle = T.BRIGHT;
      ctx.fillRect(cx - Math.floor(bw / 2) + textWidth(by, s3) + s3, y3, 4 * s3, CAP_H * s3);
    }

    // Segmented loading bar
    const f = Math.max(1, Math.round(this.dpr));
    const barW = Math.round(w * 0.76), barH = Math.round(18 * this.dpr);
    const bx = cx - Math.round(barW / 2), byy = y0 + h - Math.round(70 * this.dpr);
    ctx.fillStyle = T.DARK;
    ctx.fillRect(bx, byy, barW, barH);
    ctx.fillStyle = T.BLACK;
    ctx.fillRect(bx + 2 * f, byy + 2 * f, barW - 4 * f, barH - 4 * f);
    const segs = 20;
    const progress = Math.min(1, Math.max(0, (t - 250) / (LOGO_END - FLICKER_END - 450)));
    const filled = Math.floor(segs * progress);
    const segW = Math.floor((barW - 8 * f) / segs);
    for (let i = 0; i < filled; i++) {
      ctx.fillStyle = i === filled - 1 ? T.BRIGHT : T.ORANGE;
      ctx.fillRect(bx + 4 * f + i * segW, byy + 4 * f, segW - 2 * f, barH - 8 * f);
    }
    const ls = Math.max(1, Math.round(2 * this.dpr));
    if (progress < 1 || Math.floor(now / 160) % 2 === 0) {
      drawTextCentered(ctx, progress >= 1 ? "READY!" : "LOADING", bx, byy + barH + 6 * f, barW, CAP_H * ls, ls,
        progress < 1 ? T.DARK : T.BRIGHT);
    }
  }

  _paintTransitions(ctx, scr, now) {
    // BIOS -> logo: collapse to a bright line, then open up again.
    if (now >= BIOS_END && now < FLICKER_END) {
      const k = (now - BIOS_END) / (FLICKER_END - BIOS_END);
      const opening = Math.abs(k - 0.5) * 2;
      this._maskBand(ctx, scr, Math.max(0.01, opening ** 2), 1 - opening);
    }
    if (this.offAt !== null) {
      const k = Math.min(1, (now - this.offAt) / OFF_MS);
      this._maskBand(ctx, scr, Math.max(0, 1 - k * 1.3), k);
    }
    if (now < 180) {
      const k = now / 180;
      this._maskBand(ctx, scr, k * k, 1 - k);
    }
  }

  _maskBand(ctx, [x, y, w, h], openFrac, glow) {
    const bh = Math.floor(h * Math.max(0, Math.min(1, openFrac)));
    const top = Math.round(y + h / 2 - bh / 2);
    ctx.fillStyle = T.VOID;
    ctx.fillRect(x, y, w, top - y);
    ctx.fillRect(x, top + bh, w, y + h - (top + bh));
    const f = Math.max(1, Math.round(this.dpr));
    ctx.fillStyle = `rgba(255,232,204,${Math.max(0, Math.min(1, glow))})`;
    ctx.fillRect(x, Math.round(y + h / 2) - f, w, 3 * f);
  }
}
