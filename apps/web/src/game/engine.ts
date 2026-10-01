/**
 * Pure Tetris rules: no DOM, no timers, no randomness it does not own. The
 * screen drives it with `tick`, `move`, `rotate` and `drop`.
 */

export const COLS = 10;
export const ROWS = 20;

export type PieceKind = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export type Cell = PieceKind | null;
export type Board = Cell[][];

/** Spawn shapes. Rotation is done by transposing the matrix, not by tables. */
const SHAPES: Record<PieceKind, number[][]> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

const KINDS: PieceKind[] = ["I", "O", "T", "S", "Z", "J", "L"];

export interface Piece {
  kind: PieceKind;
  shape: number[][];
  x: number;
  y: number;
}

export interface GameState {
  board: Board;
  piece: Piece;
  next: PieceKind;
  bag: PieceKind[];
  score: number;
  lines: number;
  over: boolean;
}

export type Rng = () => number;

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

/** 7-bag: every piece shows up once per seven, so droughts cannot happen. */
function drawFromBag(bag: PieceKind[], rng: Rng): { kind: PieceKind; bag: PieceKind[] } {
  let rest = bag;
  if (rest.length === 0) {
    rest = [...KINDS];
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
  }
  const [kind, ...remaining] = rest as [PieceKind, ...PieceKind[]];
  return { kind, bag: remaining };
}

export function rotateCw(shape: number[][]): number[][] {
  const n = shape.length;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => shape[n - 1 - c]![r]!));
}

function spawn(kind: PieceKind): Piece {
  const shape = SHAPES[kind].map((row) => [...row]);
  return { kind, shape, x: Math.floor((COLS - shape.length) / 2), y: kind === "I" ? -1 : 0 };
}

export function collides(board: Board, piece: Piece): boolean {
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape.length; c++) {
      if (!piece.shape[r]![c]) continue;
      const x = piece.x + c;
      const y = piece.y + r;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && board[y]![x]) return true;
    }
  }
  return false;
}

export function newGame(rng: Rng = Math.random): GameState {
  const first = drawFromBag([], rng);
  const second = drawFromBag(first.bag, rng);
  return {
    board: emptyBoard(),
    piece: spawn(first.kind),
    next: second.kind,
    bag: second.bag,
    score: 0,
    lines: 0,
    over: false,
  };
}

/** Milliseconds between gravity steps. One steady speed: score is all that counts. */
export const GRAVITY_MS = 600;

const LINE_POINTS = [0, 100, 300, 500, 800];

function lock(state: GameState, rng: Rng): GameState {
  const board = state.board.map((row) => [...row]);
  const { piece } = state;
  let toppedOut = false;
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape.length; c++) {
      if (!piece.shape[r]![c]) continue;
      const y = piece.y + r;
      if (y < 0) {
        toppedOut = true;
        continue;
      }
      board[y]![piece.x + c] = piece.kind;
    }
  }

  const kept = board.filter((row) => row.some((cell) => cell === null));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array<Cell>(COLS).fill(null));

  const lines = state.lines + cleared;
  const score = state.score + LINE_POINTS[cleared]!;

  const drawn = drawFromBag(state.bag, rng);
  const nextPiece = spawn(state.next);
  const over = toppedOut || collides(kept, nextPiece);
  return {
    board: kept,
    piece: nextPiece,
    next: drawn.kind,
    bag: drawn.bag,
    score,
    lines,
    over,
  };
}

/** One gravity step: fall a row, or lock where it stands. */
export function tick(state: GameState, rng: Rng = Math.random): GameState {
  if (state.over) return state;
  const moved = { ...state.piece, y: state.piece.y + 1 };
  if (!collides(state.board, moved)) return { ...state, piece: moved };
  return lock(state, rng);
}

export function move(state: GameState, dx: number): GameState {
  if (state.over) return state;
  const moved = { ...state.piece, x: state.piece.x + dx };
  return collides(state.board, moved) ? state : { ...state, piece: moved };
}

/** Clockwise, with a small set of wall kicks so rotating at an edge still works. */
export function rotate(state: GameState): GameState {
  if (state.over || state.piece.kind === "O") return state;
  const shape = rotateCw(state.piece.shape);
  for (const [dx, dy] of [
    [0, 0],
    [-1, 0],
    [1, 0],
    [-2, 0],
    [2, 0],
    [0, -1],
  ] as const) {
    const candidate = { ...state.piece, shape, x: state.piece.x + dx, y: state.piece.y + dy };
    if (!collides(state.board, candidate)) return { ...state, piece: candidate };
  }
  return state;
}

/** Soft drop: one row down for a point, locking if it cannot fall. */
export function softDrop(state: GameState, rng: Rng = Math.random): GameState {
  if (state.over) return state;
  const moved = { ...state.piece, y: state.piece.y + 1 };
  if (collides(state.board, moved)) return lock(state, rng);
  return { ...state, piece: moved, score: state.score + 1 };
}

export function ghostY(state: GameState): number {
  let y = state.piece.y;
  while (!collides(state.board, { ...state.piece, y: y + 1 })) y++;
  return y;
}

/** Hard drop: straight down, two points per row, and lock immediately. */
export function hardDrop(state: GameState, rng: Rng = Math.random): GameState {
  if (state.over) return state;
  const y = ghostY(state);
  const rows = y - state.piece.y;
  return lock({ ...state, piece: { ...state.piece, y }, score: state.score + rows * 2 }, rng);
}
