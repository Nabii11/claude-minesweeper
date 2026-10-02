// Pixel effects: particles, debris, fireworks, fire rings and the CRT glitch
// (port of src/ui/fx.py). Particles are hard-edged blocks that blink out at the
// end of their life, the way 90s games did it.

import { T, BAYER4, rgba, seeded } from "./sprites.js";

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class FxSystem {
  constructor() {
    this.particles = [];
    this.rockets = [];
    this._last = null;
    this.onFirework = null;
  }

  clear() {
    this.particles = [];
    this.rockets = [];
    this._last = null;
  }

  get active() {
    return this.particles.length > 0 || this.rockets.length > 0;
  }

  // -- emitters -------------------------------------------------------------

  embers(cx, cy, at, count, unit, colors, { speed = [0.08, 0.34], gravity = 0.0005, life = [600, 1100] } = {}) {
    for (let i = 0; i < count; i++) {
      const ang = rand(0, TAU);
      const sp = rand(speed[0], speed[1]) * unit;
      this.particles.push({
        x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.06 * unit,
        size: unit * choice([1, 1, 2]), color: choice(colors), born: at, life: rand(life[0], life[1]),
        gravity: gravity * unit, drag: 0.0015, src: null,
      });
    }
  }

  /** Shatter a tile into square chunks that fly out and fall. */
  debris(tile, x, y, size, at, unit, pieces = 4) {
    const step = Math.max(1, Math.floor(size / pieces));
    const cx = x + size / 2, cy = y + size / 2;
    for (let gy = 0; gy < pieces; gy++) {
      for (let gx = 0; gx < pieces; gx++) {
        const px = x + gx * step, py = y + gy * step;
        const dx = px + step / 2 - cx, dy = py + step / 2 - cy;
        const norm = Math.hypot(dx, dy) || 1;
        const sp = rand(0.12, 0.3) * unit;
        this.particles.push({
          x: px, y: py, vx: (dx / norm) * sp + rand(-0.03, 0.03) * unit,
          vy: (dy / norm) * sp - rand(0.12, 0.3) * unit,
          size: step, color: T.BRIGHT, born: at, life: rand(750, 1050),
          gravity: 0.0011 * unit, drag: 0.0008, src: [tile, gx * step, gy * step],
        });
      }
    }
  }

  rocket(x, y0, y1, at, unit) {
    this.rockets.push({ x, y0, y1, born: at, dur: rand(520, 720), unit, trail: [] });
  }

  /** Firework in the shape of the Claude spark: 8 rays of blocks plus glitter. */
  sparkBurst(cx, cy, at, unit) {
    const rays = 8;
    const rot = choice([0, Math.PI / 8]);
    const base = rand(0.2, 0.27) * unit;
    const palette = choice([
      [T.CREAM, T.GLOW, T.AMBER, T.BRIGHT],
      [T.GLOW, T.BRIGHT, T.ORANGE, T.HOT],
      [T.CREAM, T.AMBER, T.ORANGE, T.DARK],
    ]);
    for (let i = 0; i < rays; i++) {
      const ang = rot + (i * TAU) / rays;
      const length = i % 2 === 0 ? 1.0 : 0.72;     // long / short rays like the logo
      for (let j = 0; j < 6; j++) {
        const sp = base * length * (0.3 + (0.7 * j) / 5);
        this.particles.push({
          x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          size: unit * (j >= 4 ? 2 : 1) + unit, color: palette[Math.min(3, 5 - j)],
          born: at, life: rand(850, 1150), gravity: 0.00009 * unit, drag: 0.0018, src: null,
        });
      }
    }
    this.embers(cx, cy, at, 14, unit, palette, { speed: [0.03, 0.14], gravity: 0.0002, life: [900, 1400] });
    // Bright core that pops for a moment
    this.particles.push({
      x: cx - 2 * unit, y: cy - 2 * unit, vx: 0, vy: 0, size: 5 * unit, color: T.CREAM,
      born: at, life: 110, gravity: 0, drag: 0, src: null,
    });
  }

  // -- simulation -------------------------------------------------------------

  update(now) {
    const dt = this._last === null ? 16 : Math.max(1, Math.min(50, now - this._last));
    this._last = now;
    const alive = [];
    for (const p of this.particles) {
      if (now < p.born) { alive.push(p); continue; }
      if (now - p.born > p.life) continue;
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alive.push(p);
    }
    this.particles = alive;

    const flying = [];
    for (const r of this.rockets) {
      if (now < r.born) { flying.push(r); continue; }
      const k = Math.min(1, (now - r.born) / r.dur);
      const y = r.y0 + (r.y1 - r.y0) * (1 - (1 - k) ** 2);
      const wobble = Math.sin((now - r.born) / 45) * r.unit;
      r.trail.push([Math.floor(r.x + wobble), Math.floor(y)]);
      if (r.trail.length > 6) r.trail.splice(0, r.trail.length - 6);
      if (k >= 1) {
        this.sparkBurst(r.x, r.y1, now, r.unit);
        if (this.onFirework) this.onFirework();
        continue;
      }
      flying.push(r);
    }
    this.rockets = flying;
  }

  // -- painting ------------------------------------------------------------------

  paint(ctx, now) {
    const blink = Math.floor(now / 60) % 2;
    for (const p of this.particles) {
      if (now < p.born) continue;
      const age = (now - p.born) / p.life;
      if (age >= 1 || (age > 0.66 && blink)) continue;
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (p.src) {
        const [tile, sx, sy] = p.src;
        ctx.drawImage(tile, sx, sy, p.size, p.size, x, y, p.size, p.size);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(x, y, p.size, p.size);
      }
    }
    const trail = [T.RUST, T.BURNT, T.DARK, T.ORANGE, T.AMBER, T.CREAM];
    for (const r of this.rockets) {
      if (now < r.born) continue;
      const n = r.trail.length;
      r.trail.forEach(([x, y], i) => {
        ctx.fillStyle = trail[Math.max(0, 6 - n + i)];
        const s = r.unit * (i === n - 1 ? 2 : 1);
        ctx.fillRect(x, y, s, s);
      });
    }
  }
}

