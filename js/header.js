// Top panel: mine counter LCD, the Claude reset button and the timer LCD
// (port of src/ui/header.py). Painted in device pixels for crisp pixel art.

import { T, MAPS, CAP_H, drawMap, drawText, mapSize, mascot, textWidth, rgba } from "./sprites.js";

// 7-segment layout on an 8 x 16 art-pixel digit: [x, y, w, h]
const SEGMENTS = {
  a: [2, 0, 4, 2], b: [6, 2, 2, 5], c: [6, 9, 2, 5], d: [2, 14, 4, 2],
  e: [0, 9, 2, 5], f: [0, 2, 2, 5], g: [2, 7, 4, 2],
};
const DIGIT_SEGS = {
  0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd",
  6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g", " ": "",
};
const DIGIT_W = 8, DIGIT_H = 16, GAP = 2;
const LCD_PAD = 3, LCD_BORDER = 1;
const BUTTON = 30;          // art px, square (fits the 24 x 16 Claude plus bevel)
const ROW_H = BUTTON + 8;   // header height in art px

export function lcdSize(text) {
  let w = 0;
  [...text].forEach((ch, i) => {
    w += ch === ":" ? 2 : DIGIT_W;
    if (i < text.length - 1) w += GAP;
  });
  const pad = LCD_PAD + LCD_BORDER;
  return [w + 2 * pad, DIGIT_H + 2 * pad];
}

export function paintLcd(ctx, text, x, y, u, glow) {
  const [w, h] = lcdSize(text);
  ctx.fillStyle = T.DARK;
  ctx.fillRect(x, y, w * u, h * u);
  ctx.fillStyle = T.VOID;
  ctx.fillRect(x + u, y + u, (w - 2) * u, (h - 2) * u);
  const halo = rgba(T.LCD_ON, 40 / 255);
  let cx = x + (LCD_PAD + LCD_BORDER) * u;
  const cy = y + (LCD_PAD + LCD_BORDER) * u;
  for (const ch of text) {
    if (ch === ":") {
      for (const dy of [4, 10]) {
        if (glow) { ctx.fillStyle = halo; ctx.fillRect(cx - u, cy + (dy - 1) * u, 4 * u, 4 * u); }
        ctx.fillStyle = T.LCD_ON;
        ctx.fillRect(cx, cy + dy * u, 2 * u, 2 * u);
      }
      cx += (2 + GAP) * u;
      continue;
    }
    const lit = DIGIT_SEGS[ch] || "";
    ctx.fillStyle = T.LCD_OFF;
    for (const [seg, [sx, sy, sw, sh]] of Object.entries(SEGMENTS)) {
      if (!lit.includes(seg)) ctx.fillRect(cx + sx * u, cy + sy * u, sw * u, sh * u);
    }
    if (glow) {
      ctx.fillStyle = halo;
      for (const seg of lit) {
        const [sx, sy, sw, sh] = SEGMENTS[seg];
        ctx.fillRect(cx + (sx - 1) * u, cy + (sy - 1) * u, (sw + 2) * u, (sh + 2) * u);
      }
    }
    ctx.fillStyle = T.LCD_ON;
    for (const seg of lit) {
      const [sx, sy, sw, sh] = SEGMENTS[seg];
      ctx.fillRect(cx + sx * u, cy + sy * u, sw * u, sh * u);
    }
    cx += (DIGIT_W + GAP) * u;
  }
}

export class Header {
  constructor(canvas, onReset) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onReset = onReset;
    this.u = 2;
    this.glow = true;
    this.mines = 0;
    this.seconds = 0;
    this.state = "normal";       // normal | worried | win | lose
    this._down = false;
    this._inside = false;
    this._blink = false;
    this._winFrame = false;
    this._winTicks = 0;
    this._winTimer = null;

