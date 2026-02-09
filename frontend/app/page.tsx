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
};

type SolveResult = {
  solved: boolean;
  time_ms: number;
  grid: (string | null)[][];
};

const TILE_PRESETS = [10, 15, 21];
const DETECTION_SERVER = "http://localhost:8081";
const SOLVER_SERVER = "http://localhost:8080";

const VALID_CHARS = new Set("abdeghijklmnoprstuvyäö".split(""));

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

  // Solving
  const [solving, setSolving] = useState(false);
  const [solution, setSolution] = useState<SolveResult | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);

  // ============================================================================
  // Camera
  // ============================================================================

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch {
      setDetectionError("Camera access failed. Try uploading a photo instead.");
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
    <div className="flex min-h-screen flex-col items-center px-4 py-8">
      <h1 className="mb-1 text-3xl font-bold tracking-tight" style={{ color: "var(--accent)" }}>
        Bananagrams Assistant
      </h1>
      <p className="mb-6 text-sm opacity-60">English Bananagrams assistant</p>

      {/* ── Step indicator ── */}
      <StepIndicator current={step} />

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
                setCustomCount(e.target.value);
                if (e.target.value) setTileCount(parseInt(e.target.value, 10));
              }}
              placeholder="Custom"
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
                    className="rounded-lg px-6 py-3 font-bold text-black transition-all cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: manualInput.length >= 2 ? "var(--accent)" : "var(--input-border)",
                    }}
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
        <div className="w-full max-w-lg flex flex-col items-center gap-4 mt-6">
          <h2 className="text-xl font-semibold">Detection result</h2>

          {/* Annotated image */}
          <img
            src={`data:image/jpeg;base64,${detection.annotated_image}`}
            alt="Detected tiles"
            className="w-full rounded-lg"
          />

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
                  className="rounded-lg px-5 py-2 font-bold text-black cursor-pointer transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "var(--accent)" }}
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
        <div className="w-full max-w-lg flex flex-col items-center gap-4 mt-6">
          {solution.solved ? (
            <>
              <h2 className="text-xl font-semibold" style={{ color: "#4ade80" }}>
                Solution found!
              </h2>
              <p className="text-sm opacity-60">
                Solved in {solution.time_ms} ms
              </p>

              {/* Solution grid */}
              <div className="flex flex-col gap-0.5 overflow-x-auto max-w-full p-2">
                {solution.grid.map((row, y) => (
                  <div key={y} className="flex gap-0.5">
                    {row.map((cell, x) =>
                      cell ? (
                        <div key={x} className="tile">
                          {cell}
                        </div>
                      ) : (
                        <div key={x} className="tile-empty" />
                      )
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold" style={{ color: "#f87171" }}>
                No solution found
              </h2>
              <p className="text-sm opacity-60">
                Double-check the letters and try again
              </p>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3 w-full mt-4">
            <button
              onClick={() => {
                setStep("capture");
                setCapturedImage(null);
                setCapturedPreview(null);
                setDetection(null);
                setSolution(null);
              }}
              className="flex-1 rounded-lg px-4 py-3 font-bold cursor-pointer transition-all"
              style={{
                background: "var(--input-bg)",
                border: "2px solid var(--input-border)",
                color: "var(--foreground)",
              }}
            >
              New photo (same game)
            </button>
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

// ============================================================================
// Step indicator component
// ============================================================================

function StepIndicator({ current }: { current: GameStep }) {
  const steps: { key: GameStep; label: string }[] = [
    { key: "setup", label: "Setup" },
    { key: "capture", label: "Capture" },
    { key: "detection", label: "Detection" },
    { key: "solved", label: "Solution" },
  ];

  const currentIndex = steps.findIndex((s) => s.key === current);

  return (
    <div className="flex items-center gap-2 mb-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5"
            style={{ opacity: i <= currentIndex ? 1 : 0.3 }}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: i <= currentIndex ? "var(--accent)" : "var(--input-border)",
                color: i <= currentIndex ? "#000" : "var(--foreground)",
              }}
            >
              {i < currentIndex ? "✓" : i + 1}
            </div>
            <span className="text-xs hidden sm:inline">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div
              className="w-6 h-0.5"
              style={{
                background: i < currentIndex ? "var(--accent)" : "var(--input-border)",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
