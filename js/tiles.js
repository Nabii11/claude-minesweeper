// Pre-rendered tile canvases for one tile size (port of src/ui/tiles.py).
// Drawing the board = blitting these.

import { T, MAPS, NUMBER_COLORS, BAYER4, BOLD_W, BOLD_H, drawMap, drawBoldDigit, mapSize, makeCanvas, rgba, seeded } from "./sprites.js";

export const CLOSED = "closed";
export const OPEN = "open";
export const FLAG = "flag";
export const MINE = "mine";
export const EXPLODED = "exploded";
export const WRONG = "wrong";

/** Screen pixels per art pixel for a tile of `size` px (tiles are 16 art px). */
export const artUnit = (size) => Math.max(1, Math.floor(size / 16));
/** Scale for sprites/digits: a bit more generous so in-between sizes don't look tiny. */
export const spriteUnit = (size) => Math.max(1, Math.floor(size / 14));

export class TileSet {
  constructor(size, glow) {
    this.size = size;
    this.p = artUnit(size);
    this.sp = spriteUnit(size);
    this.glow = glow;
    this.pix = new Map();
    this._build();
  }

  _new() {
    const c = makeCanvas(this.size, this.size);
    const ctx = c.getContext("2d");
    ctx.fillStyle = T.OPEN;
    ctx.fillRect(0, 0, this.size, this.size);
    return [c, ctx];
  }

  _closed(ctx, pressedLook = false) {
    const s = this.size, p = this.p;
    // Face: two browns mixed with ordered dithering -> a soft vertical gradient.
    const top = pressedLook ? "#46210d" : "#361a0b";
    const bottom = pressedLook ? "#2f170a" : "#231108";
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 0, s, s);
    const cells = Math.max(1, Math.floor(s / p));
    ctx.fillStyle = top;
    for (let gy = 0; gy < cells; gy++) {
      const level = Math.floor(16 * Math.pow(1 - gy / Math.max(1, cells - 1), 1.3));
      for (let gx = 0; gx < cells; gx++) {
        if (BAYER4[gy % 4][gx % 4] < level) ctx.fillRect(gx * p, gy * p, p, p);
      }
    }
    // Bevel: warm orange light from the top-left, deep shadow bottom-right.
    const fill = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    const hiOuter = pressedLook ? T.ORANGE : T.DARK;
    fill(hiOuter, 0, 0, s, p);
    fill(hiOuter, 0, 0, p, s);
    fill("#6a2a0e", p, p, s - 2 * p, p);
    fill("#6a2a0e", p, p, p, s - 2 * p);
    fill("#050201", 0, s - p, s, p);
    fill("#050201", s - p, 0, p, s);
    fill("#140803", p, s - 2 * p, s - 2 * p, p);
    fill("#140803", s - 2 * p, p, p, s - 2 * p);
    // Tiny specular pixel on the corner, very CRT-bezel.
    fill(pressedLook ? T.AMBER : T.BRIGHT, 0, 0, p, p);
  }

  _open(ctx) {
    const s = this.size;
    const line = Math.max(1, Math.floor(this.p / 2));
    ctx.fillStyle = T.OPEN;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = T.GRID;
    ctx.fillRect(0, 0, s, line);
    ctx.fillRect(0, 0, line, s);
  }

  _sprite(ctx, rows, recolor = null, dy = 0) {
    const [w, h] = mapSize(rows);
    const p = this.sp;
    const x = Math.floor((this.size - w * p) / 2);
    const y = Math.floor((this.size - h * p) / 2) + dy * p;
    drawMap(ctx, rows, x, y, p, recolor);
  }

  _put(key, paint) {
    const [c, ctx] = this._new();
    paint(ctx);
    this.pix.set(key, c);
  }

  _build() {
    const s = this.size, p = this.p;

    this._put(CLOSED, (ctx) => this._closed(ctx, false));
    // Held-down look while a finger rests on a closed tile (desktop: hover).
    this._put("lit", (ctx) => this._closed(ctx, true));
    this._put(OPEN, (ctx) => this._open(ctx));

    for (let n = 1; n <= 8; n++) {
      this._put(n, (ctx) => {
        this._open(ctx);
        const color = NUMBER_COLORS[n];
        const sp = this.sp;
        const x = Math.floor((s - BOLD_W * sp) / 2) + Math.floor(sp / 2);
        const y = Math.floor((s - BOLD_H * sp) / 2) + Math.floor(sp / 2);
        if (this.glow) {
          const halo = rgba(color, 48 / 255);
          for (const [dx, dy] of [[-sp, 0], [sp, 0], [0, -sp], [0, sp]]) drawBoldDigit(ctx, n, x + dx, y + dy, sp, halo);
        }
        drawBoldDigit(ctx, n, x + sp, y + sp, sp, "#2a0f05");
        drawBoldDigit(ctx, n, x, y, sp, color);
      });
    }

    this._put(FLAG, (ctx) => { this._closed(ctx, false); this._sprite(ctx, MAPS.FLAG); });
    this._put("flag-lit", (ctx) => { this._closed(ctx, true); this._sprite(ctx, MAPS.FLAG); });

    // Victory dance: hop up two art pixels while swapping legs and flapping the pennant.
    [[0, MAPS.FLAG], [-1, MAPS.FLAG_ALT], [-2, MAPS.FLAG], [-1, MAPS.FLAG_ALT]].forEach(([dy, rows], i) => {
      this._put(`dance${i}`, (ctx) => { this._closed(ctx, false); this._sprite(ctx, rows, null, dy); });
    });

    this._put(MINE, (ctx) => { this._open(ctx); this._sprite(ctx, MAPS.MINE); });

    this._put(EXPLODED, (ctx) => {
      ctx.fillStyle = "#a8290a";
      ctx.fillRect(0, 0, s, s);
      const cells = Math.max(1, Math.floor(s / p));
      ctx.fillStyle = T.HOT;
      for (let gy = 0; gy < cells; gy++) {
        for (let gx = 0; gx < cells; gx++) {
          const d = Math.abs(gx - cells / 2) + Math.abs(gy - cells / 2);
          const level = Math.max(0, 16 - Math.floor(d * 1.6));
          if (BAYER4[gy % 4][gx % 4] < level) ctx.fillRect(gx * p, gy * p, p, p);
        }
      }
      this._sprite(ctx, MAPS.MINE_DEAD);
    });

    this._put(WRONG, (ctx) => {
      this._open(ctx);
      ctx.globalAlpha = 0.45;
      this._sprite(ctx, MAPS.FLAG);
      ctx.globalAlpha = 1;
      this._sprite(ctx, MAPS.CROSS);
    });
  }

  get(key) {
    return this.pix.get(key);
  }
}

