// Claude Minesweeper (mobile): wiring, menus and dialogs (port of src/ui/main_window.py
// and src/ui/dialogs.py).

import { BoardView } from "./boardview.js";
import { Game } from "./game.js";
import { haptic } from "./haptics.js";
import { Header } from "./header.js";
import { SoundPlayer } from "./sound.js";
import { Splash } from "./splash.js";
import { MAPS, mapCanvas, mascot } from "./sprites.js";
import { BestTimes, CUSTOM_LIMITS, PRESETS, Settings, TRACKED, customMaxMines, formatTime } from "./store.js";
import { noiseTexture } from "./tiles.js";

const VERSION = "1.0";
const $ = (sel) => document.querySelector(sel);

const settings = new Settings();
const scores = new BestTimes();
const sound = new SoundPlayer();
sound.enabled = settings.sound;

const game = new Game(settings.current);
const header = new Header($("#header"), () => {
  sound.unlock();
  sound.play("button");
  newGame();
});
const view = new BoardView($("#board"), game, sound, {
  crt: settings.crt,
  mode: settings.mode,
  haptic: () => haptic(settings.haptics),
  onFace: (face) => { if (!game.board.finished) header.setState(face); },
  onZoom: (zoomed) => { $("#fit").hidden = !zoomed; },
});

// ------------------------------------------------------------------ game flow ---

function newGame(difficulty = null) {
  game.restart(difficulty);
}

game.on("newGame", () => {
  header.setState("normal");
  header.setMines(game.board.minesLeft);
  header.setTime(0);
});
game.on("changed", () => header.setMines(game.board.minesLeft));
game.on("finished", (won, seconds) => {
  header.setState(won ? "win" : "lose");
  header.setTime(Math.floor(seconds));
  if (!won) return;
  const key = game.difficulty.key;
  const record = scores.qualifies(key, seconds);
  view.showWinBanner(seconds, record);
  if (record) {
    const board = game.board;
    setTimeout(() => {
      if (game.board === board) recordDialog(key, seconds);
    }, 2200);
  }
});

setInterval(() => {
  if (game.state === "playing") header.setTime(Math.floor(game.elapsed));
}, 250);

header.setMines(game.board.minesLeft);

// ---------------------------------------------------------------------- layout ---

function layout() {
  const wrap = $("#header-wrap");
  header.resize(wrap.clientWidth, 96);
  const bw = $("#board-wrap");
  view.resize(bw.clientWidth, bw.clientHeight);
}

window.addEventListener("resize", layout);
window.addEventListener("orientationchange", () => setTimeout(layout, 250));

// --------------------------------------------------------------------- toolbar ---

function setMode(mode) {
  settings.mode = mode;
  view.opts.mode = mode;
  settings.save();
  for (const btn of document.querySelectorAll("#mode button")) {
    btn.setAttribute("aria-checked", String(btn.dataset.mode === mode));
  }
}

const PICK = [
  "..AAAAAAA..",
  ".AA..B..AA.",
  "AA...B...AA",
  "A....B....A",
  ".....B.....",
  ".....B.....",
  ".....B.....",
  ".....B.....",
  ".....B.....",
  ".....B.....",
  ".....B.....",
  ".....B.....",
];

function iconCanvas(rows, scaleCss) {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const c = mapCanvas(rows, scaleCss * dpr);
  c.style.width = `${rows[0].length * scaleCss}px`;
  c.style.height = `${rows.length * scaleCss}px`;
  return c;
}

$("#icon-dig").appendChild(iconCanvas(PICK, 2));
$("#icon-flag").appendChild(iconCanvas(MAPS.FLAG, 2));
$("#menubar-icon").appendChild(iconCanvas(MAPS.MINE, 2));
for (const btn of document.querySelectorAll("#mode button")) {
  btn.addEventListener("click", () => {
    sound.unlock();
    if (settings.mode !== btn.dataset.mode) {
      setMode(btn.dataset.mode);
      sound.play("button");
      haptic(settings.haptics);
    }
  });
}
setMode(settings.mode);

$("#fit").addEventListener("click", () => view.fit());

// ------------------------------------------------------------------------ CRT ---

function applyCrt() {
  const crt = $("#crt");
  crt.classList.toggle("glow", settings.crt);
  crt.classList.toggle("scanlines", settings.scanlines);
  header.glow = settings.crt;
  header.draw();
  view.setCrt(settings.crt);
}
$("#crt").style.setProperty("--noise", `url(${noiseTexture().toDataURL()})`);
applyCrt();

