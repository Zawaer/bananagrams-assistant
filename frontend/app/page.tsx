"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
// Types
// ============================================================================

type GameStep = "setup" | "capture" | "detection" | "correction" | "solved";

type DetectionResult = {
  letters: string;
  letter_list: { letter: string; confidence: number }[];
  annotated_image: string; // base64
  count: number;
  timing?: {
    preprocess_ms: number;
    inference_ms: number;
    postprocess_ms: number;
    total_ms: number;
  };
  yolo_timing?: {
    preprocess_ms: number;
    inference_ms: number;
    postprocess_ms: number;
  };
  avg_confidence?: number;
  thresholds?: {
    nms: number;
    confidence: number;
  };
};

type SolveResult = {
  solved: boolean;
  time_ms: number;
  grid: (string | null)[][];
};

const TILE_PRESETS = [10, 15, 21];

// Get server URLs from environment variables or fall back to local development
const getDetectionServerUrl = () => {
  // In production, use environment variable
  if (process.env.NEXT_PUBLIC_DETECTION_SERVER_URL) {
    return process.env.NEXT_PUBLIC_DETECTION_SERVER_URL;
  }
  
  // In development, use current hostname (works on local network)
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8081`;
  }
  return `http://localhost:8081`;
};

const getSolverServerUrl = () => {
  // In production, use environment variable
  if (process.env.NEXT_PUBLIC_SOLVER_SERVER_URL) {
    return process.env.NEXT_PUBLIC_SOLVER_SERVER_URL;
  }
  
  // In development, use current hostname (works on local network)
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8080`;
  }
  return `http://localhost:8080`;
};

const DETECTION_SERVER = getDetectionServerUrl();
const SOLVER_SERVER = getSolverServerUrl();

const VALID_CHARS = new Set("abdeghijklmnoprstuvyäö".split(""));

// Gap between tiles in the solution grid, in px
const GRID_GAP = 2;
// Tiles never render larger than this; they shrink to fit narrow screens
const MAX_TILE = 40;
const MIN_TILE = 13;

