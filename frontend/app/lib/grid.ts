export type Grid = (string | null)[][];

export function gridWidth(grid: Grid) {
  return grid.reduce((m, r) => Math.max(m, r.length), 0);
}

// The horizontal and vertical runs of 2+ letters: the words on the board.
export function extractWords(grid: Grid) {
  const rows = grid.length;
  const cols = gridWidth(grid);
  const at = (y: number, x: number) => grid[y]?.[x] ?? null;
  const across: string[] = [];
  const down: string[] = [];

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

export function formatMs(ms: number) {
  if (ms < 1) return "<1 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}
