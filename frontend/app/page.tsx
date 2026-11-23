"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detect, solve, solveLive, warmDetector, type SolveFrame, type SolveResult } from "./lib/api";
import { SearchViz } from "./components/SearchViz";
import { DEFAULT_RULES, rulesKey, summarize, type Rules } from "./lib/rules";
import { RulesSheet } from "./components/RulesSheet";
import { PhotoOverlay, type Photo } from "./components/PhotoOverlay";
import { formatMs, wordRuns, type WordRun } from "./lib/grid";
import { awkwardness, removeOne, sortLetters } from "./lib/letters";
import { LetterPad } from "./components/LetterPad";
import { Sheet } from "./components/Sheet";
import { SolutionBoard } from "./components/SolutionBoard";
import { Tile } from "./components/Tile";

// ============================================================================
// Game model
//
// A game is a hand of tiles that changes over time. The only rule that
// changes it here is the dump: put one unwanted tile back in the pile and take
// three. So the flow is: read the hand (photo or typed), solve; if it doesn't
// fit, pick a tile to dump, add the three you drew, solve again.
// ============================================================================

/** `shape` is the tile's outline in the photo, when it came from one. */
type HandTile = { id: number; letter: string; conf?: number; shape?: [number, number][] };

type Phase = "start" | "scanning" | "hand" | "solving" | "result" | "draw";

type Game = {
  expected: number | null;
  hand: HandTile[];
  photo: Photo | null;
  solution: SolveResult | null;
  /** Letters the solution above was computed for. */
  solvedFor: string | null;
  /** Tiles drawn after the latest dump, not yet in the hand. */
  drawn: string[];
  dumped: string | null;
  history: string[];
};

type DumpCheck = {
  running: boolean;
  checked: number;
  total: number;
  fits: string[];
};

const PRESETS = [10, 15, 21];
const DRAW_COUNT = 3;
const DOUBTFUL = 0.9;
const STORAGE_KEY = "bananagrams-game-v2";

/** The steps that get a browser history entry. */
const STEPS: Phase[] = ["start", "hand", "result", "draw"];
type NavState = { bgPhase: Phase; gen: number; depth: number };
const RULES_KEY = "bananagrams-rules";
const WATCH_KEY = "bananagrams-watch-search";

let nextId = 1;
const toTiles = (letters: string[], conf?: number[]): HandTile[] =>
  letters.map((letter, i) => ({ id: nextId++, letter, conf: conf?.[i] }));
const lettersOf = (hand: HandTile[]) => hand.map((t) => t.letter);
const sortHand = (hand: HandTile[]) =>
  [...hand].sort((a, b) => a.letter.localeCompare(b.letter, "fi"));

const emptyGame = (expected: number | null): Game => ({
  expected,
  hand: [],
  photo: null,
  solution: null,
  solvedFor: null,
  drawn: [],
  dumped: null,
  history: [],
});

// ============================================================================
// Page
// ============================================================================

