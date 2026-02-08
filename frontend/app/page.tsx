"use client";

import { useState } from "react";

const VALID_CHARS = new Set("abdeghijklmnoprstuvyäö".split(""));

type SolveResult = {
  solved: boolean;
  time_ms: number;
  grid: (string | null)[][];
};

export default function Home() {
  const [letters, setLetters] = useState("");
  const [result, setResult] = useState<SolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInput = (value: string) => {
    const filtered = value
      .toLowerCase()
      .split("")
      .filter((c) => VALID_CHARS.has(c))
      .join("");
    setLetters(filtered);
  };

  const solve = async () => {
    if (letters.length < 2) {
      setError("Syötä vähintään 2 kirjainta");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("http://localhost:8080/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ letters }),
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const data: SolveResult = await res.json();
      setResult(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Yhteysvirhe palvelimeen"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") solve();
  };

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-12">
      <h1
        className="mb-2 text-4xl font-bold tracking-tight"
        style={{ color: "var(--accent)" }}
      >
        Bananagrams Solver
      </h1>
      <p className="mb-8 text-sm opacity-60">
        Suomenkielinen Bananagrams-ratkaisija
      </p>

      {/* Input section */}
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={letters}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Syötä kirjaimet..."
            className="flex-1 rounded-lg px-4 py-3 text-lg font-mono tracking-widest uppercase outline-none focus:ring-2"
            style={{
              background: "var(--input-bg)",
              border: "2px solid var(--input-border)",
              color: "var(--foreground)",
            }}
            disabled={loading}
          />
          <button
            onClick={solve}
            disabled={loading || letters.length < 2}
            className="rounded-lg px-6 py-3 text-lg font-bold text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            style={{
              background: loading ? "var(--input-border)" : "var(--accent)",
            }}
            onMouseEnter={(e) => {
              if (!loading)
                (e.target as HTMLElement).style.background =
                  "var(--accent-hover)";
            }}
            onMouseLeave={(e) => {
              if (!loading)
                (e.target as HTMLElement).style.background = "var(--accent)";
            }}
          >
            {loading ? "..." : "Ratkaise"}
          </button>
        </div>

        {/* Letter count */}
        {letters.length > 0 && (
          <p className="text-sm opacity-50 text-center">
            {letters.length} kirjainta
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 rounded-lg bg-red-900/40 border border-red-700 px-6 py-3 text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="mt-12 flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-600 border-t-amber-400" />
          <p className="text-sm opacity-60">Ratkaistaan...</p>
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="mt-8 flex flex-col items-center gap-4">
          {result.solved ? (
            <>
              <p className="text-sm opacity-60">
                Ratkaistu {result.time_ms} ms:ssa
              </p>
              <div className="flex flex-col gap-0.5">
                {result.grid.map((row, y) => (
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
            <p className="text-amber-400 text-lg font-medium">
              Ratkaisua ei löytynyt
            </p>
          )}
        </div>
      )}
    </div>
  );
}
