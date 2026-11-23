"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detect, solve, warmDetector, type SolveResult } from "./lib/api";
import { PhotoOverlay, type Photo } from "./components/PhotoOverlay";
import { extractWords, formatMs } from "./lib/grid";
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

  // Dump helper
  const [dumpCheck, setDumpCheck] = useState<DumpCheck | null>(null);
  const dumpAbort = useRef<AbortController | null>(null);

  // ── Persistence: a reload or a locked phone shouldn't lose the hand ───────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ phase, game: rest }));
  }, [phase, game, restored]);

  // ── Elapsed timer while scanning, to explain a slow first read ───────────
  useEffect(() => {
    if (phase !== "scanning") return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  const letters = lettersOf(game.hand);
  const handKey = sortLetters(letters).join("");

  // ==========================================================================
  // Actions
  // ==========================================================================

  const newGame = () => {
    if (game.hand.length && phase !== "start" && !confirm("Start a new game? This hand will be cleared.")) return;
    abortRef.current?.abort();
    dumpAbort.current?.abort();
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

  const [canPaste, setCanPaste] = useState(false);
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setCanPaste(!!navigator.clipboard?.read);
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);

  const pasteFromClipboard = async (target: "hand" | "draw") => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return scanImage(await item.getType(type), target);
      }
      setError("There's no image on the clipboard. Copy a photo of your tiles first.");
    } catch {
      setError(`Couldn't read the clipboard. Allow clipboard access, or press ${isMac ? "⌘V" : "Ctrl+V"}.`);
    }
  };

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

  const runSolve = useCallback(async (hand: string[]) => {
    setError(null);
    setPhase("solving");
    dumpAbort.current?.abort();
    setDumpCheck(null);
    try {
      const result = await solve(hand);
      setGame((g) => ({ ...g, solution: result, solvedFor: sortLetters(hand).join("") }));
      setPhase("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Solving failed.");
      setPhase("hand");
    }
  }, []);

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
          const r = await solve(removeOne(hand, letter), ctrl.signal);
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
        <div className="brand">
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
                Snap your tiles and get a grid that uses every one of them.
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
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            <div className="stack">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => pickPhoto("hand", true)}>
                <CameraIcon /> Take a photo
              </button>
              <div className="row">
                <button type="button" className="btn btn-secondary" onClick={() => pickPhoto("hand", false)}>
                  <ImageIcon /> Library
                </button>
                {canPaste && (
                  <button type="button" className="btn btn-secondary" onClick={() => pasteFromClipboard("hand")}>
                    <PasteIcon /> Paste
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={typeHand}>
                  <KeysIcon /> Type
                </button>
              </div>
              <p className="hint center paste-hint">
                Or paste a picture with <kbd>{isMac ? "⌘" : "Ctrl"}</kbd> <kbd>V</kbd>
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
                  : "The tile reader naps when nobody's using it. Waking it up takes about 20 seconds; after that it's quick."}
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
                    ? "Check them against the real ones. Tap a tile to fix it."
                    : "Tap letters below to add your tiles."}
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
                  <span className="dot-inline" /> {doubtfulCount === 1 ? "This tile was" : "These tiles were"} hard
                  to read. Worth a second look.
                </p>
              )}
            </div>

            {game.photo && (
              <div className="card card-flush">
                <button type="button" className="disclosure" onClick={() => setShowPhoto((s) => !s)}>
                  <span>What the camera saw</span>
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
                      Tap a tile on the photo to fix it.
                      {doubtfulCount > 0 && " Red ones were hard to read."}
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
        {phase === "solving" && (
          <section className="stack-lg center fade-in pt-10">
            <div className="rack rack-center">
              {game.hand.map((t, i) => (
                <Tile key={t.id} letter={t.letter} size={34} className="tile-bob" style={{ animationDelay: `${i * 70}ms` }} />
              ))}
            </div>
            <div className="strong">Fitting {count} tiles together…</div>
            <p className="muted small">Hard hands can take up to 5 seconds.</p>
          </section>
        )}

        {/* ── RESULT ────────────────────────────────────────────────────── */}
        {phase === "result" && solution && solutionCurrent && (
          <section className="stack-lg fade-in">
            {solution.solved ? (
              <SolvedView solution={solution} count={count} />
            ) : (
              <>
                <div className="center stack-sm">
                  <div className="badge badge-danger">No grid found</div>
                  <h2 className="title-sm">These {count} tiles don&apos;t fit together</h2>
                  <p className="muted small">
                    Time to dump: put one tile back in the pile and take {DRAW_COUNT}. If a tile was misread,
                    fix it first.
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
                        Without {dumpCheck.fits.length === 1 ? "this tile" : "any one of these"}, the rest of your
                        hand makes a full grid. {dumpCheck.fits.length === 1 ? "Tap it" : "Tap one"} to dump it.
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
                        No single dump makes the rest fit, so these are just the hardest tiles to place.
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
                {canPaste && (
                  <button type="button" className="btn btn-secondary" onClick={() => pasteFromClipboard("draw")}>
                    <PasteIcon /> Paste
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ── Sheets ──────────────────────────────────────────────────────── */}
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
            <p className="hint">Highlighted: the rest of your hand fits without it.</p>
          )}
        </div>
      </Sheet>
    </div>
  );
}

// ============================================================================
// Pieces
// ============================================================================

function SolvedView({ solution, count }: { solution: SolveResult; count: number }) {
  const words = extractWords(solution.grid);
  return (
    <>
      <div className="center stack-sm">
        <div className="badge badge-success">All {count} tiles placed</div>
        <h2 className="title-sm">Every tile fits. Lay it out like this.</h2>
        <p className="muted small">
          {words.across.length + words.down.length} words, found in {formatMs(solution.time_ms)}
        </p>
      </div>
      <div className="board">
        <SolutionBoard grid={solution.grid} />
      </div>
      <div className="card stack-sm">
        {([
          ["Across", words.across],
          ["Down", words.down],
        ] as const).map(([label, list]) =>
          list.length ? (
            <div key={label} className="word-row">
              <span className="label w-16 shrink-0">{label}</span>
              <div className="flex flex-wrap gap-1.5">
                {list.map((w, i) => (
                  <span key={`${w}-${i}`} className="chip">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          ) : null
        )}
      </div>
    </>
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

function PasteIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 11h6M9 15h4" />
    </svg>
  );
}

function KeysIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
    </svg>
  );
}
