// Difficulty presets, persisted options and the best-times table
// (port of src/settings.py + src/scores.py). Everything lives in localStorage,
// on the phone only.

// Expert is 16 x 30 instead of 30 x 16: same field, turned to fit a portrait screen.
export const PRESETS = {
  beginner: { key: "beginner", label: "Beginner", width: 9, height: 9, mines: 10 },
  intermediate: { key: "intermediate", label: "Intermediate", width: 16, height: 16, mines: 40 },
  expert: { key: "expert", label: "Expert", width: 16, height: 30, mines: 99 },
};

export const CUSTOM_LIMITS = { width: [5, 30], height: [5, 40] };

// Keep room for the 3x3 safe zone around the first tap.
export const customMaxMines = (w, h) => Math.max(1, w * h - 9);

const SETTINGS_KEY = "claude-minesweeper.settings";
const SCORES_KEY = "claude-minesweeper.scores";

const DEFAULTS = {
  difficulty: "beginner",
  custom_width: 12,
  custom_height: 20,
  custom_mines: 40,
  sound: true,
  haptics: true,
  crt: true,
  scanlines: true,
  boot: true,
  mode: "dig",
  last_name: "",
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (_) {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) { /* storage full or blocked: keep playing */ }
}

export class Settings {
  constructor() {
    Object.assign(this, DEFAULTS);
    const data = readJSON(SETTINGS_KEY) || {};
    for (const [key, def] of Object.entries(DEFAULTS)) {
      if (key in data && typeof data[key] === typeof def) this[key] = data[key];
    }
    if (!(this.difficulty in PRESETS) && this.difficulty !== "custom") this.difficulty = "beginner";
    if (this.mode !== "dig" && this.mode !== "flag") this.mode = "dig";
    this.custom_width = clamp(Math.round(this.custom_width), ...CUSTOM_LIMITS.width);
    this.custom_height = clamp(Math.round(this.custom_height), ...CUSTOM_LIMITS.height);
    this.custom_mines = clamp(Math.round(this.custom_mines), 1, customMaxMines(this.custom_width, this.custom_height));
  }

  get current() {
    if (this.difficulty in PRESETS) return PRESETS[this.difficulty];
    const w = this.custom_width, h = this.custom_height;
    return { key: "custom", label: "Custom", width: w, height: h, mines: Math.min(this.custom_mines, customMaxMines(w, h)) };
  }

  save() {
    const out = {};
    for (const key of Object.keys(DEFAULTS)) out[key] = this[key];
    writeJSON(SETTINGS_KEY, out);
  }
}

export const MAX_ENTRIES = 5;
export const TRACKED = ["beginner", "intermediate", "expert"];

export function formatTime(seconds) {
  const total = Math.floor(seconds);
  return `${String(Math.min(Math.floor(total / 60), 99)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export class BestTimes {
  constructor() {
    this.table = Object.fromEntries(TRACKED.map((k) => [k, []]));
    const data = readJSON(SCORES_KEY) || {};
    for (const key of TRACKED) {
      const entries = [];
      for (const raw of data[key] || []) {
        if (raw && typeof raw.name === "string" && Number.isFinite(raw.seconds)) {
          entries.push({ name: raw.name.slice(0, 12), seconds: raw.seconds, date: String(raw.date || "") });
        }
      }
      this.table[key] = entries.sort((a, b) => a.seconds - b.seconds).slice(0, MAX_ENTRIES);
    }
  }

  save() {
    writeJSON(SCORES_KEY, this.table);
  }

  qualifies(difficulty, seconds) {
    const entries = this.table[difficulty];
    if (!entries) return false;
    return entries.length < MAX_ENTRIES || seconds < entries[entries.length - 1].seconds;
  }

  /** Insert a score; returns its 0-based rank, or -1 if it didn't make the table. */
  add(difficulty, name, seconds) {
    if (!this.qualifies(difficulty, seconds)) return -1;
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const entry = { name: name.trim().slice(0, 12) || "CLAUDE", seconds, date };
    const entries = this.table[difficulty];
    entries.push(entry);
    entries.sort((a, b) => a.seconds - b.seconds);
    entries.splice(MAX_ENTRIES);
    this.save();
    return entries.indexOf(entry);
  }

  reset() {
    this.table = Object.fromEntries(TRACKED.map((k) => [k, []]));
    this.save();
  }
}