/** Chunky pixel ring. density 0..16 thins it out with ordered dithering. */
export function drawRing(ctx, cx, cy, radius, thickness, block, color, density = 16) {
  if (radius <= 0) return;
  const seen = new Set();
  ctx.fillStyle = color;
  let r = Math.max(0, radius - thickness);
  while (r <= radius) {
    const n = Math.max(8, Math.floor((TAU * r) / block) + 1);
    for (let i = 0; i < n; i++) {
      const a = (TAU * i) / n;
      const bx = Math.floor((cx + r * Math.cos(a)) / block);
      const by = Math.floor((cy + r * Math.sin(a)) / block);
      const key = bx * 100003 + by;
      if (seen.has(key)) continue;
      seen.add(key);
      if (BAYER4[((by % 4) + 4) % 4][((bx % 4) + 4) % 4] < density) ctx.fillRect(bx * block, by * block, block, block);
    }
    r += block;
  }
}

export function drawDisk(ctx, cx, cy, radius, block, inner, outer, density = 16) {
  const rb = Math.floor(radius / block) + 1;
  const gx0 = Math.floor(cx / block), gy0 = Math.floor(cy / block);
  for (let gy = gy0 - rb; gy <= gy0 + rb; gy++) {
    for (let gx = gx0 - rb; gx <= gx0 + rb; gx++) {
      const d = Math.hypot(gx * block + block / 2 - cx, gy * block + block / 2 - cy);
      if (d > radius || BAYER4[((gy % 4) + 4) % 4][((gx % 4) + 4) % 4] >= density) continue;
      ctx.fillStyle = d < radius * 0.55 ? inner : outer;
      ctx.fillRect(gx * block, gy * block, block, block);
    }
  }
}

/** Draw `buffer` sliced into horizontal bands with jittered offsets (lost-signal CRT). */
export function glitchBlit(ctx, buffer, width, height, now, strength, unit = 1) {
  const rng = seeded(Math.floor(now / 40));
  const randint = (a, b) => a + Math.floor(rng() * (b - a + 1));
  let y = 0;
  while (y < height) {
    const bh = randint(3, 26) * unit;
    let off = 0;
    if (rng() < 0.5) off = Math.floor((rng() * 2 - 1) * strength);
    ctx.drawImage(buffer, 0, y, width, bh, off, y, width, bh);
    if (off) {
      // Colour-bleed sliver on the leading edge
      ctx.fillStyle = rgba(T.HOT, 110 / 255);
      ctx.fillRect(off < 0 ? off : 0, y, Math.abs(off), bh);
    }
    y += bh;
  }
  // A couple of bright interference lines and a rolling dark bar
  ctx.fillStyle = rgba(T.GLOW, 90 / 255);
  for (let i = 0; i < 3; i++) ctx.fillRect(0, randint(0, Math.max(1, height)), width, (rng() < 0.5 ? 1 : 2) * unit);
  ctx.fillStyle = "rgba(0,0,0,0.27)";
  const roll = Math.floor(((now / 3) * unit) % Math.max(1, height));
  ctx.fillRect(0, roll, width, Math.max(6 * unit, Math.floor(height / 14)));
}
