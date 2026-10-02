// Pure minesweeper rules (port of src/board.py). No DOM in here.

export const READY = "ready";
export const PLAYING = "playing";
export const WON = "won";
export const LOST = "lost";

function makeCell(row, col) {
  return { row, col, mine: false, revealed: false, flagged: false, adjacent: 0, exploded: false };
}

export class Board {
  constructor(width, height, mines) {
    if (width < 2 || height < 2) throw new Error("board must be at least 2x2");
    const maxMines = width * height - 1;
    if (mines < 1 || mines > maxMines) throw new Error(`mines must be between 1 and ${maxMines}`);
    this.width = width;
    this.height = height;
    this.mines = mines;
    this.cells = [];
    for (let r = 0; r < height; r++) {
      const row = [];
      for (let c = 0; c < width; c++) row.push(makeCell(r, c));
      this.cells.push(row);
    }
    this.state = READY;
    this.revealedCount = 0;
    this.flagCount = 0;
  }

  // -- queries ------------------------------------------------------------

  cell(r, c) { return this.cells[r][c]; }

  inBounds(r, c) { return r >= 0 && r < this.height && c >= 0 && c < this.width; }

  neighbors(r, c) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < this.height && cc >= 0 && cc < this.width) out.push(this.cells[rr][cc]);
      }
    }
    return out;
  }

  *allCells() {
    for (const row of this.cells) yield* row;
  }

  get minesLeft() { return this.mines - this.flagCount; }
  get safeTotal() { return this.width * this.height - this.mines; }
  get finished() { return this.state === WON || this.state === LOST; }

  // -- setup ----------------------------------------------------------------

  _placeMines(safeRow, safeCol) {
    const key = (r, c) => r * this.width + c;
    const zone = new Set([key(safeRow, safeCol)]);
    for (const n of this.neighbors(safeRow, safeCol)) zone.add(key(n.row, n.col));
    let candidates = [];
    for (const cell of this.allCells()) if (!zone.has(key(cell.row, cell.col))) candidates.push(cell);
    if (candidates.length < this.mines) {
      // Board too dense for a full safe zone: only protect the tapped cell.
      candidates = [];
      for (const cell of this.allCells()) if (cell.row !== safeRow || cell.col !== safeCol) candidates.push(cell);
    }
    // Partial Fisher-Yates: the first `mines` entries become a uniform random sample.
    for (let i = 0; i < this.mines; i++) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      candidates[i].mine = true;
    }
    for (const cell of this.allCells()) {
      cell.adjacent = this.neighbors(cell.row, cell.col).filter((n) => n.mine).length;
    }
  }

  // -- actions --------------------------------------------------------------

  /** Reveal a cell. Returns newly revealed cells in flood-fill (BFS) order. */
  reveal(r, c) {
    if (this.finished || !this.inBounds(r, c)) return [];
    const cell = this.cells[r][c];
    if (cell.revealed || cell.flagged) return [];
    if (this.state === READY) {
      this._placeMines(r, c);
      this.state = PLAYING;
    }
    if (cell.mine) {
      cell.revealed = true;
      cell.exploded = true;
      this.state = LOST;
      return [cell];
    }
    const opened = this._flood(cell);
    this._checkWin();
    return opened;
  }

  _flood(start) {
    const opened = [];
    const queue = [start];
    start.revealed = true;
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      opened.push(cell);
      this.revealedCount++;
      if (cell.adjacent === 0) {
        for (const n of this.neighbors(cell.row, cell.col)) {
          if (!n.revealed && !n.flagged && !n.mine) {
            n.revealed = true;
            queue.push(n);
          }
        }
      }
    }
    return opened;
  }

  /** Reveal neighbours of a number once enough flags surround it. */
  chord(r, c) {
    if (this.state !== PLAYING || !this.inBounds(r, c)) return [];
    const cell = this.cells[r][c];
    if (!cell.revealed || cell.adjacent === 0) return [];
    const neighbors = this.neighbors(r, c);
    if (neighbors.filter((n) => n.flagged).length !== cell.adjacent) return [];
    const opened = [];
    for (const n of neighbors) {
      if (n.revealed || n.flagged) continue;
      if (n.mine) {
        n.revealed = true;
        n.exploded = true;
        this.state = LOST;
        opened.push(n);
      } else {
        opened.push(...this._flood(n));
      }
    }
    if (this.state !== LOST) this._checkWin();
    return opened;
  }

  /** Toggle a flag. Returns the new flag state, or null if nothing happened. */
  toggleFlag(r, c) {
    if (this.finished || !this.inBounds(r, c)) return null;
    const cell = this.cells[r][c];
    if (cell.revealed) return null;
    cell.flagged = !cell.flagged;
    this.flagCount += cell.flagged ? 1 : -1;
    return cell.flagged;
  }

  _checkWin() {
    if (this.revealedCount === this.safeTotal) {
      this.state = WON;
      for (const cell of this.allCells()) {
        if (cell.mine && !cell.flagged) {
          cell.flagged = true;
          this.flagCount++;
        }
      }
    }
  }

  /** Hidden mines to uncover after a loss (excludes correctly flagged ones). */
  minesToShow() {
    return [...this.allCells()].filter((c) => c.mine && !c.flagged && !c.exploded);
  }

  wrongFlags() {
    return [...this.allCells()].filter((c) => c.flagged && !c.mine);
  }
}
