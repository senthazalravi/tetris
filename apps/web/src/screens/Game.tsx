import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronsDown,
  Pause,
  Play,
  RotateCw,
} from "lucide-react";
import {
  COLS,
  ROWS,
  ghostY,
  GRAVITY_MS,
  hardDrop,
  move,
  newGame,
  rotate,
  softDrop,
  tick,
  type GameState,
  type PieceKind,
} from "@/game/engine";
import { Button } from "@/ui/kit";
import { useSession } from "@/state/session";

const FALLBACK: Record<PieceKind, string> = {
  I: "#6a9bcc",
  O: "#d4a23a",
  T: "#9a7bb5",
  S: "#788c5d",
  Z: "#c4553e",
  J: "#4a6fa5",
  L: "#d97757",
};

/** Read the tetromino colours once per draw so a theme change is picked up. */
function pieceColors(): Record<PieceKind, string> {
  const out = { ...FALLBACK };
  for (const k of Object.keys(out) as PieceKind[]) {
    out[k] = cssVar(`--t-${k.toLowerCase()}`, FALLBACK[k]);
  }
  return out;
}

const NEXT_SHAPES: Record<PieceKind, number[][]> = {
  I: [[1, 1, 1, 1]],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
  ],
};

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** A flat, softly rounded block with a hairline inset. No gradients. */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  const pad = Math.max(1, size * 0.04);
  const w = size - pad * 2;
  const r = size * 0.16;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, w, w, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.beginPath();
  ctx.roundRect(x + pad + 0.5, y + pad + 0.5, w - 1, w - 1, r);
  ctx.stroke();
}

/** The landing spot of the falling piece: an outline, not a second piece. */
function drawGhost(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  const pad = Math.max(1.5, size * 0.07);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.14);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * The game column. It sizes the board to whatever room it is given (it lives
 * in a 30% column next to the chat), and a finished round unlocks chat search.
 * Purely a UI gate: the vault is already unlocked in memory.
 */
