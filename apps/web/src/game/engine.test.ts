import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLS,
  ROWS,
  collides,
  emptyBoard,
  GRAVITY_MS,
  hardDrop,
  move,
  newGame,
  rotate,
  tick,
  type Cell,
  type GameState,
} from "./engine";

const rng = () => 0.5;

test("a new game starts empty with a live piece", () => {
  const g = newGame(rng);
  assert.equal(g.over, false);
  assert.equal(g.score, 0);
  assert.ok(g.board.every((row) => row.length === COLS && row.every((c) => c === null)));
  assert.equal(g.board.length, ROWS);
  assert.ok(!collides(g.board, g.piece));
});

test("the bag deals every piece once per seven", () => {
  let g = newGame(rng);
  const seen = [g.piece.kind, g.next];
  for (let i = 0; i < 5; i++) {
    g = hardDrop({ ...g, board: emptyBoard() }, rng);
    seen.push(g.next);
  }
  assert.equal(new Set(seen).size, 7);
});

test("pieces cannot leave the walls", () => {
  let g = newGame(rng);
  for (let i = 0; i < 20; i++) g = move(g, -1);
  assert.ok(!collides(g.board, g.piece));
  const left = g.piece.x;
  assert.equal(move(g, -1).piece.x, left);
});

test("rotation keeps the piece legal, even against a wall", () => {
  let g = newGame(rng);
  g = { ...g, piece: { ...g.piece, kind: "I", shape: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], x: 0, y: 5 } };
  g = rotate(g);
  assert.ok(!collides(g.board, g.piece));
});

test("hard drop locks the piece and clears a full row", () => {
  const board = emptyBoard();
  // Bottom row full except the two columns an O piece will fill.
  board[ROWS - 1] = Array.from({ length: COLS }, (_, c): Cell => (c === 4 || c === 5 ? null : "T"));
  board[ROWS - 2] = Array.from({ length: COLS }, (_, c): Cell => (c === 4 || c === 5 ? null : "T"));
  let g: GameState = newGame(rng);
  g = { ...g, board, piece: { kind: "O", shape: [[1, 1], [1, 1]], x: 4, y: 0 } };
  g = hardDrop(g, rng);
  assert.equal(g.lines, 2);
  assert.ok(g.score >= 300);
  assert.ok(g.board[ROWS - 1]!.every((c) => c === null));
});

test("topping out ends the game", () => {
  let g = newGame(rng);
  // Everything filled except column 0, so no row can ever complete.
  const board = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, (_, c): Cell => (c === 0 ? null : "T")),
  );
  g = { ...g, board };
  for (let i = 0; i < 3 && !g.over; i++) g = tick(g, rng);
  assert.equal(g.over, true);
});

test("gravity is one steady speed and scoring has no level multiplier", () => {
  assert.ok(GRAVITY_MS > 0);
  const board = emptyBoard();
  board[ROWS - 1] = Array.from({ length: COLS }, (_, c): Cell => (c < 2 ? null : "T"));
  let g: GameState = newGame(rng);
  g = { ...g, board, piece: { kind: "O", shape: [[1, 1], [1, 1]], x: 0, y: 0 } };
  g = hardDrop(g, rng);
  assert.equal(g.lines, 1);
  assert.equal(g.score, 100 + 2 * (ROWS - 2));
});
