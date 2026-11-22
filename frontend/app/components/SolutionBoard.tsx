"use client";

import { useEffect, useRef, useState } from "react";
import { gridWidth, type Grid } from "../lib/grid";
import { Tile } from "./Tile";

const GAP = 3;
const MAX_TILE = 44;
const MIN_TILE = 14;

// The solved grid. Tiles shrink so the whole board fits the screen instead of
// scrolling sideways, and drop in one diagonal at a time.
export function SolutionBoard({ grid }: { grid: Grid }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cols = gridWidth(grid);
  const [size, setSize] = useState(MAX_TILE);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !cols) return;
    const fit = () => {
      const per = (el.clientWidth - GAP * (cols - 1)) / cols;
      setSize(Math.max(MIN_TILE, Math.min(MAX_TILE, Math.floor(per))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cols]);

  return (
    <div ref={wrap} className="w-full flex justify-center">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${size}px)`,
          gridAutoRows: `${size}px`,
          gap: GAP,
        }}
      >
        {grid.flatMap((row, y) =>
          Array.from({ length: cols }, (_, x) => {
            const cell = row[x] ?? null;
            return cell ? (
              <Tile
                key={`${y}-${x}`}
                letter={cell}
                size={size}
                className="tile-drop"
                style={{ animationDelay: `${(x + y) * 25}ms` }}
              />
            ) : (
              <div key={`${y}-${x}`} />
            );
          })
        )}
      </div>
    </div>
  );
}
