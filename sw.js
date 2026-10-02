// Offline support: on install, every file of the game is stored on the phone;
// afterwards the game loads from that copy and never needs the network.
// Bump VERSION whenever any file changes so phones pick up the update.

const VERSION = "v1";
const CACHE = `claude-minesweeper-${VERSION}`;

const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/main.js",
  "js/board.js",
  "js/boardview.js",
  "js/data.js",
  "js/fx.js",
  "js/game.js",
  "js/haptics.js",
  "js/header.js",
  "js/sound.js",
  "js/splash.js",
  "js/sprites.js",
  "js/store.js",
  "js/tiles.js",
  "assets/fonts/ClaudePixel.ttf",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/sprites/check_on.png",
  "assets/sprites/check_off.png",
  "assets/sprites/radio_on.png",
  "assets/sprites/radio_off.png",
  ...["reveal", "cascade", "flag", "unflag", "button", "win", "lose", "firework", "boot"].map((n) => `assets/sounds/${n}.wav`),
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("claude-minesweeper-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first: instant start and fully offline. Anything not cached falls back to the network.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).catch(() => {
        if (event.request.mode === "navigate") return caches.match("index.html");
        return Response.error();
      });
    }),
  );
});