export default function Home() {
  const [phase, setPhase] = useState<Phase>("start");
  const [game, setGame] = useState<Game>(() => emptyGame(21));
  const [restored, setRestored] = useState(false);

  // Scanning
  const [scanTarget, setScanTarget] = useState<"hand" | "draw">("hand");
  const [preview, setPreview] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  // Errors and sheets
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [choosingDump, setChoosingDump] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  // House rules: which words count. A preference, kept across games.
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const [rulesOpen, setRulesOpen] = useState(false);
  const rulesAtOpen = useRef("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RULES_KEY);
      if (saved) setRules({ ...DEFAULT_RULES, ...JSON.parse(saved) });
    } catch {
      // Unreadable rules fall back to the defaults.
    }
  }, []);
  const updateRules = (r: Rules) => {
    setRules(r);
    rulesRef.current = r;
    localStorage.setItem(RULES_KEY, JSON.stringify(r));
  };

  // Banning: a word picked on the solved board, waiting for its reason.
  const [banWord, setBanWord] = useState<string | null>(null);
  const [banReason, setBanReason] = useState("");

  // Dump helper
  const [dumpCheck, setDumpCheck] = useState<DumpCheck | null>(null);
  const dumpAbort = useRef<AbortController | null>(null);

  // ── Persistence: the game lives only as long as the tab ───────────────────
  // sessionStorage survives a reload or a locked phone, but closing the site
  // starts fresh. (Settings like house rules stay in localStorage.)
  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEY); // games used to be kept forever
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { phase: Phase; game: Game };
        const hand = toTiles(lettersOf(saved.game.hand), saved.game.hand.map((t) => t.conf ?? 1));
        setGame({ ...saved.game, hand, photo: null });
        // Anything in flight when the page went away is restarted by hand.
        const p = saved.phase === "scanning" || saved.phase === "solving" ? "hand" : saved.phase;
        setPhase(hand.length || p === "draw" ? p : "start");
      }
    } catch {
      // A corrupt save just means a fresh start.
    }
    setRestored(true);
    warmDetector();
  }, []);

  useEffect(() => {
    if (!restored) return;
    const { photo: _photo, ...rest } = game;
    void _photo;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ phase, game: rest }));
  }, [phase, game, restored]);

  // ── Navigation: each step is a browser history entry ─────────────────────
  // So the phone's back gesture (and the back button in the top bar) goes to
  // the previous step instead of leaving the site. Scanning and solving are
  // passing states and get no entry of their own. A new game starts a new
  // "generation": going back into the previous game's steps is skipped.
  const gameRef = useRef(game);
  gameRef.current = game;
  const generation = useRef(0);
  const fromHistory = useRef(false);
  const lastStable = useRef<Phase | null>(null);

  useEffect(() => {
    if (!restored || !STEPS.includes(phase)) return;
    const prev = lastStable.current;
    lastStable.current = phase;
    if (fromHistory.current) {
      fromHistory.current = false;
      return;
    }
    const state = window.history.state as NavState | null;
    if (state?.bgPhase === phase && state.gen === generation.current) return;
    const next: NavState = {
      bgPhase: phase,
      gen: generation.current,
      depth: state?.bgPhase && state.gen === generation.current ? state.depth + 1 : 0,
    };
    // The draw step is done once its tiles are in: replace it, so back from
    // the new result goes to the tiles rather than an empty draw screen.
    if (!state?.bgPhase || prev === "draw") window.history.replaceState(next, "");
    else window.history.pushState(next, "");
  }, [phase, restored]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const state = e.state as NavState | null;
      if (!state?.bgPhase) return;
      abortRef.current?.abort();
      setSelected(null);
      setAdding(false);
      setChoosingDump(false);
      setRulesOpen(false);
      setBanWord(null);
      if (state.gen !== generation.current) {
        // A step from an earlier game: stay on this game's start.
        window.history.pushState({ bgPhase: "start", gen: generation.current, depth: 0 }, "");
        return;
      }
      const g = gameRef.current;
      let target = state.bgPhase;
      if (target === "result" && !g.solution) target = "hand";
      if (target === "draw" && g.dumped == null) target = "hand";
      if (target === "hand" && g.hand.length === 0 && !g.solution) target = "start";
      fromHistory.current = true;
      setPhase(target);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const goBack = () => {
    const state = window.history.state as NavState | null;
    if (state?.bgPhase && state.depth > 0) return window.history.back();
    // Nothing of ours to go back to (e.g. after a reload): go up a level.
    setPhase(phase === "draw" || phase === "result" ? "hand" : "start");
  };

  // ── Elapsed timer while scanning, to explain a slow first read ───────────
  useEffect(() => {
    if (phase !== "scanning") return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  const letters = lettersOf(game.hand);
  const handKey = `${rulesKey(rules)}:${sortLetters(letters).join("")}`;

  // ==========================================================================
  // Actions
  // ==========================================================================

  const newGame = () => {
    if (game.hand.length && phase !== "start" && !confirm("Start a new game? This hand will be cleared.")) return;
    abortRef.current?.abort();
    dumpAbort.current?.abort();
    solveAbort.current?.abort();
    setArrived(null);
    generation.current += 1;
    setGame(emptyGame(game.expected));
    setDumpCheck(null);
    setError(null);
    setPreview(null);
    setPhase("start");
  };

  const pickPhoto = (target: "hand" | "draw", camera: boolean) => {
    setScanTarget(target);
    (camera ? cameraInput : libraryInput).current?.click();
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) scanImage(file, scanTarget);
  };

  const scanImage = async (file: Blob, target: "hand" | "draw") => {
    setScanTarget(target);
    const returnTo: Phase = target === "draw" ? "draw" : game.hand.length ? "hand" : "start";
    setError(null);
    setPreview(URL.createObjectURL(file));
    setPhase("scanning");
    abortRef.current = new AbortController();
    try {
      const result = await detect(file, abortRef.current.signal);
      const found = result.tiles ?? result.letter_list.map((l) => ({ ...l, polygon: undefined }));
      const read = found.map((t) => t.letter);
      if (target === "draw") {
        setGame((g) => ({ ...g, drawn: [...g.drawn, ...read] }));
        setPhase("draw");
      } else {
        setGame((g) => ({
          ...g,
          hand: sortHand(
            found.map((t) => ({ id: nextId++, letter: t.letter, conf: t.confidence, shape: t.polygon }))
          ),
          photo: result.image_size
            ? // Show the original, full-resolution photo: the outlines are in the
              // uploaded (downscaled) copy's pixels, but the SVG viewBox scales
              // them onto any image with the same aspect ratio.
              { url: URL.createObjectURL(file), width: result.image_size[0], height: result.image_size[1] }
            : null,
          solution: null,
          solvedFor: null,
        }));
        setPhase("hand");
        // Open the photo straight away when there's something to check on it.
        setShowPhoto(
          found.some((t) => t.confidence < DOUBTFUL) || (game.expected != null && read.length !== game.expected)
        );
      }
      if (!read.length) setError("No tiles found in that photo. Try again with the tiles spread out on a plain surface.");
    } catch (err) {
      if (abortRef.current?.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Couldn't read the photo.");
      setPhase(returnTo);
    }
  };

  // Pasting: Ctrl/Cmd+V anywhere, or the Paste button where there is no
  // keyboard. On the draw step a pasted image adds the new tiles; anywhere
  // else it reads a whole hand.
  const pasteTarget: "hand" | "draw" | null =
    phase === "draw" ? "draw" : phase === "start" || phase === "hand" || phase === "result" ? "hand" : null;
  const scanRef = useRef(scanImage);
  scanRef.current = scanImage;

  useEffect(() => {
    if (!pasteTarget) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      scanRef.current(file, pasteTarget);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pasteTarget]);

  const [isMac, setIsMac] = useState(false);
  useEffect(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent)), []);

  const cancelScan = () => {
    abortRef.current?.abort();
    setPhase(scanTarget === "draw" ? "draw" : game.hand.length ? "hand" : "start");
  };

  const typeHand = () => {
    setError(null);
    setGame((g) => ({ ...emptyGame(g.expected) }));
    setPhase("hand");
    setAdding(true);
  };

  // "Watch the search" (off by default, kept across games): the solve is
  // streamed so the search can be shown (SearchViz), and the result is held
  // back until the board on screen has caught up with it. Off, solving is
  // the plain request it always was.
  const [watch, setWatch] = useState(false);
  const watchRef = useRef(watch);
  watchRef.current = watch;
  useEffect(() => setWatch(localStorage.getItem(WATCH_KEY) === "1"), []);
  const toggleWatch = () => {
    setWatch(!watch);
    localStorage.setItem(WATCH_KEY, watch ? "0" : "1");
  };
  const [liveFrame, setLiveFrame] = useState<SolveFrame | null>(null);
  const [arrived, setArrived] = useState<{ result: SolveResult; key: string } | null>(null);
  const [settled, setSettled] = useState(false);
  const solveAbort = useRef<AbortController | null>(null);

  const runSolve = useCallback(async (hand: string[]) => {
    setError(null);
    setPhase("solving");
    dumpAbort.current?.abort();
    setDumpCheck(null);
    solveAbort.current?.abort();
    const ctrl = new AbortController();
    solveAbort.current = ctrl;
    setLiveFrame(null);
    setArrived(null);
    try {
      const key = `${rulesKey(rulesRef.current)}:${sortLetters(hand).join("")}`;
      if (watchRef.current) {
        const result = await solveLive(hand, rulesRef.current, (f) => setLiveFrame(f), ctrl.signal);
        if (!ctrl.signal.aborted) setArrived({ result, key });
      } else {
        const result = await solve(hand, rulesRef.current, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setGame((g) => ({ ...g, solution: result, solvedFor: key }));
        setSettled(false);
        setPhase("result");
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Solving failed.");
      setPhase("hand");
    }
  }, []);

  const finishSolve = useCallback(() => {
    if (!arrived) return;
    setGame((g) => ({ ...g, solution: arrived.result, solvedFor: arrived.key }));
    setSettled(!!arrived.result.trace);
    setArrived(null);
    setLiveFrame(null);
    setPhase("result");
  }, [arrived]);

  // Changing the rules on the result screen re-solves the same hand.
  const openRules = () => {
    rulesAtOpen.current = rulesKey(rulesRef.current);
    setRulesOpen(true);
  };
  const closeRules = () => {
    setRulesOpen(false);
    if (phase === "result" && rulesKey(rulesRef.current) !== rulesAtOpen.current && letters.length >= 2)
      runSolve(letters);
  };

  const confirmBan = () => {
    if (!banWord) return;
    const word = banWord.toLowerCase();
    updateRules({
      ...rulesRef.current,
      banned: [...rulesRef.current.banned.filter((b) => b.word !== word), { word, reason: banReason.trim() }],
    });
    setBanWord(null);
    setBanReason("");
    if (letters.length >= 2) runSolve(letters);
  };

  // For each distinct letter, try solving the hand without it. A letter whose
  // removal leaves a hand that fits is a safe dump: whatever three come back,
  // you already have a board for everything else.
  const findDumps = useCallback(async (hand: string[]) => {
    dumpAbort.current?.abort();
    const ctrl = new AbortController();
    dumpAbort.current = ctrl;
    const candidates = sortLetters([...new Set(hand)]).sort(
      (a, b) => awkwardness(b, hand) - awkwardness(a, hand)
    );
    let checked = 0;
    const fits: string[] = [];
    setDumpCheck({ running: true, checked, total: candidates.length, fits: [] });
    const queue = [...candidates];
    const worker = async () => {
      while (queue.length && !ctrl.signal.aborted) {
        const letter = queue.shift()!;
        try {
          const r = await solve(removeOne(hand, letter), rulesRef.current, ctrl.signal);
          if (r.solved) fits.push(letter);
        } catch {
          // A failed check just doesn't count as a fit.
        }
        if (ctrl.signal.aborted) return;
        checked++;
        const ordered = candidates.filter((c) => fits.includes(c));
        setDumpCheck({ running: true, checked, total: candidates.length, fits: ordered });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (!ctrl.signal.aborted)
      setDumpCheck((d) => (d ? { ...d, running: false } : d));
  }, []);

  // Start the dump helper whenever a hand comes back unsolved.
  useEffect(() => {
    if (phase === "result" && game.solution && !game.solution.solved && !dumpCheck && letters.length > 2)
      findDumps(letters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, game.solution]);

  const dump = (letter: string) => {
    dumpAbort.current?.abort();
    setChoosingDump(false);
    setSelected(null);
    setDumpCheck(null);
    setGame((g) => {
      const i = g.hand.findIndex((t) => t.letter === letter);
      return {
        ...g,
        hand: g.hand.filter((_, j) => j !== i),
        dumped: letter,
        drawn: [],
        solution: null,
        solvedFor: null,
        photo: null,
      };
    });
    setError(null);
    setPhase("draw");
  };

  const dumpTile = (id: number) => {
    const t = game.hand.find((x) => x.id === id);
    if (t) dump(t.letter);
  };

  const finishDraw = () => {
    const hand = sortHand([...game.hand, ...toTiles(game.drawn)]);
    const entry = `Dumped ${game.dumped?.toUpperCase()}, drew ${game.drawn.map((l) => l.toUpperCase()).join(" ")}`;
    setGame((g) => ({
      ...g,
      hand,
      expected: hand.length,
      drawn: [],
      dumped: null,
      history: [...g.history, entry],
    }));
    runSolve(lettersOf(hand));
  };

  const setTileLetter = (id: number, letter: string) => {
    setGame((g) => ({
      ...g,
      hand: sortHand(g.hand.map((t) => (t.id === id ? { ...t, letter, conf: 1 } : t))),
    }));
    setSelected(null);
  };

  const removeTile = (id: number) => {
    setGame((g) => ({ ...g, hand: g.hand.filter((t) => t.id !== id) }));
    setSelected(null);
  };

  const addTile = (letter: string) =>
    setGame((g) => ({ ...g, hand: sortHand([...g.hand, ...toTiles([letter])]) }));

  // ==========================================================================
  // Render
  // ==========================================================================

  const count = game.hand.length;
  const expected = game.expected;
  const countOk = expected == null || count === expected;
  const selectedTile = game.hand.find((t) => t.id === selected) ?? null;
  const solution = game.solution;
  const solutionCurrent = solution && game.solvedFor === handKey;
  const doubtfulCount = game.hand.filter((t) => (t.conf ?? 1) < DOUBTFUL).length;

  return (
    <div className="app">
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      <input ref={libraryInput} type="file" accept="image/*" hidden onChange={onPhoto} />

      <header className="topbar">
        {phase !== "start" && phase !== "scanning" && phase !== "solving" ? (
          <button type="button" className="back-btn" onClick={goBack} aria-label="Back">
            <svg {...iconProps} width={22} height={22}>
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <span>{phase === "hand" ? "Start" : "Tiles"}</span>
          </button>
        ) : null}
        <div className={phase === "start" ? "brand" : "brand brand-compact"}>
          <Tile letter="b" size={28} />
          <span>
            Bananagrams <span className="text-accent">Assistant</span>
          </span>
        </div>
        {phase !== "start" && (
          <button type="button" className="ghost-btn" onClick={newGame}>
            New game
          </button>
        )}
      </header>

      <main className="content">
        {/* ── START ─────────────────────────────────────────────────────── */}
        {phase === "start" && (
          <section className="stack-lg fade-in">
            <div className="hero">
              <div className="hero-tiles" aria-hidden>
                {"BANAANI".split("").map((l, i) => (
                  <Tile key={i} letter={l} size={38} className="tile-drop" style={{ animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
              <h1 className="title">What&apos;s in your hand?</h1>
              <p className="muted">
                Photograph your tiles and get a grid that uses all of them.
              </p>
            </div>

            <div className="card stack">
              <div className="label">Tiles in hand</div>
              <div className="segmented">
                {PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={expected === n && !customOpen ? "seg seg-on" : "seg"}
                    onClick={() => {
                      setCustomOpen(false);
                      setGame((g) => ({ ...g, expected: n }));
                    }}
                  >
                    {n}
                  </button>
                ))}
                {customOpen ? (
                  <input
                    autoFocus
                    inputMode="numeric"
                    className="seg seg-on seg-input"
                    value={expected ?? ""}
                    placeholder="#"
                    onChange={(e) => {
                      const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                      setGame((g) => ({ ...g, expected: isNaN(n) ? null : Math.min(144, n) }));
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={expected != null && !PRESETS.includes(expected) ? "seg seg-on" : "seg"}
                    onClick={() => setCustomOpen(true)}
                  >
                    {expected != null && !PRESETS.includes(expected) ? expected : "Other"}
                  </button>
                )}
              </div>
              <p className="hint">Used to check the photo didn&apos;t miss a tile.</p>
              <RulesButton rules={rules} onClick={openRules} />
              <WatchSwitch on={watch} onToggle={toggleWatch} />
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            <div className="stack">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => pickPhoto("hand", true)}>
                <CameraIcon /> Take a photo
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => pickPhoto("hand", false)}>
                <ImageIcon /> Choose from library
              </button>
              <p className="hint center">
                <button type="button" className="link-btn" onClick={typeHand}>
                  Type the letters instead
                </button>
                <span className="paste-hint">
                  {" "}· or paste a picture with <kbd>{isMac ? "⌘" : "Ctrl"}</kbd> <kbd>V</kbd>
                </span>
              </p>
            </div>

            <details className="tips">
              <summary>Tips for a good photo</summary>
              <ul>
                <li>Lay the tiles face up on a plain, contrasting surface.</li>
                <li>Shoot from straight above, with the whole hand in frame.</li>
                <li>Tiles can touch and be at any angle. Just don&apos;t stack them.</li>
              </ul>
            </details>
          </section>
        )}

        {/* ── SCANNING ──────────────────────────────────────────────────── */}
        {phase === "scanning" && (
          <section className="stack-lg fade-in">
            <div className="scan-frame">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, nothing to optimise */}
              {preview && <img src={preview} alt="Your photo" />}
              <div className="scan-line" />
            </div>
            <div className="center stack-sm">
              <Spinner />
              <div className="strong">Reading the tiles…</div>
              <p className="muted small">
                {elapsed < 4
                  ? "This usually takes a couple of seconds."
                  : "Loading the model after a break. The first photo takes about 20 seconds."}
              </p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={cancelScan}>
              Cancel
            </button>
          </section>
        )}

        {/* ── HAND ──────────────────────────────────────────────────────── */}
        {phase === "hand" && (
          <section className="stack-lg fade-in">
            <div className="section-head">
              <div>
                <h2 className="title-sm">Your tiles</h2>
                <p className="muted small">
                  {count
                    ? "Tap a tile to fix it."
                    : "Add your tiles with +."}
                </p>
              </div>
              <CountBadge count={count} expected={expected} />
            </div>

            {!countOk && count > 0 && (
              <div className="alert alert-warn">
                {count < (expected ?? 0)
                  ? `${(expected ?? 0) - count} short of ${expected}. A tile may be hidden or misread; add it with +.`
                  : `${count - (expected ?? 0)} more than ${expected}. Remove any that were read twice.`}
              </div>
            )}

            <div className="card">
              <div className="rack">
                {game.hand.map((t) => (
                  <Tile
                    key={t.id}
                    letter={t.letter}
                    doubtful={(t.conf ?? 1) < DOUBTFUL}
                    selected={t.id === selected}
                    onClick={() => setSelected(t.id)}
                  />
                ))}
                <button type="button" className="tile-add" onClick={() => setAdding(true)} aria-label="Add a tile">
                  +
                </button>
              </div>
              {doubtfulCount > 0 && (
                <p className="hint mt-3">
                  <span className="dot-inline" /> Hard to read, check{doubtfulCount === 1 ? " it" : " these"}.
                </p>
              )}
            </div>

            {game.photo && (
              <div className="card card-flush">
                <button type="button" className="disclosure" onClick={() => setShowPhoto((s) => !s)}>
                  <span>Photo</span>
                  <span className="muted">{showPhoto ? "Hide" : "Show"}</span>
                </button>
                {showPhoto && (
                  <>
                    <PhotoOverlay
                      photo={game.photo}
                      tiles={game.hand.flatMap((t) =>
                        t.shape
                          ? [{ id: t.id, letter: t.letter, shape: t.shape, doubtful: (t.conf ?? 1) < DOUBTFUL }]
                          : []
                      )}
                      selected={selected}
                      onSelect={setSelected}
                    />
                    <p className="hint photo-caption">
                      Tap a tile to fix it.
                      {doubtfulCount > 0 && " Dashed outline: hard to read."}
                    </p>
                  </>
                )}
              </div>
            )}

            {error && <div className="alert alert-danger">{error}</div>}

            <div className="actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={count < 2}
                onClick={() => runSolve(letters)}
              >
                Solve {count >= 2 ? `${count} tiles` : ""}
              </button>
              <WatchSwitch on={watch} onToggle={toggleWatch} compact />
              <div className="row">
                <button type="button" className="btn btn-secondary" onClick={() => pickPhoto("hand", true)}>
                  <CameraIcon /> Retake
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={count < 1}
                  onClick={() => setChoosingDump(true)}
                >
                  Dump a tile
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── SOLVING ───────────────────────────────────────────────────── */}
        {phase === "solving" && !watch && (
          <section className="stack-lg center fade-in pt-10">
            <div className="rack rack-center">
              {game.hand.map((t, i) => (
                <Tile key={t.id} letter={t.letter} size={34} className="tile-bob" style={{ animationDelay: `${i * 70}ms` }} />
              ))}
            </div>
            <div className="strong">Solving {count} tiles…</div>
            <p className="muted small">Hard hands can take up to 5 seconds.</p>
          </section>
        )}
        {phase === "solving" && watch && (
          <section className="stack-lg fade-in">
            <div className="center stack-sm">
              <h2 className="title-sm">Solving {count} tiles</h2>
              {liveFrame && !arrived && (
                <p className="muted small">{(liveFrame.ms / 1000).toFixed(1)} s · hard hands take up to 5 s</p>
              )}
            </div>
            <SearchViz letters={letters} live={liveFrame} result={arrived?.result ?? null} onDone={finishSolve} />
          </section>
        )}

        {/* ── RESULT ────────────────────────────────────────────────────── */}
        {phase === "result" && solution && solutionCurrent && (
          <section className="stack-lg fade-in">
            <RulesButton rules={rules} onClick={openRules} compact />
            {solution.solved ? (
              <SolvedView solution={solution} count={count} onBan={setBanWord} settled={settled} />
            ) : (
              <>
                <div className="center stack-sm">
                  <h2 className="title-sm">No grid uses all {count} tiles</h2>
                  <p className="muted small">
                    Dump one and take {DRAW_COUNT}, or fix a misread tile first.
                  </p>
                </div>

                <div className="card stack">
                  <div className="label">Suggested dump</div>
                  {dumpCheck && dumpCheck.fits.length > 0 ? (
                    <>
                      <div className="rack">
                        {dumpCheck.fits.map((l) => (
                          <Tile key={l} letter={l} highlight onClick={() => dump(l)} label={`Dump ${l.toUpperCase()}`} />
                        ))}
                      </div>
                      <p className="hint">
                        The rest of your hand fits without {dumpCheck.fits.length === 1 ? "it" : "any one of these"}.
                      </p>
                    </>
                  ) : dumpCheck?.running ? null : (
                    <>
                      <div className="rack">
                        {sortLetters([...new Set(letters)])
                          .sort((a, b) => awkwardness(b, letters) - awkwardness(a, letters))
                          .slice(0, 3)
                          .map((l) => (
                            <Tile key={l} letter={l} onClick={() => dump(l)} label={`Dump ${l.toUpperCase()}`} />
                          ))}
                      </div>
                      <p className="hint">
                        No single dump makes the rest fit. These are the hardest to place.
                      </p>
                    </>
                  )}
                  {dumpCheck?.running && (
                    <div className="progress-row">
                      <div className="progress">
                        <div style={{ width: `${(dumpCheck.checked / Math.max(1, dumpCheck.total)) * 100}%` }} />
                      </div>
                      <span className="muted small">
                        Trying each tile {dumpCheck.checked}/{dumpCheck.total}
                      </span>
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="label mb-2">Your hand</div>
                  <div className="rack">
                    {game.hand.map((t) => (
                      <Tile key={t.id} letter={t.letter} size={30} />
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="actions">
              {solution.solved ? (
                <button type="button" className="btn btn-primary btn-lg" onClick={newGame}>
                  New game
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-lg" onClick={() => setChoosingDump(true)}>
                  Choose a tile to dump
                </button>
              )}
              <div className="row">
                <button type="button" className="btn btn-secondary" onClick={() => setPhase("hand")}>
                  Edit tiles
                </button>
              </div>
            </div>

            {game.history.length > 0 && (
              <div className="history">
                {game.history.map((h, i) => (
                  <div key={i}>{h}</div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── DRAW ──────────────────────────────────────────────────────── */}
        {phase === "draw" && (
          <section className="stack-lg fade-in">
            <div className="center stack-sm">
              <div className="dump-visual">
                {game.dumped && <Tile letter={game.dumped} size={46} className="tile-dumped" />}
                <span className="arrow">→</span>
                <div className="pile">pile</div>
              </div>
              <h2 className="title-sm">
                Put {game.dumped ? game.dumped.toUpperCase() : "it"} back, take {DRAW_COUNT}
              </h2>
              <p className="muted small">Add the {DRAW_COUNT} tiles you drew.</p>
            </div>

            <div className="card stack">
              <div className="draw-slots">
                {Array.from({ length: Math.max(DRAW_COUNT, game.drawn.length) }, (_, i) =>
                  game.drawn[i] ? (
                    <Tile
                      key={i}
                      letter={game.drawn[i]}
                      size={52}
                      className="tile-drop"
                      onClick={() => setGame((g) => ({ ...g, drawn: g.drawn.filter((_, j) => j !== i) }))}
                      label={`Remove ${game.drawn[i].toUpperCase()}`}
                    />
                  ) : (
                    <div key={i} className="slot" style={{ width: 52, height: 52 }} />
                  )
                )}
              </div>
              <LetterPad onPick={(l) => setGame((g) => ({ ...g, drawn: [...g.drawn, l] }))} />
              <p className="hint center">Tap a drawn tile to take it back off.</p>
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            <div className="actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={game.drawn.length === 0}
                onClick={finishDraw}
              >
                {game.drawn.length === DRAW_COUNT
                  ? `Solve with ${count + DRAW_COUNT} tiles`
                  : game.drawn.length
                    ? `Solve with ${count + game.drawn.length} tiles`
                    : `Add ${DRAW_COUNT} tiles`}
              </button>
              <div className="row">
                <button type="button" className="btn btn-secondary" onClick={() => pickPhoto("draw", true)}>
                  <CameraIcon /> Photograph them
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => pickPhoto("draw", false)}>
                  <ImageIcon /> Library
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ── Sheets ──────────────────────────────────────────────────────── */}
      <RulesSheet open={rulesOpen} rules={rules} onChange={updateRules} onClose={closeRules} />

      <Sheet
        open={banWord != null}
        onClose={() => setBanWord(null)}
        title={<span>Ban {banWord?.toUpperCase()}</span>}
      >
        <div className="stack">
          <label className="stack-sm">
            <span className="label">Reason (optional)</span>
            <textarea
              className="text-input"
              rows={2}
              value={banReason}
              placeholder="e.g. ei hyväksytä pikkusanoja kuten kyllä tai ei"
              onChange={(e) => setBanReason(e.target.value)}
            />
          </label>
          <p className="hint">The word stays banned in every game until you unban it in House rules.</p>
          <button type="button" className="btn btn-primary" onClick={confirmBan}>
            Ban and solve again
          </button>
        </div>
      </Sheet>

      <Sheet
        open={selectedTile != null}
        onClose={() => setSelected(null)}
        title={
          selectedTile && (
            <span className="flex items-center gap-3">
              <Tile letter={selectedTile.letter} size={34} /> Fix this tile
            </span>
          )
        }
      >
        {selectedTile && (
          <div className="stack">
            <div className="label">Change it to</div>
            <LetterPad onPick={(l) => setTileLetter(selectedTile.id, l)} />
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => removeTile(selectedTile.id)}>
                Remove
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => dumpTile(selectedTile.id)}>
                Dump it
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title={
          <span>
            Add tiles <span className="muted">· {count}{expected ? ` / ${expected}` : ""}</span>
          </span>
        }
      >
        <div className="stack">
          <div className="rack rack-mini">
            {game.hand.length === 0 && <span className="muted small">Tap letters to add them.</span>}
            {game.hand.map((t) => (
              <Tile key={t.id} letter={t.letter} size={26} onClick={() => removeTile(t.id)} label={`Remove ${t.letter}`} />
            ))}
          </div>
          <LetterPad onPick={addTile} />
          <button type="button" className="btn btn-primary" onClick={() => setAdding(false)}>
            Done
          </button>
        </div>
      </Sheet>

      <Sheet open={choosingDump} onClose={() => setChoosingDump(false)} title="Which tile goes back?">
        <div className="stack">
          <div className="rack">
            {sortLetters([...new Set(letters)]).map((l) => (
              <Tile
                key={l}
                letter={l}
                highlight={dumpCheck?.fits.includes(l)}
                onClick={() => dump(l)}
                label={`Dump ${l.toUpperCase()}`}
              />
            ))}
          </div>
          {dumpCheck && dumpCheck.fits.length > 0 && (
            <p className="hint">Yellow: the rest fits without it.</p>
          )}
        </div>
      </Sheet>
    </div>
  );
}

// ============================================================================
// Pieces
// ============================================================================

function SolvedView({
  solution,
  count,
  onBan,
  settled,
}: {
  solution: SolveResult;
  count: number;
  onBan: (word: string) => void;
  settled?: boolean;
}) {
  const runs = wordRuns(solution.grid);
  const [picked, setPicked] = useState<WordRun | null>(null);
  const highlight = new Set(picked?.cells.map(([y, x]) => `${y}-${x}`));

  // Tapping a tile picks the word through it; tapping the same tile again
  // switches between its across and down word.
  const onTileClick = (y: number, x: number) => {
    const through = runs.filter((r) => r.cells.some(([cy, cx]) => cy === y && cx === x));
    if (!through.length) return;
    const i = picked ? through.indexOf(picked) : -1;
    setPicked(i >= 0 ? (i + 1 < through.length ? through[i + 1] : null) : through[0]);
  };

  return (
    <>
      <div className="center stack-sm">
        <h2 className="title-sm">All {count} tiles placed</h2>
        <p className="muted small">
          {runs.length} words · {formatMs(solution.time_ms)}
        </p>
      </div>
      <div className="board">
        <SolutionBoard grid={solution.grid} highlight={highlight} onTileClick={onTileClick} settled={settled} />
      </div>
      <div className="card stack-sm">
        {(["across", "down"] as const).map((dir) => {
          const list = runs.filter((r) => r.dir === dir);
          return list.length ? (
            <div key={dir} className="word-row">
              <span className="label w-16 shrink-0">{dir === "across" ? "Across" : "Down"}</span>
              <div className="flex flex-wrap gap-1.5">
                {list.map((r, i) => (
                  <button
                    key={`${r.word}-${i}`}
                    type="button"
                    className={picked === r ? "chip chip-btn-word chip-picked" : "chip chip-btn-word"}
                    onClick={() => setPicked(picked === r ? null : r)}
                  >
                    {r.word}
                  </button>
                ))}
              </div>
            </div>
          ) : null;
        })}
        {picked ? (
          <div className="ban-bar">
            <span>
              <strong>{picked.word}</strong> <span className="muted">not allowed?</span>
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onBan(picked.word)}>
              Ban word
            </button>
          </div>
        ) : (
          <p className="hint">Tap a word to ban it.</p>
        )}
      </div>
    </>
  );
}

function WatchSwitch({ on, onToggle, compact }: { on: boolean; onToggle: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={compact ? "toggle-row watch-row" : "toggle-row watch-row watch-row-card"}
      onClick={onToggle}
    >
      <span className="stack-sm">
        <span className="rules-title">Watch the search</span>
        {!compact && <span className="hint">Show the solver&apos;s board while it works.</span>}
      </span>
      <span className={on ? "switch switch-on" : "switch"} aria-hidden>
        <span className="switch-knob" />
      </span>
    </button>
  );
}

function RulesButton({ rules, onClick, compact }: { rules: Rules; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" className={compact ? "rules-btn rules-btn-compact" : "rules-btn"} onClick={onClick}>
      <span className="stack-sm">
        <span className="rules-title">House rules</span>
        <span className="hint">{summarize(rules)}</span>
      </span>
      <span className="rules-chevron" aria-hidden>
        ›
      </span>
    </button>
  );
}

function CountBadge({ count, expected }: { count: number; expected: number | null }) {
  const ok = expected == null || count === expected;
  return (
    <div className={ok ? "count count-ok" : "count count-off"}>
      <span className="count-n">{count}</span>
      {expected != null && <span className="count-of">/ {expected}</span>}
    </div>
  );
}

function Spinner() {
  return <div className="spinner" />;
}

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function CameraIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 16-5-5-9 9" />
    </svg>
  );
}