// ----------------------------------------------------------------------- menus ---

const menus = {
  game: () => [
    { label: "New Game", action: () => newGame() },
    "-",
    ...Object.values(PRESETS).map((d) => ({
      label: d.label, hint: `${d.width}x${d.height}`, radio: settings.difficulty === d.key,
      action: () => setDifficulty(d.key),
    })),
    { label: "Custom...", radio: settings.difficulty === "custom", action: customDialog },
    "-",
    { label: "Best Times...", action: () => bestTimesDialog() },
  ],
  options: () => [
    toggle("Sound", "sound", () => { sound.enabled = settings.sound; }),
    toggle("Vibration", "haptics"),
    "-",
    toggle("CRT Effect", "crt", applyCrt),
    toggle("Scanlines", "scanlines", applyCrt),
    toggle("Boot Screen", "boot"),
  ],
  help: () => [
    { label: "How to Play", action: howToPlay },
    { label: "Install on iPhone", action: installDialog },
    { label: "About", action: aboutDialog },
  ],
};

function toggle(label, key, after = null) {
  return {
    label, check: settings[key], keepOpen: true,
    action: () => {
      settings[key] = !settings[key];
      settings.save();
      after?.();
    },
  };
}

function setDifficulty(key) {
  settings.difficulty = key;
  settings.save();
  newGame(settings.current);
}

let openMenu = null;

