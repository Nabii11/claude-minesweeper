// The minefield: touch input, zoom/pan, tile blitting and all the small 90s
// animations (port of src/ui/board_view.py). Everything is painted in device pixels.
//
// Touch controls
//   tap            reveal (DIG mode) / flag (FLAG mode); on a number: open its neighbours
//   hold           the opposite action (flag in DIG mode, reveal in FLAG mode)
//   drag           pan when zoomed in
//   pinch          zoom

import { LOST, WON } from "./board.js";
import { FxSystem, drawDisk, drawRing, glitchBlit } from "./fx.js";
import { T, CAP_H, drawTextCentered, makeCanvas, rgba, textWidth } from "./sprites.js";
import * as tiles from "./tiles.js";
import { formatTime } from "./store.js";

const FLASH_MS = 150;
const LONG_PRESS_MS = 360;
const SLOP_CSS = 9;            // finger movement allowed before a tap becomes a drag
const MAX_TILE_CSS = 56;       // zoom limit
const MAX_FIT_TILE_CSS = 64;

// Explosion timeline (ms after the boom)
const INVERT_MS = 70;
const FLASH_END = 210;
const RING_MS = 460;
const GLITCH_MS = [50, 380];
const SHAKE_MS = 420;
const WAVE_DELAY = 120;

const DANCE_MS = 3200;