export function Game() {
  const markGameDone = useSession((s) => s.markGameDone);
  const chatOpen = useSession((s) => s.screen === "chat");

  const [game, setGame] = useState<GameState>(() => newGame());
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [focused, setFocused] = useState(false);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const stateRef = useRef(game);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef<HTMLCanvasElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  stateRef.current = game;

  // Largest whole-pixel cell that fits both ways, so the board never scrolls or distorts.
  const cell = Math.max(0, Math.floor(Math.min(room.w / COLS, room.h / ROWS)));
  const boardW = cell * COLS;
  const boardH = cell * ROWS;

  const apply = useCallback((fn: (s: GameState) => GameState) => {
    setGame((s) => {
      const next = fn(s);
      stateRef.current = next;
      return next;
    });
  }, []);

  const running = started && !paused && !game.over;
  // With a chat open beside the game, keys only steer the game while it has focus.
  const keysLive = !chatOpen || focused;

  useEffect(() => {
    if (game.over) markGameDone();
  }, [game.over, markGameDone]);

  function playAgain() {
    const fresh = newGame();
    stateRef.current = fresh;
    setGame(fresh);
    setPaused(false);
    setStarted(true);
  }

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => apply((s) => tick(s)), GRAVITY_MS);
    return () => window.clearInterval(id);
  }, [running, apply]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!keysLive) return;
      // Typing in a text field must never steer the game.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[role=dialog]")) return;
      const key = e.key;
      if (key === "Enter" && !started) {
        setStarted(true);
        return;
      }
      if (key === "p" || key === "P" || key === "Escape") {
        if (started && !stateRef.current.over) setPaused((p) => !p);
        return;
      }
      if (!running) return;
      switch (key) {
        case "ArrowLeft":
        case "a":
          apply((s) => move(s, -1));
          break;
        case "ArrowRight":
        case "d":
          apply((s) => move(s, 1));
          break;
        case "ArrowUp":
        case "w":
        case "x":
          apply(rotate);
          break;
        case "ArrowDown":
        case "s":
          apply((s) => softDrop(s));
          break;
        case " ":
          apply((s) => hardDrop(s));
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keysLive, running, started, apply]);

  // Auto-pause when the tab is hidden, so a round cannot be skipped by waiting.
  useEffect(() => {
    const onHide = () => document.hidden && started && setPaused(true);
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [started]);

  // Is there room to mirror the rail so the board is truly centered?
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure the room the column gives the board.
  useEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Board.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cell <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(boardW * dpr);
    canvas.height = Math.round(boardH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boardW, boardH);

    const colors = pieceColors();
    ctx.fillStyle = cssVar("--card", "#2d2c2a");
    ctx.fillRect(0, 0, boardW, boardH);
    ctx.strokeStyle = cssVar("--line", "rgba(250,249,245,.1)");
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cell, 0);
      ctx.lineTo(c * cell, boardH);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cell);
      ctx.lineTo(boardW, r * cell);
      ctx.stroke();
    }

    game.board.forEach((row, r) =>
      row.forEach((kind, c) => {
        if (kind) drawBlock(ctx, c * cell, r * cell, cell, colors[kind]);
      }),
    );

    if (!game.over) {
      const { piece } = game;
      const gy = ghostY(game);
      piece.shape.forEach((row, r) =>
        row.forEach((on, c) => {
          if (!on) return;
          if (gy !== piece.y) {
            drawGhost(ctx, (piece.x + c) * cell, (gy + r) * cell, cell, colors[piece.kind]);
          }
          if (piece.y + r >= 0) {
            drawBlock(ctx, (piece.x + c) * cell, (piece.y + r) * cell, cell, colors[piece.kind]);
          }
        }),
      );
    }
  }, [game, cell, boardW, boardH]);

  // Next piece preview.
  useEffect(() => {
    const canvas = nextRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const size = 16;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 4 * size * dpr;
    canvas.height = 2 * size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 4 * size, 2 * size);
    const shape = NEXT_SHAPES[game.next];
    const ox = ((4 - shape[0]!.length) * size) / 2;
    const oy = ((2 - shape.length) * size) / 2;
    shape.forEach((row, r) =>
      row.forEach((on, c) => {
        if (on) drawBlock(ctx, ox + c * size, oy + r * size, size, pieceColors()[game.next]);
      }),
    );
  }, [game.next]);

  const touch = (fn: (s: GameState) => GameState) => () => running && apply(fn);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
      className="flex h-full min-h-0 flex-col gap-3 px-4 pb-2 outline-none"
    >
      <div className="flex min-h-0 flex-1 items-stretch gap-3">
        {/* Left rail: full height. Stats on top, pause and key hints at the bottom. */}
        <aside
          className="flex shrink-0 flex-col gap-2.5"
          style={{ width: wide ? RAIL_WIDE : RAIL_NARROW }}
        >
          <RailCard label="Score" grow={1}>
            <div className="font-display text-5xl leading-none tabular">{game.score}</div>
          </RailCard>
          <RailCard label="Lines" grow={1}>
            <div className="font-display text-5xl leading-none tabular">{game.lines}</div>
          </RailCard>
          <RailCard label="Next" grow={1.1}>
            <canvas ref={nextRef} className="block h-8 w-16" />
          </RailCard>
          <RailCard
            label="Controls"
            grow={2.1}
            action={
              <button
                type="button"
                aria-label={paused ? "Resume" : "Pause"}
                title={paused ? "Resume (P)" : "Pause (P)"}
                disabled={!started || game.over}
                onClick={() => setPaused((p) => !p)}
                className="flex size-7 items-center justify-center rounded-lg text-muted transition hover:bg-s3 hover:text-fg disabled:opacity-40"
              >
                {paused ? <Play size={15} /> : <Pause size={15} />}
              </button>
            }
          >
            <dl className="hidden w-full grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-[11px] text-muted md:grid">
              <Key k="← →" label="Move" />
              <Key k="↑" label="Rotate" />
              <Key k="↓" label="Soft" />
              <Key k="Space" label="Drop" />
              <Key k="P" label="Pause" />
            </dl>
          </RailCard>
        </aside>

        <div ref={roomRef} className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          <div
            className="relative overflow-hidden rounded-xl border border-lines"
            style={{ width: boardW, height: boardH, visibility: cell > 0 ? "visible" : "hidden" }}
          >
            <canvas ref={canvasRef} className="block" style={{ width: boardW, height: boardH }} />

            {!started && (
              <Overlay>
                <h2 className="font-display text-4xl">Ready?</h2>
                <Button size="lg" onClick={() => setStarted(true)}>
                  <Play size={16} /> Start
                </Button>
              </Overlay>
            )}
            {paused && !game.over && (
              <Overlay>
                <h2 className="font-display text-4xl">Paused</h2>
                <Button size="lg" onClick={() => setPaused(false)}>
                  <Play size={16} /> Resume
                </Button>
              </Overlay>
            )}
            {game.over && (
              <Overlay>
                <h2 className="font-display text-4xl">Game over</h2>
                <p className="text-sm text-muted">
                  <b className="font-semibold text-fg">{game.score}</b> points ·{" "}
                  <b className="font-semibold text-fg">{game.lines}</b> lines
                </p>
                <Button size="lg" onClick={playAgain}>
                  <Play size={16} /> Play again
                </Button>
              </Overlay>
            )}
          </div>
        </div>

        {/* Mirror of the rail so the board is truly centered. */}
        {wide && <div className="shrink-0" style={{ width: RAIL_WIDE }} aria-hidden />}
      </div>

      <div
        className="grid w-full max-w-xs shrink-0 grid-cols-5 gap-2 self-center md:hidden"
        aria-label="Touch controls"
      >
        <PadButton label="Left" onPress={touch((s) => move(s, -1))}>
          <ArrowLeft size={20} />
        </PadButton>
        <PadButton label="Rotate" onPress={touch(rotate)}>
          <RotateCw size={20} />
        </PadButton>
        <PadButton label="Right" onPress={touch((s) => move(s, 1))}>
          <ArrowRight size={20} />
        </PadButton>
        <PadButton label="Down" onPress={touch((s) => softDrop(s))}>
          <ArrowDown size={20} />
        </PadButton>
        <PadButton label="Drop" onPress={touch((s) => hardDrop(s))}>
          <ChevronsDown size={20} />
        </PadButton>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/85 text-center">
      {children}
    </div>
  );
}

const RAIL_WIDE = 136;
const RAIL_NARROW = 116;

/** One tile of the left rail. `grow` is its share of the rail's full height. */
function RailCard({
  label,
  grow,
  action,
  children,
}: {
  label: string;
  grow: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="panel flex min-h-0 flex-col justify-between overflow-hidden rounded-xl p-3"
      style={{ flex: `${grow} 1 0%` }}
    >
      <header className="flex h-5 items-center justify-between">
        <h3 className="text-[11px] font-medium text-muted">{label}</h3>
        {action}
      </header>
      <div className="flex min-h-0 items-end">{children}</div>
    </section>
  );
}

function Key({ k, label }: { k: string; label: string }) {
  return (
    <>
      <dt>
        <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-line bg-s3 px-1.5 py-0.5 font-mono text-[10px] font-medium text-fg">
          {k}
        </kbd>
      </dt>
      <dd className="truncate">{label}</dd>
    </>
  );
}

function PadButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className="flex h-12 items-center justify-center rounded-xl border border-line bg-s2 text-fg active:bg-s3"
    >
      {children}
    </button>
  );
}