function showMenu(name) {
  const layer = $("#menu-layer");
  const panel = $("#menu-panel");
  const title = document.querySelector(`.menu-title[data-menu="${name}"]`);
  panel.replaceChildren();
  for (const item of menus[name]()) {
    if (item === "-") {
      panel.appendChild(Object.assign(document.createElement("div"), { className: "menu-sep" }));
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.setAttribute("role", "menuitem");
    const ind = document.createElement("span");
    ind.className = "ind";
    if (item.check !== undefined) ind.classList.add(item.check ? "check-on" : "check-off");
    if (item.radio !== undefined) ind.classList.add(item.radio ? "radio-on" : "radio-off");
    btn.append(ind, item.label);
    if (item.hint) btn.appendChild(Object.assign(document.createElement("span"), { className: "hint", textContent: item.hint }));
    btn.addEventListener("click", () => {
      sound.play("button");
      if (item.keepOpen) {
        item.action();
        showMenu(name);      // refresh the check marks
      } else {
        closeMenu();
        item.action();
      }
    });
    panel.appendChild(btn);
  }
  document.querySelectorAll(".menu-title").forEach((t) => t.classList.toggle("open", t === title));
  layer.hidden = false;
  const tr = title.getBoundingClientRect();
  const left = Math.max(8, Math.min(tr.left, window.innerWidth - panel.offsetWidth - 8));
  panel.style.left = `${left}px`;
  panel.style.top = `${tr.bottom}px`;
  openMenu = name;
}

function closeMenu() {
  $("#menu-layer").hidden = true;
  document.querySelectorAll(".menu-title").forEach((t) => t.classList.remove("open"));
  openMenu = null;
}

document.querySelectorAll(".menu-title").forEach((title) => {
  title.addEventListener("click", () => {
    sound.unlock();
    sound.play("button");
    if (openMenu === title.dataset.menu) closeMenu();
    else showMenu(title.dataset.menu);
  });
});
$("#menu-layer").addEventListener("pointerdown", (e) => {
  if (e.target === e.currentTarget) {
    e.preventDefault();
    closeMenu();
  }
});

// --------------------------------------------------------------------- dialogs ---

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Retro dialog. buttons: [{label, value, default}] -> resolves with the chosen value. */
function dialog(title, body, buttons = [{ label: "OK", value: true, default: true }]) {
  return new Promise((resolve) => {
    const layer = $("#dialog-layer");
    const close = (value) => {
      layer.hidden = true;
      layer.replaceChildren();
      resolve(value);
    };
    const row = el("div", { className: "dialog-buttons" });
    for (const b of buttons) {
      const btn = el("button", { className: `btn${b.default ? " default" : ""}`, textContent: b.label });
      btn.addEventListener("click", () => {
        sound.play("button");
        if (b.validate && !b.validate()) return;
        close(b.value);
      });
      row.appendChild(btn);
    }
    const box = el("div", { className: "dialog", role: "dialog" },
      el("div", { className: "dialog-title" }, iconCanvas(MAPS.MINE, 2), title),
      el("div", { className: "dialog-body" }, body),
      row);
    layer.replaceChildren(box);
    layer.hidden = false;
  });
}

function heading(text, art = null) {
  const h = el("div", { className: "heading" });
  if (art) h.appendChild(art);
  h.appendChild(el("span", { className: "hot", textContent: text, style: "font-size:24px" }));
  return h;
}

function howToPlay() {
  const keys = el("dl", { className: "keys" });
  for (const [k, v] of [
    ["TAP", "Dig a square (DIG mode) or plant a flag (FLAG mode)"],
    ["HOLD", "The other action: flag in DIG mode, dig in FLAG mode"],
    ["TAP A NUMBER", "Open its neighbours once enough flags surround it"],
    ["PINCH / DRAG", "Zoom in and move around the field"],
    ["CLAUDE", "New game"],
  ]) keys.append(el("dt", { textContent: k }), el("dd", { textContent: v }));
  dialog("How to Play", el("div", {},
    heading("HOW TO PLAY"),
    el("p", { textContent: "Find every safe square without waking a hidden Claude." }),
    keys,
    el("p", { textContent: "Each number tells you how many mines touch that square (including diagonals)." }),
    el("p", { textContent: "Your first tap is always safe. Clear the field as fast as you can to earn a place in the Best Times table." })));
}

function aboutDialog() {
  dialog("About", el("div", {},
    heading("CLAUDE MINESWEEPER", iconCanvas(mascot("normal"), 2)),
    el("p", { className: "dim", textContent: `Version ${VERSION} (mobile)` }),
    el("p", { textContent: "A retro minesweeper built around Claude. Black, orange and a little CRT glow." }),
    el("p", { textContent: "Pixel art, font and sounds are all hand-made for this game." }),
    el("p", { textContent: "Works offline: once it is on your home screen it needs no internet." }),
    el("p", { className: "hot", textContent: "By Nabil" })));
}

function installDialog() {
  const standalone = isStandalone();
  dialog("Install", el("div", {},
    heading("INSTALL"),
    standalone
      ? el("p", { textContent: "Already installed! You are playing from the home screen, fully offline." })
      : el("div", {},
        el("p", { textContent: "In Safari:" }),
        el("p", { className: "hot", textContent: "1. Tap the Share button" }),
        el("p", { className: "hot", textContent: "2. Add to Home Screen" }),
        el("p", { className: "dim", textContent: "(Compartir > Añadir a pantalla de inicio)" }),
        el("p", { textContent: "Then open it from its icon: full screen, and it works without internet." }))));
}

function customDialog() {
  let w = settings.custom_width, h = settings.custom_height, m = settings.custom_mines;
  const density = el("p", { className: "dim" });
  const outputs = {};
  const refresh = () => {
    m = Math.min(Math.max(m, 1), customMaxMines(w, h));
    outputs.w.textContent = w;
    outputs.h.textContent = h;
    outputs.m.textContent = m;
    density.textContent = `${w}x${h} field · ${Math.round((m / (w * h)) * 100)}% mines`;
  };
  const stepper = (label, key, get, set, lo, hi, step) => {
    const out = el("output");
    outputs[key] = out;
    const make = (text, delta) => {
      const btn = el("button", { className: "btn", textContent: text });
      let timer = null;
      const bump = () => { set(Math.min(Math.max(get() + delta * (key === "m" ? step() : 1), lo), hi())); refresh(); };
      const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        bump();
        timer = setTimeout(() => { timer = setInterval(bump, 70); }, 380);
      });
      btn.addEventListener("pointerup", stop);
      btn.addEventListener("pointerleave", stop);
      btn.addEventListener("pointercancel", stop);
      return btn;
    };
    return el("div", { className: "stepper" }, el("span", { textContent: label }), make("-", -1), out, make("+", 1));
  };
  const body = el("div", {},
    el("p", { textContent: "Design your own minefield." }),
    stepper("Width", "w", () => w, (v) => { w = v; }, CUSTOM_LIMITS.width[0], () => CUSTOM_LIMITS.width[1]),
    stepper("Height", "h", () => h, (v) => { h = v; }, CUSTOM_LIMITS.height[0], () => CUSTOM_LIMITS.height[1]),
    stepper("Mines", "m", () => m, (v) => { m = v; }, 1, () => customMaxMines(w, h), () => (m >= 50 ? 5 : 1)),
    density);
  refresh();
  dialog("Custom Field", body, [
    { label: "Cancel", value: false },
    { label: "Play", value: true, default: true },
  ]).then((ok) => {
    if (!ok) return;
    settings.custom_width = w;
    settings.custom_height = h;
    settings.custom_mines = m;
    setDifficulty("custom");
  });
}

