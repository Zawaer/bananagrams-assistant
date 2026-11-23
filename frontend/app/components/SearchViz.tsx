"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Placement, SolveFrame, SolveResult } from "../lib/api";
import { Tile } from "./Tile";

// ============================================================================
// The search, on a board
//
// While the solver works, its board is drawn as it stands: words drop in as
// it places them and lift off when it backs out of a dead end. Slow hands
// stream snapshots live; most hands are solved in a few milliseconds, so for
// them the recorded trace is replayed at a pace you can follow, then the
// solution is built word by word.
// ============================================================================

const UNIT = 40; // board units in px before the camera scales them
const GAP = 3;
const STAGE_H = 300;
const EXPLORE_STEPS = 56; // most steps of the recorded search to show
const EXPLORE_MS = 2000; // spread over about this long
const LIVE_HOLD_MS = 240; // shortest time a live snapshot stays up

type Step = { stack: Placement[]; ms: number; tried: number; final?: boolean };
type Cell = { key: string; letter: string; r: number; c: number };

const same = (a: Placement, b: Placement) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

function cellsOf(stack: Placement[]) {
  const cells = new Map<string, Cell>();
  for (const [word, row, col, across] of stack)
    [...word].forEach((letter, i) => {
      const r = across ? row : row + i;
      const c = across ? col + i : col;
      const key = `${r},${c},${letter}`;
      cells.set(key, { key, letter, r, c });
    });
  return cells;
}

// Steps from where the board stands to the answer (or the closest miss),
// preceded by a sampled replay of the recorded search unless the search was
// already watched live.
function buildScript(result: SolveResult, from: Placement[] | null): Step[] {
  const t = result.trace!;
  const steps: Step[] = [];
  let stack = from ?? [];

  if (!from) {
    const snaps: { stack: Placement[]; tried: number }[] = [];
    let s: Placement[] = [];
    let tried = 0;
    for (const e of t.events) {
      if (e === 0) s = s.slice(0, -1);
      else {
        s = [...s, e];
        tried++;
      }
      snaps.push({ stack: s, tried });
    }
    const keep = Math.min(snaps.length, EXPLORE_STEPS);
    const ms = Math.max(45, Math.min(140, EXPLORE_MS / Math.max(1, keep)));
    for (let i = 1; i <= keep; i++) {
      const snap = snaps[Math.round((i * snaps.length) / keep) - 1];
      steps.push({ stack: snap.stack, ms, tried: t.truncated ? Math.round((t.nodes * i) / keep) : snap.tried });
    }
    stack = snaps.at(-1)?.stack ?? [];
  }

  const target = result.solved ? t.path : t.closest;
  let common = 0;
  while (common < stack.length && common < target.length && same(stack[common], target[common])) common++;
  while (stack.length > common) {
    stack = stack.slice(0, -1);
    steps.push({ stack, ms: 70, tried: t.nodes });
  }
  while (stack.length < target.length) {
    stack = target.slice(0, stack.length + 1);
    steps.push({ stack, ms: 170, tried: t.nodes });
  }
  steps.push({ stack, ms: result.solved ? 700 : 1300, tried: t.nodes, final: true });
  return steps;
}