/** Black field with the diagonal orange dither streaks from the reference art. */
export function ditherBackground(block = 2, n = 128) {
  const rng = seeded(42);
  const c = makeCanvas(n * block, n * block);
  const ctx = c.getContext("2d");
  ctx.fillStyle = T.VOID;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      // Two diagonal wave bands, tileable over n.
      const a = 0.5 + 0.5 * Math.sin((2 * Math.PI * (gx + gy) / n) * 2);
      const b = 0.5 + 0.5 * Math.sin((2 * Math.PI * (gx + gy) / n) * 5 + 1.3);
      let v = Math.pow(a, 6) * 0.75 + Math.pow(b, 12) * 0.35;
      v *= 0.55 + 0.45 * rng();
      const t = (BAYER4[gy % 4][gx % 4] + 0.5) / 16;
      if (v > t + 0.18) {
        ctx.fillStyle = v > 0.72 ? "#7a2c0e" : v > 0.45 ? "#4f1c09" : "#2e1106";
        ctx.fillRect(gx * block, gy * block, block, block);
      }
    }
  }
  return c;
}

/** Faint grain for the CRT overlay (used as a CSS background image). */
export function noiseTexture(size = 128) {
  const rng = seeded(7);
  const c = makeCanvas(size, size);
  const ctx = c.getContext("2d");
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = rng();
      if (r < 0.06) { ctx.fillStyle = "rgba(255,180,120,0.055)"; ctx.fillRect(x, y, 1, 1); }
      else if (r < 0.12) { ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(x, y, 1, 1); }
    }
  }
  return c;
}
