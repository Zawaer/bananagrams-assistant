"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { DetectionExtras, DetectionResult, ImageSize, SolveResult } from "../lib/api";
import { gridWidth, wordRuns } from "../lib/grid";

// ============================================================================
// Stats: a small round button beside the result heading, with a popover of
// numbers about how the hand was read and solved. Hover opens it where there
// is a mouse; a tap (or click) pins it open, and a tap outside or Escape
// closes it.
// ============================================================================

/** What's kept about the photo the hand was read from. */
export type VisionStats = {
  found: number;
  expected: number | null;
  /** 0-1. */
  avgConf: number;
  least: { letter: string; conf: number } | null;
  inferenceMs: number | null;
  serverMs: number | null;
  /** Time the server spent outside the steps it times: loading the model. */
  loadMs: number;
  roundTripMs: number;
  sent: ImageSize;
  original: ImageSize | null;
};

export function visionStats(r: DetectionResult & DetectionExtras, expected: number | null): VisionStats {
  const confs = r.letter_list.map((l) => l.confidence);
  const least = r.letter_list.reduce<VisionStats["least"]>(
    (m, l) => (!m || l.confidence < m.conf ? { letter: l.letter, conf: l.confidence } : m),
    null
  );
  const t = r.timing;
  return {
    found: r.count ?? confs.length,
    expected,
    avgConf: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
    least,
    inferenceMs: t?.inference_ms ?? null,
    serverMs: t?.total_ms ?? null,
    loadMs: t ? Math.max(0, t.total_ms - t.preprocess_ms - t.inference_ms - t.postprocess_ms) : 0,
    roundTripMs: r.roundTripMs,
    sent: r.sent,
    original: r.original,
  };
}

// ── Formatting ────────────────────────────────────────────────────────────

const int = (n: number) => Math.round(n).toLocaleString("en-US");

function ms(n: number) {
  if (n < 1) return "<1 ms";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)} s`;
  return `${Math.round(n / 1000)} s`;
}

function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// A model that was asleep makes the first read slow: either this request
// loaded it, or it waited for a warm-up that was already loading it.
const COLD_MS = 2500;

// ── Component ─────────────────────────────────────────────────────────────

export function SolveStats({
  solution,
  solveMs,
  vision,
  dumps,
}: {
  solution: SolveResult;
  /** The solve's round trip as the app measured it. */
  solveMs: number | null;
  vision: VisionStats | null;
  dumps: number;
}) {
  const [open, setOpen] = useState<"hover" | "pinned" | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(null);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Point the arrow at the button: the popover is centred under the heading,
  // which the button sits at the end of.
  useLayoutEffect(() => {
    if (!open || !pop.current || !button.current) return;
    const b = button.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    pop.current.style.setProperty("--arrow-x", `${b.left + b.width / 2 - p.left}px`);
  }, [open]);

  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);

  const onEnter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setOpen((o) => o ?? "hover");
  };
  const onLeave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    leaveTimer.current = setTimeout(() => setOpen((o) => (o === "hover" ? null : o)), 160);
  };

  const runs = solution.solved ? wordRuns(solution.grid) : [];
  const longest = runs.reduce<string | null>((m, r) => (!m || r.word.length > m.length ? r.word : m), null);
  const nodes = solution.nodes ?? solution.trace?.nodes;
  const tilesOk = vision && (vision.expected == null || vision.found === vision.expected);
  const cold = vision && (vision.loadMs > COLD_MS || vision.roundTripMs - (vision.serverMs ?? 0) > COLD_MS);

  return (
    <span className="stats" ref={wrap} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <button
        ref={button}
        type="button"
        className={open ? "stats-btn stats-btn-on" : "stats-btn"}
        aria-label="Stats for this solve"
        aria-expanded={!!open}
        aria-controls={id}
        onClick={() => setOpen((o) => (o === "pinned" ? null : "pinned"))}
      >
        <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden>
          <rect x="2" y="8.5" width="3" height="5.5" rx="1" />
          <rect x="6.5" y="2" width="3" height="12" rx="1" />
          <rect x="11" y="5.5" width="3" height="8.5" rx="1" />
        </svg>
      </button>

      {open && (
        <div ref={pop} id={id} role="dialog" aria-label="Stats for this solve" className="stats-pop">
          {vision && (
            <section className="stats-sec">
              <div className="stats-head">Reading the photo</div>
              <div className="stats-big">
                <Big value={vision.expected != null ? `${vision.found}/${vision.expected}` : String(vision.found)} label="tiles found" warn={!tilesOk} />
                <Big value={pct(vision.avgConf)} label="avg. confidence" />
                <Big value={ms(vision.roundTripMs)} label="to read" />
              </div>
              <dl className="stats-rows">
                {vision.least && (
                  <Row label="Least sure">
                    <span className="stats-tile">{vision.least.letter.toUpperCase()}</span> {pct(vision.least.conf)}
                  </Row>
                )}
                <Row label="Vision model">YOLO11x-seg</Row>
                {vision.inferenceMs != null && <Row label="Model inference">{ms(vision.inferenceMs)}</Row>}
                {vision.serverMs != null && <Row label="Server total">{ms(vision.serverMs)}</Row>}
                <Row label="Round trip">
                  {ms(vision.roundTripMs)}
                  {cold && <span className="stats-note"> · model was loading</span>}
                </Row>
                <Row label="Photo sent">
                  {vision.sent.width} × {vision.sent.height} · {bytes(vision.sent.bytes)}
                  {vision.original && vision.original.bytes !== vision.sent.bytes && (
                    <span className="stats-note"> of {bytes(vision.original.bytes)}</span>
                  )}
                </Row>
              </dl>
            </section>
          )}

          <section className="stats-sec">
            <div className="stats-head">Solving</div>
            <div className="stats-big">
              {nodes != null && <Big value={int(nodes)} label={nodes === 1 ? "search step" : "search steps"} />}
              <Big value={ms(solution.time_ms)} label="solve time" />
              {solution.dict_words != null && <Big value={int(solution.dict_words)} label="words allowed" />}
            </div>
            <dl className="stats-rows">
              {solution.solved && (
                <Row label="Words placed">
                  {runs.length}
                  {longest && <span className="stats-note"> · longest {longest.toUpperCase()}</span>}
                </Row>
              )}
              {solution.solved && (
                <Row label="Board">
                  {gridWidth(solution.grid)} × {solution.grid.length}
                </Row>
              )}
              {solveMs != null && <Row label="Round trip">{ms(solveMs)}</Row>}
              <Row label="Dumps this game">{dumps}</Row>
            </dl>
            {solution.budget_hit && <p className="stats-foot">The search hit its time limit and stopped.</p>}
          </section>
        </div>
      )}
    </span>
  );
}

function Big({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  return (
    <div className="stats-big-item">
      <div className={warn ? "stats-big-n stats-warn" : "stats-big-n"}>{value}</div>
      <div className="stats-big-l">{label}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