// The solver routinely finishes inside a millisecond; "0 ms" reads like a bug,
// so show a sub-millisecond marker instead.
function formatMs(ms: number) {
  if (ms < 1) return "<1 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}

// Pull the horizontal and vertical runs of 2+ letters out of a solved grid -
// i.e. the words the solver actually placed.
function extractWords(grid: (string | null)[][]) {
  const rows = grid.length;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const at = (y: number, x: number) => grid[y]?.[x] ?? null;

  const across: string[] = [];
  for (let y = 0; y < rows; y++) {
    let run = "";
    for (let x = 0; x <= cols; x++) {
      const c = at(y, x);
      if (c) run += c;
      else {
        if (run.length >= 2) across.push(run);
        run = "";
      }
    }
  }

  const down: string[] = [];
  for (let x = 0; x < cols; x++) {
    let run = "";
    for (let y = 0; y <= rows; y++) {
      const c = at(y, x);
      if (c) run += c;
      else {
        if (run.length >= 2) down.push(run);
        run = "";
      }
    }
  }

  return { across, down };
}

// ============================================================================
// Main component
// ============================================================================

export default function Home() {
  const [step, setStep] = useState<GameStep>("setup");
  const [tileCount, setTileCount] = useState(21);
  const [customCount, setCustomCount] = useState("");

  // Capture
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Detection
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // Correction
  const [correctedLetters, setCorrectedLetters] = useState("");

  // Manual input
  const [manualInput, setManualInput] = useState("");

  // Detection stats
  const [showDetectionStats, setShowDetectionStats] = useState(false);

  // Solving
  const [solving, setSolving] = useState(false);
  const [solution, setSolution] = useState<SolveResult | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [lastLetters, setLastLetters] = useState("");

  // Solution grid sizing: tiles shrink so the whole board fits the screen
  // rather than forcing the user to scroll a result sideways.
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const [tileSize, setTileSize] = useState(MAX_TILE);

  // ============================================================================
  // Camera
  // ============================================================================

  const startCamera = useCallback(async () => {
    // Check if camera API is available (requires HTTPS or localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setDetectionError(
        "Camera requires HTTPS. Please access this site via https:// or use 'Upload photo' instead."
      );
      return;
    }

    try {
      // Try rear camera first
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch {
        // Fallback to any camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (error) {
      console.error("Camera error:", error);
      const message = error instanceof Error ? error.message : "Unable to access camera. Please allow camera permissions.";
      setDetectionError(message);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedImage(blob);
          setCapturedPreview(URL.createObjectURL(blob));
          stopCamera();
        }
      },
      "image/jpeg",
      0.9
    );
  }, [stopCamera]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCapturedImage(file);
      setCapturedPreview(URL.createObjectURL(file));
    }
  }, []);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Fit the solution grid to the available width. A 21-tile hand can produce a
  // board 17 columns wide, which is ~710px of fixed-size tiles - far past the
  // edge of a phone - so scale the tiles down instead of scrolling.
  const gridCols = solution?.grid?.length
    ? solution.grid.reduce((m, r) => Math.max(m, r.length), 0)
    : 0;

  useEffect(() => {
    if (!gridCols) return;
    const el = gridWrapRef.current;
    if (!el) return;

    const fit = () => {
      const available = el.clientWidth;
      if (!available) return;
      const perTile = (available - GRID_GAP * (gridCols - 1)) / gridCols;
      setTileSize(Math.max(MIN_TILE, Math.min(MAX_TILE, Math.floor(perTile))));
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridCols]);

  const tileStyle = {
    width: tileSize,
    height: tileSize,
    minWidth: tileSize,
    minHeight: tileSize,
    fontSize: Math.max(8, Math.round(tileSize * 0.55)),
    borderWidth: tileSize < 20 ? 1 : 2,
    borderRadius: tileSize < 20 ? 2 : 4,
  };

  const emptyTileStyle = {
    width: tileSize,
    height: tileSize,
    minWidth: tileSize,
    minHeight: tileSize,
    flexShrink: 0,
  };

  const placedTiles = solution?.grid
    ? solution.grid.reduce(
        (n, row) => n + row.reduce((m, c) => m + (c ? 1 : 0), 0),
        0
      )
    : 0;

  const solutionWords =
    solution?.solved && solution.grid
      ? extractWords(solution.grid)
      : { across: [], down: [] };

  // Failed solve shouldn't be a dead end: drop the user back on the capture
  // step with the attempted letters prefilled so they can fix a misread tile.
  const editLetters = () => {
    setManualInput(lastLetters);
    setSolution(null);
    setSolveError(null);
    setStep("capture");
  };

  // ============================================================================
  // Detection
  // ============================================================================

  const runDetection = useCallback(async () => {
    if (!capturedImage) return;

    setDetecting(true);
    setDetectionError(null);
    setDetection(null);

    try {
      const formData = new FormData();
      formData.append("image", capturedImage);

      const res = await fetch(`${DETECTION_SERVER}/detect`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error(`Detection server error: ${res.status}`);

      const data: DetectionResult = await res.json();
      setDetection(data);
      setCorrectedLetters(data.letters);

      // If count matches, go to detection view (auto-solve triggered there)
      setStep("detection");
    } catch (e) {
      setDetectionError(e instanceof Error ? e.message : "Detection error");
    } finally {
      setDetecting(false);
    }
  }, [capturedImage]);

  // ============================================================================
  // Solving
  // ============================================================================

  const solvePuzzle = useCallback(async (letters: string) => {
    setLastLetters(letters);
    setSolving(true);
    setSolveError(null);
    setSolution(null);

    try {
      const res = await fetch(`${SOLVER_SERVER}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ letters }),
      });

      if (!res.ok) throw new Error(`Solver error: ${res.status}`);

      const data: SolveResult = await res.json();
      setSolution(data);
      setStep("solved");
    } catch (e) {
      setSolveError(e instanceof Error ? e.message : "Solve error");
    } finally {
      setSolving(false);
    }
  }, []);

  // ============================================================================
  // Step navigation
  // ============================================================================

  const startNewGame = () => {
    const count = customCount ? parseInt(customCount, 10) : tileCount;
    if (isNaN(count) || count < 1) return;
    setTileCount(count);
    setCapturedImage(null);
    setCapturedPreview(null);
    setDetection(null);
    setDetectionError(null);
    setSolution(null);
    setSolveError(null);
    setCorrectedLetters("");
    setManualInput("");
    setStep("capture");
  };

  const resetGame = () => {
    stopCamera();
    setCapturedImage(null);
    setCapturedPreview(null);
    setDetection(null);
    setDetectionError(null);
    setSolution(null);
    setSolveError(null);
    setCorrectedLetters("");
    setManualInput("");
    setStep("setup");
  };

  const handleCorrectionSubmit = () => {
    const filtered = correctedLetters
      .toLowerCase()
      .split("")
      .filter((c) => VALID_CHARS.has(c))
      .join("");
    if (filtered.length < 2) return;
    setCorrectedLetters(filtered);
    solvePuzzle(filtered);
  };

  const handleManualSolve = () => {
    const filtered = manualInput
      .toLowerCase()
      .split("")
      .filter((c) => VALID_CHARS.has(c))
      .join("");
    if (filtered.length < 2) return;
    setManualInput(filtered);
    solvePuzzle(filtered);
  };

  const retakePhoto = () => {
    setCapturedImage(null);
    setCapturedPreview(null);
    setDetection(null);
    setDetectionError(null);
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-6">
      <header className="mb-2">
        <h1 className="text-lg font-bold tracking-tight">
          Bananagrams <span style={{ color: "var(--accent)" }}>Assistant</span>
        </h1>
      </header>

      {/* ── SETUP ── */}
      {step === "setup" && (
        <div className="w-full max-w-md flex flex-col items-center gap-6 mt-6">
          <h2 className="text-xl font-semibold">Start a new game</h2>
          <p className="text-sm opacity-60 text-center">
            Choose how many tiles each player gets this round
          </p>

          <div className="flex gap-3 flex-wrap justify-center">
            {TILE_PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => {
                  setTileCount(n);
                  setCustomCount("");
                }}
                className="rounded-lg px-5 py-3 text-lg font-bold transition-all cursor-pointer"
                style={{
                  background: tileCount === n && !customCount ? "var(--accent)" : "var(--input-bg)",
                  color: tileCount === n && !customCount ? "#000" : "var(--foreground)",
                  border: `2px solid ${tileCount === n && !customCount ? "var(--accent)" : "var(--input-border)"}`,
                }}
              >
                {n}
              </button>
            ))}

            <input
              type="number"
              min="1"
              max="144"
              value={customCount}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9]/g, '');
                setCustomCount(value);
                if (value) setTileCount(parseInt(value, 10));
              }}
              onKeyDown={(e) => {
                // Prevent typing non-numeric characters
                if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
                  e.preventDefault();
                }
              }}
              placeholder="..."
              className="w-20 rounded-lg px-3 py-3 text-lg text-center font-bold outline-none focus:ring-2"
              style={{
                background: "var(--input-bg)",
                border: "2px solid var(--input-border)",
                color: "var(--foreground)",
              }}
            />
          </div>

          <button
            onClick={startNewGame}
            className="rounded-lg px-8 py-3 text-lg font-bold text-black transition-all cursor-pointer hover:opacity-90"
            style={{ background: "var(--accent)" }}
          >
            Start game – {customCount || tileCount} tiles
          </button>
        </div>
      )}

      {/* ── CAPTURE ── */}
      {step === "capture" && (
        <div className="w-full max-w-lg flex flex-col items-center gap-4 mt-6">
          <h2 className="text-xl font-semibold">Capture the tiles</h2>
          <p className="text-sm opacity-60 text-center">
            Take a photo or upload one ({tileCount} tiles)
          </p>

          {/* Camera view */}
          {cameraActive && (
            <div className="relative w-full rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full rounded-lg"
              />
              <button
                onClick={capturePhoto}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full w-16 h-16 border-4 border-white bg-white/30 cursor-pointer hover:bg-white/50 transition-all"
              />
            </div>
          )}

          {/* Captured preview */}
          {capturedPreview && !cameraActive && (
            <div className="w-full">
              <img
                src={capturedPreview}
                alt="Captured photo"
                className="w-full rounded-lg"
              />
            </div>
          )}

          {/* Action buttons */}
          {!cameraActive && !capturedPreview && (
            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={startCamera}
                className="w-full rounded-lg px-6 py-4 text-lg font-bold text-black transition-all cursor-pointer hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                📷 Open camera
              </button>

              <label
                className="w-full rounded-lg px-6 py-4 text-lg font-bold text-center cursor-pointer hover:opacity-90 transition-all"
                style={{
                  background: "var(--input-bg)",
                  border: "2px solid var(--input-border)",
                  color: "var(--foreground)",
                  display: "block",
                }}
              >
                📁 Upload photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {/* Divider */}
              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px" style={{ background: "var(--input-border)" }} />
                <span className="text-sm opacity-40">or</span>
                <div className="flex-1 h-px" style={{ background: "var(--input-border)" }} />
              </div>

              {/* Manual input */}
              <div className="flex flex-col gap-2">
                <label className="text-sm opacity-60">Manual input</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualInput}
                    onChange={(e) => {
                      const filtered = e.target.value
                        .toLowerCase()
                        .split("")
                        .filter((c) => VALID_CHARS.has(c))
                        .join("");
                      setManualInput(filtered);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && manualInput.length >= 2) {
                        handleManualSolve();
                      }
                    }}
                    placeholder="Type letters..."
                    className="flex-1 rounded-lg px-4 py-3 text-lg font-mono tracking-widest uppercase outline-none focus:ring-2"
                    style={{
                      background: "var(--input-bg)",
                      border: "2px solid var(--input-border)",
                      color: "var(--foreground)",
                    }}
                  />
                  <button
                    onClick={handleManualSolve}
                    disabled={manualInput.length < 2}
                    className="rounded-lg px-6 py-3 font-bold transition-all cursor-pointer hover:opacity-90 disabled:cursor-not-allowed disabled:hover:opacity-100"
                    style={
                      manualInput.length >= 2
                        ? { background: "var(--accent)", color: "#000", border: "2px solid var(--accent)" }
                        : { background: "var(--input-bg)", color: "var(--foreground)", border: "2px solid var(--input-border)", opacity: 0.7 }
                    }
                  >
                    Solve
                  </button>
                </div>
                {manualInput.length > 0 && (
                  <p className="text-xs opacity-50">
                    {manualInput.length} letters
                  </p>
                )}
              </div>
            </div>
          )}

          {/* After capture actions */}
          {capturedPreview && !detecting && (
            <div className="flex gap-3 w-full">
              <button
                onClick={retakePhoto}
                className="flex-1 rounded-lg px-4 py-3 font-bold cursor-pointer transition-all"
                style={{
                  background: "var(--input-bg)",
                  border: "2px solid var(--input-border)",
                  color: "var(--foreground)",
                }}
              >
                Retake
              </button>
              <button
                onClick={runDetection}
                className="flex-1 rounded-lg px-4 py-3 font-bold text-black cursor-pointer transition-all hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Detect tiles
              </button>
            </div>
          )}

          {/* Detecting spinner */}
          {detecting && (
            <div className="flex flex-col items-center gap-3 mt-4">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-600 border-t-amber-400" />
              <p className="text-sm opacity-60">Detecting letters...</p>
            </div>
          )}

          {/* Detection error */}
          {detectionError && (
            <div className="rounded-lg bg-red-900/40 border border-red-700 px-6 py-3 text-red-300 w-full text-center">
              {detectionError}
            </div>
          )}

          {/* Back button */}
          <button
            onClick={resetGame}
            className="text-sm opacity-50 hover:opacity-80 cursor-pointer mt-2"
          >
            ← Back to start
          </button>
        </div>
      )}

      {/* ── DETECTION RESULT ── */}
      {step === "detection" && detection && (
        <div className="w-full max-w-lg flex flex-col items-center gap-4">
          {/* Annotated image */}
          <img
            src={`data:image/jpeg;base64,${detection.annotated_image}`}
            alt="Detected tiles"
            className="w-full rounded-lg"
          />

          {/* Timing breakdown */}
          {detection.timing && (
            <div
              className="w-full rounded-lg px-4 py-3 cursor-pointer transition-opacity hover:opacity-80"
              style={{ background: "var(--input-bg)", border: "2px solid var(--input-border)" }}
              onClick={() => setShowDetectionStats(!showDetectionStats)}
            >
              <div className="flex justify-between items-center">
                <div className="flex gap-4 text-sm opacity-70">
                  <div>Total: {detection.timing.total_ms} ms</div>
                </div>
                <span className="text-xs opacity-50">{showDetectionStats ? "▼" : "▶"}</span>
              </div>

              {/* Expanded stats */}
              {showDetectionStats && (
                <div className="mt-2.5 pt-2.5 border-t border-gray-700 space-y-1">
                  <div className="text-xs font-semibold opacity-70 mb-1.5">Pipeline</div>
                  <div className="flex justify-between text-xs opacity-60 font-mono">
                    <span>Preprocess</span>
                    <span>{detection.timing.preprocess_ms} ms</span>
                  </div>
                  <div className="flex justify-between text-xs opacity-60 font-mono">
                    <span>Inference</span>
                    <span>{detection.timing.inference_ms} ms</span>
                  </div>
                  <div className="flex justify-between text-xs opacity-60 font-mono">
                    <span>Postprocess</span>
                    <span>{detection.timing.postprocess_ms} ms</span>
                  </div>
                  
                  {detection.yolo_timing && (
                    <>
                      <div className="mt-2 pt-2 border-t border-gray-700/50"></div>
                      <div className="text-xs font-semibold opacity-70 mb-1">YOLO Internal</div>
                      <div className="flex justify-between text-xs opacity-60 font-mono">
                        <span>Preprocess</span>
                        <span>{detection.yolo_timing.preprocess_ms} ms</span>
                      </div>
                      <div className="flex justify-between text-xs opacity-60 font-mono">
                        <span>Inference</span>
                        <span>{detection.yolo_timing.inference_ms} ms</span>
                      </div>
                      <div className="flex justify-between text-xs opacity-60 font-mono">
                        <span>Postprocess</span>
                        <span>{detection.yolo_timing.postprocess_ms} ms</span>
                      </div>
                    </>
                  )}
                  
                  {detection.thresholds && (
                    <>
                      <div className="mt-2 pt-2 border-t border-gray-700/50"></div>
                      <div className="text-xs font-semibold opacity-70 mb-1">Config</div>
                      <div className="flex justify-between text-xs opacity-60 font-mono">
                        <span>NMS threshold</span>
                        <span>{detection.thresholds.nms}</span>
                      </div>
                      <div className="flex justify-between text-xs opacity-60 font-mono">
                        <span>Confidence threshold</span>
                        <span>{detection.thresholds.confidence}</span>
                      </div>
                    </>
                  )}
                  
                  {detection.avg_confidence != null && (
                    <>
                      <div className="mt-2 pt-2 border-t border-gray-700/50"></div>
                      <div className="flex justify-between text-xs opacity-60 font-mono">
                        <span>Avg confidence</span>
                        <span>{detection.avg_confidence}%</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Detection summary */}
          <div
            className="w-full rounded-lg p-4"
            style={{ background: "var(--input-bg)", border: "2px solid var(--input-border)" }}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm opacity-60">Detected</span>
              <span
                className="font-bold text-lg"
                style={{
                  color: detection.count === tileCount ? "#4ade80" : "#f87171",
                }}
              >
                {detection.count} / {tileCount}
              </span>
            </div>

            {/* Detected letters as tiles */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {detection.letter_list.map((item, i) => (
                <div key={i} className="tile text-sm" style={{ width: 36, height: 36, fontSize: "1rem" }}>
                  {item.letter.toUpperCase()}
                </div>
              ))}
            </div>
          </div>

          {/* Mismatch warning */}
          {detection.count !== tileCount && (
            <div className="w-full rounded-lg bg-amber-900/40 border border-amber-600 px-4 py-3 text-amber-300">
              <p className="font-medium mb-2">
                ⚠️ Detected {detection.count} tiles, but expected {tileCount}.
              </p>
              <p className="text-sm opacity-80 mb-3">
                Review the image above and fix the letters below.
                You can add or remove missing/incorrect tiles manually.
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={correctedLetters}
                  onChange={(e) => {
                    const filtered = e.target.value
                      .toLowerCase()
                      .split("")
                      .filter((c) => VALID_CHARS.has(c))
                      .join("");
                    setCorrectedLetters(filtered);
                  }}
                  className="flex-1 rounded-lg px-3 py-2 font-mono tracking-widest uppercase outline-none text-base"
                  style={{
                    background: "#1a1a2e",
                    border: "2px solid var(--input-border)",
                    color: "var(--foreground)",
                  }}
                />
                <button
                  onClick={handleCorrectionSubmit}
                  disabled={correctedLetters.length < 2}
                  className="rounded-lg px-5 py-2 font-bold cursor-pointer transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:hover:opacity-100"
                  style={
                    correctedLetters.length >= 2
                      ? { background: "var(--accent)", color: "#000", border: "2px solid var(--accent)" }
                      : { background: "var(--input-bg)", color: "var(--foreground)", border: "2px solid var(--input-border)", opacity: 0.7 }
                  }
                >
                  Solve
                </button>
              </div>

              <p className="text-xs opacity-50 mt-1">
                {correctedLetters.length} letters
              </p>
            </div>
          )}

          {/* If count matches, auto-solving */}
          {detection.count === tileCount && solving && (
            <div className="flex flex-col items-center gap-3 mt-2">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-600 border-t-amber-400" />
              <p className="text-sm opacity-60">Solving...</p>
            </div>
          )}

          {/* Solve error */}
          {solveError && (
            <div className="rounded-lg bg-red-900/40 border border-red-700 px-6 py-3 text-red-300 w-full text-center">
              {solveError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 w-full">
            <button
              onClick={() => {
                setStep("capture");
                retakePhoto();
              }}
              className="flex-1 rounded-lg px-4 py-3 font-bold cursor-pointer transition-all"
              style={{
                background: "var(--input-bg)",
                border: "2px solid var(--input-border)",
                color: "var(--foreground)",
              }}
            >
              Take a new photo
            </button>
            {detection.count === tileCount && !solving && (
              <button
                onClick={() => solvePuzzle(detection.letters)}
                className="flex-1 rounded-lg px-4 py-3 font-bold text-black cursor-pointer transition-all hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Solve
              </button>
            )}
          </div>

          <button
            onClick={resetGame}
            className="text-sm opacity-50 hover:opacity-80 cursor-pointer"
          >
            ← Back to start
          </button>
        </div>
      )}

      {/* ── SOLVED ── */}
      {step === "solved" && solution && (
        <div className="w-full max-w-lg md:max-w-4xl flex flex-col items-center gap-5 mt-4">
          {solution.solved ? (
            <>
              <div className="flex flex-col items-center gap-1">
                <h2 className="text-xl font-semibold" style={{ color: "#4ade80" }}>
                  Solution found!
                </h2>
                <p className="text-sm opacity-60">
                  {placedTiles} tiles placed in {formatMs(solution.time_ms)}
                </p>
              </div>

              {/* Solution grid - tiles scale down so the board always fits */}
              <div ref={gridWrapRef} className="w-full flex justify-center">
                <div className="flex flex-col" style={{ gap: GRID_GAP }}>
                  {solution.grid.map((row, y) => (
                    <div key={y} className="flex" style={{ gap: GRID_GAP }}>
                      {Array.from({ length: gridCols }, (_, x) => {
                        const cell = row[x] ?? null;
                        return cell ? (
                          <div key={x} className="tile" style={tileStyle}>
                            {cell}
                          </div>
                        ) : (
                          <div key={x} style={emptyTileStyle} />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Words the solver placed */}
              {(solutionWords.across.length > 0 || solutionWords.down.length > 0) && (
                <div
                  className="w-full rounded-lg px-4 py-3"
                  style={{ background: "var(--input-bg)", border: "2px solid var(--input-border)" }}
                >
                  <div className="flex flex-col gap-2.5">
                    {([
                      ["Across", solutionWords.across],
                      ["Down", solutionWords.down],
                    ] as const).map(([label, list]) =>
                      list.length === 0 ? null : (
                        <div key={label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
                          <span className="text-xs uppercase tracking-wide opacity-50 w-14 shrink-0">
                            {label}
                          </span>
                          {list.map((w, i) => (
                            <span
                              key={`${w}-${i}`}
                              className="rounded px-2 py-0.5 text-sm font-mono tracking-wide"
                              style={{ background: "#1f2b4d", color: "var(--foreground)" }}
                            >
                              {w}
                            </span>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col items-center gap-1">
                <h2 className="text-xl font-semibold" style={{ color: "#f87171" }}>
                  No solution found
                </h2>
                <p className="text-sm opacity-60 text-center max-w-sm">
                  The solver searched for {formatMs(solution.time_ms)} without finding a way to
                  use every tile. That usually means a letter was misread, or the hand is
                  simply short on vowels.
                </p>
              </div>

              {lastLetters && (
                <div
                  className="w-full rounded-lg px-4 py-3 text-center"
                  style={{ background: "var(--input-bg)", border: "2px solid var(--input-border)" }}
                >
                  <div className="text-xs uppercase tracking-wide opacity-50 mb-1.5">
                    Letters tried
                  </div>
                  <div className="font-mono tracking-widest uppercase break-all">
                    {lastLetters}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3 w-full max-w-sm mt-1">
            {!solution.solved && lastLetters && (
              <button
                onClick={editLetters}
                className="flex-1 rounded-lg px-4 py-3 font-bold cursor-pointer transition-all"
                style={{
                  background: "var(--input-bg)",
                  border: "2px solid var(--input-border)",
                  color: "var(--foreground)",
                }}
              >
                Edit letters
              </button>
            )}
            <button
              onClick={resetGame}
              className="flex-1 rounded-lg px-4 py-3 font-bold text-black cursor-pointer transition-all hover:opacity-90"
              style={{ background: "var(--accent)" }}
            >
              New game
            </button>
          </div>
        </div>
      )}

      {/* ── Solving overlay ── */}
      {solving && step !== "detection" && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-600 border-t-amber-400" />
          <p className="text-sm opacity-60">Solving...</p>
        </div>
      )}
    </div>
  );
}