    setInterval(() => this._onIdle(), 3600);
    canvas.addEventListener("pointerdown", (e) => this._pointerDown(e));
    canvas.addEventListener("pointermove", (e) => this._pointerMove(e));
    canvas.addEventListener("pointerup", (e) => this._pointerUp(e));
    canvas.addEventListener("pointercancel", () => { this._down = false; this.draw(); });
  }

  // -- layout ---------------------------------------------------------------------

  /** Size the canvas to `cssWidth` and pick the art scale that fits. */
  resize(cssWidth, maxCssHeight) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cssWidth * dpr);
    // ~172 art px fit LCDs, button, mini mascot and spark side by side.
    let u = Math.max(1, Math.floor(w / 172));
    u = Math.max(1, Math.min(u, Math.floor((maxCssHeight * dpr) / ROW_H)));
    this.u = u;
    const h = ROW_H * u;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${h / dpr}px`;
    this.draw();
  }

  _buttonRect() {
    const s = BUTTON * this.u;
    return [Math.floor((this.canvas.width - s) / 2), Math.floor((this.canvas.height - s) / 2), s, s];
  }

  // -- state ----------------------------------------------------------------------

  setMines(n) { if (n !== this.mines) { this.mines = n; this.draw(); } }
  setTime(s) { if (s !== this.seconds) { this.seconds = s; this.draw(); } }

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    clearInterval(this._winTimer);
    this._winFrame = false;
    if (state === "win") {
      this._winTicks = 0;
      this._winTimer = setInterval(() => {
        this._winFrame = !this._winFrame;
        if (++this._winTicks > 14) { clearInterval(this._winTimer); this._winFrame = false; }
        this.draw();
      }, 200);
    }
    this.draw();
  }

  _onIdle() {
    if (this.state === "normal" && !this._down) {
      this._blink = true;
      this.draw();
      setTimeout(() => { this._blink = false; this.draw(); }, 140);
    }
  }

  // -- input ---------------------------------------------------------------------

  _hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const [bx, by, bw, bh] = this._buttonRect();
    const slack = 6 * this.u;     // generous touch target
    return x >= bx - slack && x < bx + bw + slack && y >= by - slack && y < by + bh + slack;
  }

  _pointerDown(e) {
    if (!this._hit(e)) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    this._down = true;
    this._inside = true;
    this.draw();
  }

  _pointerMove(e) {
    if (!this._down) return;
    const inside = this._hit(e);
    if (inside !== this._inside) { this._inside = inside; this.draw(); }
  }

  _pointerUp(e) {
    if (!this._down) return;
    this._down = false;
    const inside = this._hit(e);
    this.draw();
    if (inside) this.onReset();
  }

  // -- painting ------------------------------------------------------------------

  _timeText() {
    const s = Math.min(this.seconds, 99 * 60 + 59);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  _minesText() {
    const n = Math.max(-99, Math.min(999, this.mines));
    return n < 0 ? `-${String(-n).padStart(2, "0")}` : String(n).padStart(3, "0");
  }

  draw() {
    const { ctx, u } = this;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = T.BLACK;
    ctx.fillRect(0, 0, W, H);

    const mines = this._minesText();
    const clock = this._timeText();
    const [mw, mh] = lcdSize(mines);
    const [cw] = lcdSize(clock);
    const margin = 4 * u;
    const yLcd = Math.floor((H - mh * u) / 2);
    paintLcd(ctx, mines, margin, yLcd, u, this.glow);
    paintLcd(ctx, clock, W - margin - cw * u, yLcd, u, this.glow);

    const [bx, , bw] = this._buttonRect();
    const leftFree = bx - (margin + mw * u);
    const rightFree = W - margin - cw * u - (bx + bw);

    // Little mascot next to the mine counter.
    const [miw, mih] = mapSize(MAPS.MINE);
    if (leftFree > (miw + 8) * u) {
      drawMap(ctx, MAPS.MINE, margin + mw * u + Math.floor((leftFree - miw * u) / 2), Math.floor((H - mih * u) / 2), u);
    }

    // Claude spark (+ wordmark when there is room) next to the timer.
    const word = "Claude";
    const ws = u >= 2 ? u + 1 : u;
    const [sw, sh] = mapSize(MAPS.SPARK);
    const textW = textWidth(word, ws);
    const right = W - margin - cw * u;
    if (rightFree > sw * u + 3 * u + textW + 8 * u) {
      const total = sw * u + 3 * u + textW;
      const sx = right - Math.floor((rightFree + total) / 2);
      drawMap(ctx, MAPS.SPARK, sx, Math.floor((H - sh * u) / 2), u);
      drawText(ctx, word, sx + sw * u + 3 * u, Math.floor((H - CAP_H * ws) / 2), ws, T.BRIGHT, T.RUST);
    } else if (rightFree > (sw + 8) * u) {
      drawMap(ctx, MAPS.SPARK, right - Math.floor((rightFree + sw * u) / 2), Math.floor((H - sh * u) / 2), u);
    }

    this._paintButton();
  }

  _paintButton() {
    const { ctx, u } = this;
    const [x, y, s] = this._buttonRect();
    const down = this._down && this._inside;
    ctx.fillStyle = T.DARK;
    ctx.fillRect(x, y, s, s);
    const ix = x + u, iy = y + u, is = s - 2 * u;
    // Bevel (inverted while pressed)
    const [tl, br] = down ? [T.BURNT, T.BRIGHT] : [T.BRIGHT, T.BURNT];
    ctx.fillStyle = tl;
    ctx.fillRect(ix, iy, is, 2 * u);
    ctx.fillRect(ix, iy, 2 * u, is);
    ctx.fillStyle = br;
    ctx.fillRect(ix, iy + is - 2 * u, is, 2 * u);
    ctx.fillRect(ix + is - 2 * u, iy, 2 * u, is);
    const fx = ix + 2 * u, fy = iy + 2 * u, fs = is - 4 * u;
    ctx.fillStyle = down ? "#120703" : "#1c0c05";
    ctx.fillRect(fx, fy, fs, fs);

    const state = this.state;
    let face = state;
    if (down) face = "pressed";
    else if (state === "normal" && this._blink) face = "blink";
    const cheer = state === "win" && this._winFrame;
    const rows = mascot(face, cheer, cheer);
    const [w, h] = mapSize(rows);
    let mx = fx + Math.floor((fs - w * u) / 2) + (down ? u : 0);
    let my = fy + Math.floor((fs - h * u) / 2) + (down ? u : 0);
    if (cheer) my -= u;
    drawMap(ctx, rows, mx, my, u, state === "lose" ? { C: T.DARK } : null);
  }
}
