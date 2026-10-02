// Game controller: owns the Board and the clock, and notifies the UI (port of src/game.py).

import { Board, READY, PLAYING, WON, LOST } from "./board.js";

export class Game {
  constructor(difficulty) {
    this.difficulty = difficulty;
    this.board = new Board(difficulty.width, difficulty.height, difficulty.mines);
    this._startedAt = 0;
    this._final = 0;
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
  }

  _emit(event, ...args) {
    for (const fn of this._listeners[event] || []) fn(...args);
  }

  restart(difficulty = null) {
    if (difficulty) this.difficulty = difficulty;
    const d = this.difficulty;
    this.board = new Board(d.width, d.height, d.mines);
    this._final = 0;
    this._emit("newGame");
    this._emit("changed");
  }

  get state() {
    return this.board.state;
  }

  get elapsed() {
    if (this.board.state === PLAYING) return (performance.now() - this._startedAt) / 1000;
    return this._final;
  }

  _afterMove(wasReady, opened) {
    const result = { opened, exploded: null, won: false, lost: false };
    if (wasReady && this.board.state !== READY) {
      this._startedAt = performance.now();
      this._emit("started");
    }
    if (this.board.finished) {
      this._final = (performance.now() - this._startedAt) / 1000;
      result.won = this.board.state === WON;
      result.lost = this.board.state === LOST;
      if (result.lost) result.exploded = opened.find((c) => c.exploded) || null;
      this._emit("finished", result.won, this._final);
    }
    this._emit("changed");
    return result;
  }

  reveal(r, c) {
    const wasReady = this.board.state === READY;
    const opened = this.board.reveal(r, c);
    if (!opened.length) return { opened, won: false, lost: false, exploded: null };
    return this._afterMove(wasReady, opened);
  }

  chord(r, c) {
    const opened = this.board.chord(r, c);
    if (!opened.length) return { opened, won: false, lost: false, exploded: null };
    return this._afterMove(false, opened);
  }

  toggleFlag(r, c) {
    const result = this.board.toggleFlag(r, c);
    if (result !== null) this._emit("changed");
    return result;
  }
}