function bestTimesDialog(highlight = null) {
  const body = el("div", { className: "scores" });
  for (const key of TRACKED) {
    const d = PRESETS[key];
    body.appendChild(el("h3", { textContent: `${d.label.toUpperCase()}  ${d.width}x${d.height}` }));
    const entries = scores.table[key];
    if (!entries.length) {
      body.appendChild(el("div", { className: "empty", textContent: "- no times yet -" }));
      continue;
    }
    const table = el("table");
    entries.forEach((e, i) => {
      const tr = el("tr", {},
        el("td", { className: "rank", textContent: `${i + 1}.` }),
        el("td", { textContent: e.name }),
        el("td", { className: "time", textContent: formatTime(e.seconds) }),
        el("td", { className: "date", textContent: e.date.slice(2) }));
      if (highlight && highlight[0] === key && highlight[1] === i) tr.className = "me";
      table.appendChild(tr);
    });
    body.appendChild(table);
  }
  dialog("Best Times", el("div", {}, heading("BEST TIMES", iconCanvas(MAPS.SPARK, 2)), body), [
    { label: "Reset", value: "reset" },
    { label: "OK", value: true, default: true },
  ]).then(async (v) => {
    if (v !== "reset") return;
    const sure = await dialog("Reset", el("p", { textContent: "Erase all best times?" }), [
      { label: "No", value: false },
      { label: "Yes", value: true, default: true },
    ]);
    if (sure) scores.reset();
    bestTimesDialog();
  });
}

function recordDialog(key, seconds) {
  if (!scores.qualifies(key, seconds)) return;
  const input = el("input", { type: "text", maxLength: 12, value: settings.last_name, autocomplete: "off",
    autocapitalize: "words", spellcheck: false, enterKeyHint: "done" });
  const body = el("div", {},
    heading("NEW BEST TIME!", iconCanvas(MAPS.SPARK, 2)),
    el("p", { textContent: `${PRESETS[key].label} in ${formatTime(seconds)}` }),
    el("p", { className: "dim", textContent: "Enter your name:" }),
    input);
  const done = dialog("Best Time", body, [{ label: "OK", value: true, default: true }]);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#dialog-layer .btn.default").click();
  });
  done.then(() => {
    const name = input.value.trim() || "CLAUDE";
    settings.last_name = name;
    settings.save();
    const rank = scores.add(key, name, seconds);
    bestTimesDialog(rank >= 0 ? [key, rank] : null);
  });
}

// ------------------------------------------------------------------- install ---

function isStandalone() {
  return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function maybeSuggestInstall() {
  if (!isIOS() || isStandalone()) return;
  try {
    if (sessionStorage.getItem("install-hint")) return;
    sessionStorage.setItem("install-hint", "1");
  } catch (_) { /* private mode */ }
  installDialog();
}

// Offline cache. Skipped on localhost while developing (add ?sw to test it there).
const devHost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if ("serviceWorker" in navigator && location.protocol !== "file:" && (!devHost || location.search.includes("sw"))) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
if (devHost) window.__dbg = { game, view, header, settings };

// ---------------------------------------------------------------------- start ---

// iOS unlocks audio on touch *release*; listen to every gesture end to be safe.
sound.init();
for (const type of ["pointerdown", "pointerup", "touchend", "click"]) {
  document.addEventListener(type, () => sound.unlock(), { capture: true, passive: true });
}
// iOS double-tap-to-zoom and long-press menus off the game surfaces.
document.addEventListener("gesturestart", (e) => e.preventDefault());

function start() {
  layout();
  view.powerOn();
  maybeSuggestInstall();
}

document.fonts?.load("16px ClaudePixel").catch(() => {}).finally(() => {
  if (settings.boot) {
    const canvas = $("#splash");
    canvas.hidden = false;
    new Splash(canvas, sound, () => {
      canvas.hidden = true;
      start();
    });
    layout();
  } else {
    start();
  }
});