export class BoardView {
  constructor(canvas, game, sound, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.game = game;
    this.sound = sound;
    this.opts = opts;    // { crt, mode, haptic(), onFace(face), onZoom(zoomed) }
    this.dpr = 1;
    this.W = 1;
    this.H = 1;
    this.zoom = 1;
    this.baseTile = 16;
    this.tile = 16;
    this.ox = 0;
    this.oy = 0;
    this._tilesets = new Map();
    this.tileset = null;
    this._bg = null;
    this._bgPattern = null;
    this._buf = null;

    this.pointers = new Map();
    this.gesture = null;
    this.pressed = null;          // [r, c] under a resting finger
    this._longTimer = null;

    this.fx = new FxSystem();
    this.fx.onFirework = () => this.sound.play("firework");
    this._resetAnim();
    this._raf = 0;
    this._loopUntilIdle = false;

    canvas.addEventListener("pointerdown", (e) => this._down(e));
    canvas.addEventListener("pointermove", (e) => this._move(e));
    canvas.addEventListener("pointerup", (e) => this._up(e));
    canvas.addEventListener("pointercancel", (e) => this._cancel(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    game.on("newGame", () => this._onNewGame());
    game.on("changed", () => this.invalidate());
  }

  _resetAnim() {
    this._appear = new Map();
    this.fx.clear();
    this._shakeUntil = 0;
    this._powerOn = -1e9;
    this._banner = null;
    this._bannerAt = 0;
    this._boom = null;
    this._waveSpeed = 0;
    this._waveEnd = 0;
    this._sweepStart = -1e9;
    this._sweepStep = 0;
    this._sweepEnd = -1e9;
    this._danceStart = -1e9;
  }

  // -- layout -------------------------------------------------------------------

  resize(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(cssW * dpr));
    const H = Math.max(1, Math.round(cssH * dpr));
    // Spurious resize events (keyboard, toolbars) must not throw away the player's zoom.
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.dpr = dpr;
    this.W = W;
    this.H = H;
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const block = Math.max(2, Math.round(2 * dpr));
    if (!this._bg || this._bgBlock !== block) {
      this._bg = tiles.ditherBackground(block);
      this._bgBlock = block;
      this._bgPattern = this.ctx.createPattern(this._bg, "repeat");
    }
    this._buf = null;
    this._relayout(true);
  }

  get pad() {
    return Math.round(10 * this.dpr);
  }

  _relayout(fit = false) {
    const b = this.game.board;
    const pad = this.pad;
    const fitTile = Math.floor(Math.min((this.W - 2 * pad) / b.width, (this.H - 2 * pad) / b.height));
    this.baseTile = Math.max(6, Math.min(fitTile, Math.round(MAX_FIT_TILE_CSS * this.dpr)));
    if (fit) this.zoom = 1;
    this.zoom = Math.min(Math.max(this.zoom, 1), this.maxZoom);
    this._setTile(Math.round(this.baseTile * this.zoom));
    if (fit) {
      this.ox = Math.round((this.W - b.width * this.tile) / 2);
      this.oy = Math.round((this.H - b.height * this.tile) / 2);
    }
    this._clampPan();
    this.opts.onZoom?.(this.zoom > 1.01);
    this.invalidate();
  }

  get maxZoom() {
    return Math.max(1, (MAX_TILE_CSS * this.dpr) / this.baseTile);
  }

  _setTile(t) {
    this.tile = Math.max(4, t);
    const key = `${this.tile}|${this.opts.crt ? 1 : 0}`;
    let ts = this._tilesets.get(key);
    if (!ts) {
      ts = new tiles.TileSet(this.tile, this.opts.crt);
      this._tilesets.set(key, ts);
      if (this._tilesets.size > 8) this._tilesets.delete(this._tilesets.keys().next().value);
    }
    this.tileset = ts;
  }

  _clampAxis(o, size, view) {
    const pad = this.pad;
    if (size <= view - 2 * pad) return Math.round((view - size) / 2);
    return Math.round(Math.min(pad, Math.max(view - pad - size, o)));
  }

  _clampPan() {
    const b = this.game.board;
    this.ox = this._clampAxis(this.ox, b.width * this.tile, this.W);
    this.oy = this._clampAxis(this.oy, b.height * this.tile, this.H);
  }

  /** Zoom keeping the board point under (px, py) in place. */
  _zoomAt(z, px, py, anchor) {
    this.zoom = Math.min(Math.max(z, 1), this.maxZoom);
    this._setTile(Math.round(this.baseTile * this.zoom));
    this.ox = px - anchor[0] * this.tile;
    this.oy = py - anchor[1] * this.tile;
    this._clampPan();
    this.opts.onZoom?.(this.zoom > 1.01);
    this.invalidate();
  }

  fit() {
    this._relayout(true);
  }

  setCrt(crt) {
    this.opts.crt = crt;
    this._setTile(this.tile);
    this.invalidate();
  }

  // -- geometry --------------------------------------------------------------------

  boardRect() {
    const b = this.game.board;
    return [this.ox, this.oy, b.width * this.tile, b.height * this.tile];
  }

  _cellCenter(r, c) {
    return [this.ox + (c + 0.5) * this.tile, this.oy + (r + 0.5) * this.tile];
  }

  _toDevice(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) * (this.W / rect.width), (e.clientY - rect.top) * (this.H / rect.height)];
  }

  _cellAt(x, y) {
    const c = Math.floor((x - this.ox) / this.tile);
    const r = Math.floor((y - this.oy) / this.tile);
    return this.game.board.inBounds(r, c) ? [r, c] : null;
  }

  _now() {
    return performance.now();
  }

  powerOn() {
    if (this.opts.crt) {
      this._powerOn = this._now();
      this._startLoop();
    }
  }

  // -- input -----------------------------------------------------------------------

  _down(e) {
    e.preventDefault();
    this.sound.unlock();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    const [x, y] = this._toDevice(e);
    this.pointers.set(e.pointerId, { x, y });

    if (this.pointers.size === 1) {
      if (this._banner && this.game.board.finished && this._now() >= this._bannerAt) {
        this._banner = null;
        this.gesture = { kind: "consumed", lastX: x, lastY: y };
        this.invalidate();
        return;
      }
      const cell = this._cellAt(x, y);
      this.gesture = { kind: "press", startX: x, startY: y, lastX: x, lastY: y, cell, fired: false };
      if (cell && !this.game.board.finished) {
        this.pressed = cell;
        this.opts.onFace?.("worried");
        clearTimeout(this._longTimer);
        this._longTimer = setTimeout(() => this._longPress(), LONG_PRESS_MS);
      }
    } else if (this.pointers.size === 2) {
      this._endPress();
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.gesture = {
        kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.zoom,
        anchor: [(mx - this.ox) / this.tile, (my - this.oy) / this.tile],
      };
    }
    this.invalidate();
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const [x, y] = this._toDevice(e);
    p.x = x;
    p.y = y;
    const g = this.gesture;
    if (!g) return;

    if (g.kind === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this._zoomAt(g.z0 * (d / g.d0), (a.x + b.x) / 2, (a.y + b.y) / 2, g.anchor);
      return;
    }
    if (g.kind === "press") {
      if (Math.hypot(x - g.startX, y - g.startY) > SLOP_CSS * this.dpr) {
        this._endPress();
        g.kind = "pan";
      }
    }
    if (g.kind === "pan" || g.kind === "consumed") {
      this.ox += x - g.lastX;
      this.oy += y - g.lastY;
      this._clampPan();
      this.invalidate();
    }
    g.lastX = x;
    g.lastY = y;
  }

  _up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g && g.kind === "press" && !g.fired && this.pointers.size === 0) {
      const cell = this.pressed;
      this._endPress();
      if (cell) this._tap(cell[0], cell[1]);
    }
    if (this.pointers.size === 1) {
      // Lifting one finger of a pinch: keep panning with the other, never tap.
      const [p] = [...this.pointers.values()];
      this.gesture = { kind: "pan", lastX: p.x, lastY: p.y };
    } else if (this.pointers.size === 0) {
      this._endPress();
      this.gesture = null;
    }
    this.invalidate();
  }

  _cancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this._endPress();
      this.gesture = null;
    }
    this.invalidate();
  }

  _endPress() {
    clearTimeout(this._longTimer);
    this._longTimer = null;
    if (this.pressed) {
      this.pressed = null;
      if (!this.game.board.finished) this.opts.onFace?.("normal");
    }
  }

  _longPress() {
    const g = this.gesture;
    if (!g || g.kind !== "press" || !this.pressed) return;
    g.fired = true;
    const [r, c] = this.pressed;
    this._endPress();
    const cell = this.game.board.cell(r, c);
    if (cell.revealed) this._apply(this.game.chord(r, c), [r, c]);
    else if (this.opts.mode === "dig") this._flag(r, c);
    else this._reveal(r, c);
    this.invalidate();
  }

  _tap(r, c) {
    const board = this.game.board;
    if (board.finished) return;
    const cell = board.cell(r, c);
    if (cell.revealed) this._apply(this.game.chord(r, c), [r, c]);
    else if (this.opts.mode === "flag") this._flag(r, c);
    else this._reveal(r, c);
  }

  _reveal(r, c) {
    this._apply(this.game.reveal(r, c), [r, c]);
  }

  _flag(r, c) {
    const result = this.game.toggleFlag(r, c);
    if (result === null) return;
    this.sound.play(result ? "flag" : "unflag");
    this.opts.haptic?.();
  }

  // -- move results -> animations ---------------------------------------------------

  _apply(result, origin) {
    if (!result.opened.length) return;
    const now = this._now();
    if (result.lost) {
      this._animateLoss(result, now);
      return;
    }
    this._animateReveal(result.opened, origin, now);
    if (result.won) this._animateWin(now);
    else this.sound.play(result.opened.length > 6 ? "cascade" : "reveal");
    this._startLoop();
  }

  _key(r, c) {
    return r * 1000 + c;
  }

  _animateReveal(opened, [orow, ocol], now) {
    const dist = opened.map((c) => Math.max(Math.abs(c.row - orow), Math.abs(c.col - ocol)));
    const far = Math.max(0, ...dist);
    const step = far ? Math.min(22, 420 / far) : 0;
    opened.forEach((cell, i) => this._appear.set(this._key(cell.row, cell.col), now + dist[i] * step));
  }

  /** Flash -> fire ring + shattered tile -> CRT glitch -> shockwave that uncovers the mines. */
  _animateLoss(result, now) {
    const board = this.game.board;
    const boom = result.exploded || result.opened[result.opened.length - 1];
    this._boom = [boom.row, boom.col, now];
    this._appear.set(this._key(boom.row, boom.col), now);
    for (const cell of result.opened) {
      const k = this._key(cell.row, cell.col);
      if (!cell.mine && !this._appear.has(k)) this._appear.set(k, now);
    }

    // Shockwave: reaches the farthest corner in 0.5-1.1 s. Mines pop in as it passes.
    const corners = [[0, 0], [0, board.width - 1], [board.height - 1, 0], [board.height - 1, board.width - 1]];
    const far = Math.max(...corners.map(([r, c]) => Math.hypot(r - boom.row, c - boom.col))) || 1;
    const duration = Math.min(1100, Math.max(500, far * 45));
    this._waveSpeed = far / duration;
    this._waveEnd = now + WAVE_DELAY + duration;
    for (const cell of [...board.minesToShow(), ...board.wrongFlags()]) {
      const d = Math.hypot(cell.row - boom.row, cell.col - boom.col);
      this._appear.set(this._key(cell.row, cell.col), now + WAVE_DELAY + d / this._waveSpeed);
    }

    const u = tiles.artUnit(this.tile);
    const [cx, cy] = this._cellCenter(boom.row, boom.col);
    const tx = this.ox + boom.col * this.tile;
    const ty = this.oy + boom.row * this.tile;
    this.fx.debris(this.tileset.get(tiles.CLOSED), tx, ty, this.tile, now, u);
    this.fx.embers(cx, cy, now, 30, u, [T.HOT, T.BRIGHT, T.AMBER, T.CREAM, "#5a1a06"]);
    this.fx.embers(cx, cy, now + 140, 14, u, [T.RUST, T.BURNT, "#2a0f05"],
      { speed: [0.03, 0.12], gravity: -0.00012, life: [700, 1200] });    // rising smoke
    this._shakeUntil = now + SHAKE_MS;
    this.sound.play("lose");
    this.opts.haptic?.();
    this._showBanner("GAME OVER", "Claude stepped on a mine", "Tap Claude to try again", this._waveEnd + 250);
    this._startLoop();
  }

  /** Diagonal light sweep -> flag Claudes dance -> Claude-spark fireworks. */
  _animateWin(now) {
    const board = this.game.board;
    this.sound.play("win");
    const diag = board.width + board.height - 1;
    this._sweepStep = Math.min(30, 650 / Math.max(1, diag));
    this._sweepStart = now + 60;
    this._sweepEnd = this._sweepStart + diag * this._sweepStep + 220;
    this._danceStart = this._sweepEnd - 200;

    const u = Math.max(1, Math.round(2 * this.dpr));
    const count = 5;
    const order = [...Array(count).keys()].sort(() => Math.random() - 0.5);
    order.forEach((slot, i) => {
      const x = this.W * (0.12 + (0.76 * (slot + Math.random() * 0.6)) / count);
      const y1 = this.H * (0.12 + Math.random() * 0.3);
      const at = this._sweepStart + 60 + i * 300 + Math.random() * 90;
      this.fx.rocket(x, this.H, y1, at, u);
    });
    if (this._banner) this._bannerAt = Math.max(this._bannerAt, this._sweepEnd + 80);
  }

  showWinBanner(seconds, record) {
    const sub = `TIME ${formatTime(seconds)}`;
    const foot = record ? "NEW BEST TIME!" : "Tap Claude to play again";
    this._showBanner("YOU WIN!", sub, foot, Math.max(this._now() + 350, this._sweepEnd + 80));
  }

  _showBanner(title, sub, foot, at) {
    this._banner = [title, sub, foot];
    this._bannerAt = at;
    this._startLoop();
  }

  _onNewGame() {
    this._resetAnim();
    this._endPress();
    this.gesture = null;
    this.pointers.clear();
    this._relayout(true);
    this.powerOn();
  }

  // -- frame loop ----------------------------------------------------------------------

  invalidate() {
    if (!this._raf) this._raf = requestAnimationFrame(() => this._frame());
  }

  _startLoop() {
    this._loopUntilIdle = true;
    this.invalidate();
  }

  _busy(now) {
    if (this._appear.size || this.fx.active) return true;
    if (now < this._shakeUntil || now < this._powerOn + 260) return true;
    if (now < this._waveEnd + 100 || now < this._sweepEnd) return true;
    if (now < this._danceStart + DANCE_MS) return true;
    if (this._boom && now < this._boom[2] + Math.max(RING_MS, GLITCH_MS[1])) return true;
    if (this._banner && now < this._bannerAt + 1200) return true;
    return false;
  }

  _frame() {
    this._raf = 0;
    const now = this._now();
    for (const [k, t0] of this._appear) if (now > t0 + FLASH_MS) this._appear.delete(k);
    this.fx.update(now);
    this._paint(now);
    if (this._loopUntilIdle) {
      if (this._busy(now)) this.invalidate();
      else this._loopUntilIdle = false;
    }
  }

  // -- painting ---------------------------------------------------------------------

  _tileKey(cell, now) {
    const board = this.game.board;
    const k = this._key(cell.row, cell.col);
    const pending = this._appear.has(k) && now < this._appear.get(k);
    const lost = board.state === LOST;

    if (lost && cell.exploded) return pending ? tiles.CLOSED : tiles.EXPLODED;
    if (lost && cell.flagged && !cell.mine) return pending ? tiles.FLAG : tiles.WRONG;
    if (lost && cell.mine && !cell.flagged) return pending ? tiles.CLOSED : tiles.MINE;
    if (cell.flagged) {
      if (board.state === WON) return this._danceKey(cell, now);
      if (this._isPressed(cell)) return "flag-lit";
      return tiles.FLAG;
    }
    if (cell.revealed) {
      if (pending) return tiles.CLOSED;
      return cell.adjacent || tiles.OPEN;
    }
    if (!board.finished && this._isPressed(cell)) return tiles.OPEN;
    return tiles.CLOSED;
  }

  _danceKey(cell, now) {
    let t = now - this._danceStart;
    if (t < 0 || t > DANCE_MS) return tiles.FLAG;
    // Each little Claude starts a beat later -> a ripple of hops across the board.
    t -= ((cell.row * 3 + cell.col * 5) % 8) * 45;
    if (t < 0) return tiles.FLAG;
    return `dance${Math.floor(t / 110) % 4}`;
  }

  /** Pressed look under the finger; on a number, its closed neighbours too (chord preview). */
  _isPressed(cell) {
    if (!this.pressed) return false;
    const [pr, pc] = this.pressed;
    const target = this.game.board.cell(pr, pc);
    if (target.revealed && target.adjacent) {
      return !cell.flagged && Math.max(Math.abs(cell.row - pr), Math.abs(cell.col - pc)) <= 1;
    }
    return cell.row === pr && cell.col === pc;
  }

  _glitchStrength(now) {
    if (!this.opts.crt || !this._boom) return 0;
    const t = now - this._boom[2];
    const [start, end] = GLITCH_MS;
    if (t < start || t >= end) return 0;
    const k = 1 - (t - start) / (end - start);
    return Math.max(2 * this.dpr, this.tile * 0.6 * k);
  }

  _paint(now) {
    const ctx = this.ctx;
    const glitch = this._glitchStrength(now);
    const negative = this._boom && now - this._boom[2] < INVERT_MS;
    if (glitch > 0 || negative) {
      // Render the scene off-screen first, then post-process it.
      if (!this._buf || this._buf.width !== this.W || this._buf.height !== this.H) this._buf = makeCanvas(this.W, this.H);
      const bctx = this._buf.getContext("2d");
      this._paintScene(bctx, now);
      if (negative) {
        // One hard "negative" frame, kept in the orange palette:
        // invert -> grayscale -> multiply over warm glow.
        bctx.globalCompositeOperation = "difference";
        bctx.fillStyle = "#fff";
        bctx.fillRect(0, 0, this.W, this.H);
        bctx.globalCompositeOperation = "saturation";
        bctx.fillStyle = "#808080";
        bctx.fillRect(0, 0, this.W, this.H);
        bctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = T.GLOW;
        ctx.fillRect(0, 0, this.W, this.H);
        ctx.globalCompositeOperation = "multiply";
        ctx.drawImage(this._buf, 0, 0);
        ctx.globalCompositeOperation = "source-over";
      } else {
        ctx.fillStyle = T.VOID;
        ctx.fillRect(0, 0, this.W, this.H);
        glitchBlit(ctx, this._buf, this.W, this.H, now, glitch, Math.max(1, Math.round(this.dpr)));
      }
    } else {
      this._paintScene(ctx, now);
    }
  }

  _paintScene(ctx, now) {
    ctx.fillStyle = this._bgPattern || T.VOID;
    ctx.fillRect(0, 0, this.W, this.H);

    let shake = 0;
    if (now < this._shakeUntil) {
      const k = (this._shakeUntil - now) / SHAKE_MS;
      shake = Math.round(Math.sin(now / 16) * 4 * k) * tiles.artUnit(this.tile);
    }
    ctx.save();
    ctx.translate(shake, 0);

    const [bx, by, bw, bh] = this.boardRect();
    // Board frame: thin orange border with a dark gap, like the reference window.
    const f = Math.max(1, Math.round(this.dpr));
    ctx.fillStyle = T.DARK;
    ctx.fillRect(bx - 5 * f, by - 5 * f, bw + 10 * f, bh + 10 * f);
    ctx.fillStyle = T.ORANGE;
    ctx.fillRect(bx - 3 * f, by - 3 * f, bw + 6 * f, bh + 6 * f);
    ctx.fillStyle = T.VOID;
    ctx.fillRect(bx - f, by - f, bw + 2 * f, bh + 2 * f);

    this._paintTiles(ctx, now, shake);
    this._paintExplosion(ctx, now);
    this.fx.paint(ctx, now);
    ctx.restore();
    this._paintInvert(ctx, now);
    this._paintBanner(ctx, now);
    this._paintPowerOn(ctx, now);
  }

  _paintTiles(ctx, now, shake) {
    const ts = this.tileset;
    const t = this.tile;
    const p = tiles.artUnit(t);
    const board = this.game.board;
    const [bx, by] = this.boardRect();
    // Only the tiles on screen.
    const r0 = Math.max(0, Math.floor(-by / t) - 1);
    const r1 = Math.min(board.height - 1, Math.floor((this.H - by) / t) + 1);
    const c0 = Math.max(0, Math.floor((-bx - Math.abs(shake)) / t));
    const c1 = Math.min(board.width - 1, Math.floor((this.W - bx + Math.abs(shake)) / t));

    let waveFront = null;
    if (this._boom) {
      const wt = now - this._boom[2] - WAVE_DELAY;
      if (wt >= 0 && now < this._waveEnd + 150) waveFront = wt * this._waveSpeed;
    }
    const sweeping = now >= this._sweepStart && now < this._sweepEnd;

    for (let r = r0; r <= r1; r++) {
      const y = by + r * t;
      for (let c = c0; c <= c1; c++) {
        const cell = board.cells[r][c];
        const x = bx + c * t;
        let dy = 0;
        if (waveFront !== null) {
          // Tiles hop as the shockwave rolls under them.
          const behind = waveFront - Math.hypot(r - this._boom[0], c - this._boom[1]);
          if (behind >= 0 && behind < 0.5) dy = -2 * p;
          else if (behind >= 0.5 && behind < 1) dy = -p;
          if (dy) { ctx.fillStyle = T.VOID; ctx.fillRect(x, y, t, t); }
        }
        ctx.drawImage(ts.get(this._tileKey(cell, now)), x, y + dy);
        const t0 = this._appear.get(this._key(r, c));
        if (t0 !== undefined && t0 <= now && now < t0 + FLASH_MS) {
          const a = 1 - (now - t0) / FLASH_MS;
          ctx.fillStyle = rgba(T.GLOW, (150 / 255) * a * a);
          ctx.fillRect(x, y + dy, t, t);
        }
        if (sweeping) {
          const phase = now - this._sweepStart - (r + c) * this._sweepStep;
          if (phase >= 0 && phase < 200) {
            const k = 1 - phase / 200;
            ctx.fillStyle = rgba(T.BRIGHT, (140 / 255) * k * k);
            ctx.fillRect(x, y, t, t);
            if (phase < 50) {   // leading edge: a crisp bright rim
              ctx.fillStyle = T.CREAM;
              ctx.fillRect(x, y, t, p);
              ctx.fillRect(x, y, p, t);
            }
          }
        }
      }
    }

    if (waveFront !== null && this.opts.crt) {
      // Faint dithered ring marking the shockwave front.
      const [cx, cy] = this._cellCenter(this._boom[0], this._boom[1]);
      const radius = waveFront * t;
      const fade = Math.max(0, 12 - Math.floor((12 * (now - this._boom[2])) / (this._waveEnd - this._boom[2] + 1)));
      if (radius > t && fade > 0) drawRing(ctx, cx, cy, radius, p * 2, Math.max(2, p * 2), T.AMBER, fade);
    }
  }

  _paintExplosion(ctx, now) {
    if (!this._boom) return;
    const age = now - this._boom[2];
    if (age >= RING_MS) return;
    const t = this.tile;
    const block = Math.max(2, tiles.artUnit(t) * 2);
    const [cx, cy] = this._cellCenter(this._boom[0], this._boom[1]);
    const k = age / RING_MS;
    const ease = 1 - (1 - k) ** 3;
    if (age < 140) {
      // White-hot core that swells then burns out.
      const core = t * (0.5 + (1.1 * age) / 140);
      drawDisk(ctx, cx, cy, core, block, T.CREAM, T.AMBER, 16 - Math.floor((10 * age) / 140));
    }
    const radius = t * (0.5 + 2.6 * ease);
    const thick = Math.max(block, t * 0.9 * (1 - k));
    const outer = k < 0.45 ? T.HOT : k < 0.8 ? T.BURNT : T.RUST;
    const inner = k < 0.35 ? T.AMBER : k < 0.7 ? T.BRIGHT : T.DARK;
    const density = 16 - Math.floor(9 * k * k);     // solid fire that frays only at the very end
    drawRing(ctx, cx, cy, radius, thick, block, outer, density);
    drawRing(ctx, cx, cy, radius - thick * 0.5, thick * 0.4, block, inner, Math.max(2, density - 4));
  }

  _paintInvert(ctx, now) {
    if (!this._boom) return;
    const age = now - this._boom[2];
    if (age >= INVERT_MS && age < FLASH_END) {
      const k = 1 - (age - INVERT_MS) / (FLASH_END - INVERT_MS);
      ctx.fillStyle = rgba(T.GLOW, (160 / 255) * k * k);
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  _paintBanner(ctx, now) {
    if (!this._banner || now < this._bannerAt) return;
    const [title, sub, foot] = this._banner;
    // The visible part of the board (or the whole view when zoomed far in).
    const [bx, by, bw, bh] = this.boardRect();
    let ax = Math.max(bx, 0), ay = Math.max(by, 0);
    let aw = Math.min(bx + bw, this.W) - ax, ah = Math.min(by + bh, this.H) - ay;
    if (aw < this.W * 0.6) { ax = 0; aw = this.W; }
    if (ah <= 0) { ay = 0; ah = this.H; }

    // Largest scale at which every line fits.
    let scale = Math.max(1, Math.floor(3 * this.dpr));
    let fs = 1, tw = 0;
    for (; scale >= 1; scale--) {
      fs = Math.max(1, Math.round((scale * 2) / 3));
      tw = Math.max(textWidth(title, scale * 2), textWidth(sub, scale), textWidth(foot, fs));
      if (tw + 14 * scale <= aw - 8 * this.dpr) break;
    }
    scale = Math.max(1, scale);
    const w = Math.min(aw - 8, tw + 14 * scale);
    const h = CAP_H * scale * 2 + CAP_H * (scale + fs) + 18 * scale;
    const cx = ax + aw / 2, cy = ay + ah / 2;
    let x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);

    const fill = (color, rx, ry, rw, rh) => { ctx.fillStyle = color; ctx.fillRect(rx, ry, rw, rh); };
    // Drop-in: the box grows in 3 chunky steps.
    const age = now - this._bannerAt;
    if (age < 90) {
      const k = (Math.floor(age / 30) + 1) / 4;
      fill(T.ORANGE, Math.round(cx - (w * k) / 2), Math.round(cy - (h * k) / 2), Math.round(w * k), Math.round(h * k));
      return;
    }
    fill("rgba(0,0,0,0.63)", x + scale, y + scale, w, h);
    fill(T.ORANGE, x, y, w, h);
    fill(T.BLACK, x + scale, y + scale, w - 2 * scale, h - 2 * scale);
    fill(T.DARK, x + 2 * scale, y + 2 * scale, w - 4 * scale, h - 4 * scale);
    fill(T.BLACK, x + 3 * scale, y + 3 * scale, w - 6 * scale, h - 6 * scale);
    // Title blinks a few times, then stays.
    let ty = y + 6 * scale;
    if (age > 900 || Math.floor(age / 150) % 2 === 0) {
      drawTextCentered(ctx, title, x, ty, w, CAP_H * scale * 2, scale * 2, T.BRIGHT, T.RUST);
    }
    ty += CAP_H * scale * 2 + 3 * scale;
    drawTextCentered(ctx, sub, x, ty, w, CAP_H * scale, scale, T.GLOW);
    ty += CAP_H * scale + 3 * scale;
    drawTextCentered(ctx, foot, x, ty, w, CAP_H * fs, fs, T.DARK);
  }

  _paintPowerOn(ctx, now) {
    const age = now - this._powerOn;
    if (age >= 240) return;
    const f = Math.max(1, Math.round(this.dpr));
    const [bx, by, bw, bh] = this.boardRect();
    const x = bx - 5 * f, y = by - 5 * f, w = bw + 10 * f, h = bh + 10 * f;
    const k = age / 240;
    const openH = Math.floor(h * k * k);
    const top = Math.round(y + h / 2 - openH / 2);
    ctx.fillStyle = T.VOID;
    ctx.fillRect(x, y, w, top - y);
    ctx.fillRect(x, top + openH, w, y + h - (top + openH));
    ctx.fillStyle = rgba(T.GLOW, (220 / 255) * (1 - k));
    ctx.fillRect(x, top - f, w, 2 * f);
    ctx.fillRect(x, top + openH, w, 2 * f);
  }
}