export function SearchViz({
  letters,
  live,
  result,
  onDone,
}: {
  letters: string[];
  /** Latest snapshot of a slow search, while it runs. */
  live: SolveFrame | null;
  /** The answer, once it's in (with its trace). */
  result: SolveResult | null;
  onDone: () => void;
}) {
  const [script, setScript] = useState<Step[] | null>(null);
  const [at, setAt] = useState(0);
  // Live snapshots come every 80 ms, each a different board; holding each
  // one on screen a little longer lets it land before the next replaces it.
  const [shown, setShown] = useState<SolveFrame | null>(null);
  const lastShown = useRef(0);
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => {
      lastShown.current = Date.now();
      setShown(live);
    }, Math.max(0, lastShown.current + LIVE_HOLD_MS - Date.now()));
    return () => clearTimeout(t);
  }, [live]);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  // The answer arrived: script the rest from the board on screen...
  const [scriptFor, setScriptFor] = useState<SolveResult | null>(null);
  if (result !== scriptFor) {
    setScriptFor(result);
    setScript(result?.trace ? buildScript(result, shown?.path ?? null) : null);
    setAt(0);
  }
  // ...or skip it all for reduced motion.
  useEffect(() => {
    if (result && (!result.trace || matchMedia("(prefers-reduced-motion: reduce)").matches)) doneRef.current();
  }, [result]);

  useEffect(() => {
    if (!script) return;
    if (at >= script.length) return doneRef.current();
    const t = setTimeout(() => setAt((i) => i + 1), script[at].ms);
    return () => clearTimeout(t);
  }, [script, at]);

  const step = script?.[Math.min(at, script.length - 1)];
  const stack = useMemo(() => step?.stack ?? shown?.path ?? [], [step, shown]);
  const tried = step?.tried ?? live?.nodes ?? 0;
  const final = !!step?.final;

  // ── Tiles: what's on the board, plus the ones lifting off ────────────────
  const cells = useMemo(() => cellsOf(stack), [stack]);
  const head = useMemo(() => {
    const top = stack.at(-1);
    return new Set(top && !final ? cellsOf([top]).keys() : []);
  }, [stack, final]);
  const [ghosts, setGhosts] = useState<(Cell & { id: number })[]>([]);
  const prev = useRef(cells);
  const ghostId = useRef(0);
  useEffect(() => {
    const gone = [...prev.current.values()].filter((c) => !cells.has(c.key));
    prev.current = cells;
    if (!gone.length) return;
    const added = gone.map((c) => ({ ...c, id: ghostId.current++ }));
    setGhosts((g) => [...g.filter((x) => !cells.has(x.key)), ...added]);
    const ids = new Set(added.map((g) => g.id));
    setTimeout(() => setGhosts((g) => g.filter((x) => !ids.has(x.id))), 260);
  }, [cells]);

  // ── Camera: fit the current board into the stage, easing between fits ───
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The fit covers a few steps either side, so the camera eases ahead of the
  // board instead of chasing it, and words lifting off stay in view.
  const camera = useMemo(() => {
    const near = !script
      ? ghosts
      : final
        ? []
        : script.slice(Math.max(0, at - 3), at + 5).flatMap((s) => [...cellsOf(s.stack).values()]);
    const all = [...cells.values(), ...near];
    if (!all.length) return { x: 0, y: 0, s: 1 };
    const rs = all.map((c) => c.r);
    const cs = all.map((c) => c.c);
    const [r0, r1, c0, c1] = [Math.min(...rs), Math.max(...rs), Math.min(...cs), Math.max(...cs)];
    const w = (c1 - c0 + 1) * (UNIT + GAP) - GAP;
    const h = (r1 - r0 + 1) * (UNIT + GAP) - GAP;
    const s = Math.min(1, (width - 24) / w, (STAGE_H - 24) / h);
    return {
      s,
      x: width / 2 - (c0 * (UNIT + GAP) + w / 2) * s,
      y: STAGE_H / 2 - (r0 * (UNIT + GAP) + h / 2) * s,
    };
  }, [cells, ghosts, script, at, final, width]);

  // ── The hand: tiles go dim as they're put on the board ───────────────────
  const rack = useMemo(() => {
    const onBoard = new Map<string, number>();
    for (const c of cells.values()) onBoard.set(c.letter, (onBoard.get(c.letter) ?? 0) + 1);
    return [...letters]
      .map((l) => l.toUpperCase())
      .sort((a, b) => a.localeCompare(b, "fi"))
      .map((l) => {
        const left = onBoard.get(l) ?? 0;
        onBoard.set(l, left - 1);
        return { letter: l, spent: left > 0 };
      });
  }, [cells, letters]);

  const placed = cells.size;
  const occupied = new Set([...cells.values()].map((c) => `${c.r},${c.c}`));
  const waiting = !stack.length && !script;

  return (
    <div className="viz stack">
      <div
        ref={stage}
        className={final ? "viz-stage viz-final" : "viz-stage"}
        style={{ height: STAGE_H }}
        onClick={() => script && setAt(script.length)}
      >
        <div
          className="viz-camera"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.s})` }}
        >
          {[...cells.values()].map((c) => (
            <Tile
              key={c.key}
              letter={c.letter}
              size={UNIT}
              highlight={head.has(c.key)}
              className="viz-tile viz-in"
              style={{ left: c.c * (UNIT + GAP), top: c.r * (UNIT + GAP) }}
            />
          ))}
          {/* A tile now covering the spot hides the one lifting off it. */}
          {ghosts.filter((g) => !occupied.has(`${g.r},${g.c}`)).map((c) => (
            <Tile
              key={`g${c.id}`}
              letter={c.letter}
              size={UNIT}
              className="viz-tile viz-out"
              style={{ left: c.c * (UNIT + GAP), top: c.r * (UNIT + GAP) }}
            />
          ))}
        </div>
        {script && !final && (
          <button type="button" className="viz-skip" onClick={() => setAt(script.length)}>
            Skip
          </button>
        )}
      </div>

      <div className="viz-meta">
        <span className="viz-count">
          {waiting ? "Starting" : `${tried.toLocaleString("en-US")} ${tried === 1 ? "word" : "words"} tried`}
        </span>
        <span className="viz-count">
          {final && result && !result.solved
            ? `Closest: ${placed} of ${letters.length}`
            : live && !script
              ? `Best so far ${live.best} / ${letters.length}`
              : `${placed} / ${letters.length} tiles`}
        </span>
      </div>

      <div className="viz-rack">
        {rack.map((t, i) => (
          <Tile
            key={i}
            letter={t.letter}
            size={24}
            className={waiting ? "tile-bob" : t.spent ? "viz-spent" : ""}
            style={waiting ? { animationDelay: `${i * 70}ms` } : undefined}
          />
        ))}
      </div>
    </div>
  );
}
