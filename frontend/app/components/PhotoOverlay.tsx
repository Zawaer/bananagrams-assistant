"use client";

import type { CSSProperties } from "react";
// One colour per letter, spread round the colour wheel by the golden angle.
// Letters are taken commonest first, so the letters that fill most of a photo
// get the hues furthest apart. Same lightness and chroma for all, so no letter
// shouts louder than another.
const BY_FREQUENCY = "aitnesloukämvrjhypdögb";

function letterColor(letter: string) {
  const i = Math.max(0, BY_FREQUENCY.indexOf(letter));
  return `oklch(0.76 0.15 ${(i * 137.508 + 25) % 360})`;
}

export type Photo = { url: string; width: number; height: number };

export type OverlayTile = {
  id: number;
  letter: string;
  shape: [number, number][];
  doubtful: boolean;
};

// The photo with each detected tile outlined and labelled with what it was
// read as. Drawn here rather than by the detector so it can use real Ä/Ö,
// stay quiet for confident reads, and respond to taps.
export function PhotoOverlay({
  photo,
  tiles,
  selected,
  onSelect,
}: {
  photo: Photo;
  tiles: OverlayTile[];
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  // Label size follows the typical tile size, so it reads the same at any
  // photo resolution.
  const sizes = tiles.map((t) => {
    const xs = t.shape.map((p) => p[0]);
    const ys = t.shape.map((p) => p[1]);
    return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  });
  const median = sizes.length ? [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : 60;
  const r = Math.max(10, median * 0.24);
  const stroke = Math.max(2, median * 0.035);

  return (
    <div className="overlay">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL */}
      <img src={photo.url} alt="Your photo with the detected tiles outlined" />
      <svg viewBox={`0 0 ${photo.width} ${photo.height}`} preserveAspectRatio="none">
        {tiles.map((t) => {
          const points = t.shape.map((p) => p.join(",")).join(" ");
          // Label in the tile's top-left corner, so the real letter underneath
          // stays visible to compare against.
          const top = [...t.shape].sort((a, b) => a[0] + a[1] - (b[0] + b[1]))[0];
          const cx = top[0] + r * 0.55;
          const cy = top[1] + r * 0.55;
          const state = t.id === selected ? "is-selected" : t.doubtful ? "is-doubtful" : "";
          return (
            <g
              key={t.id}
              className={`ov-tile ${state}`}
              style={{ "--c": letterColor(t.letter) } as CSSProperties}
              onClick={() => onSelect(t.id)}
            >
              <polygon points={points} strokeWidth={stroke} strokeDasharray={t.doubtful ? `${stroke * 3} ${stroke * 2}` : undefined} />
              <circle cx={cx} cy={cy} r={r} strokeWidth={t.doubtful ? stroke * 1.6 : stroke * 0.8} />
              <text x={cx} y={cy} fontSize={r * 1.25} dy="0.36em">
                {t.letter.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
