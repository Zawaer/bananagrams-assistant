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

export type WordRun = { word: string; dir: "across" | "down"; cells: [number, number][] };

// The words on the board with the cells each one covers, for selecting one.
export function wordRuns(grid: Grid): WordRun[] {
  const rows = grid.length;
  const cols = gridWidth(grid);
  const at = (y: number, x: number) => grid[y]?.[x] ?? null;
  const runs: WordRun[] = [];
  const scan = (dir: "across" | "down", outer: number, inner: number, cell: (o: number, i: number) => [number, number]) => {
    for (let o = 0; o < outer; o++) {
      let cells: [number, number][] = [];
      for (let i = 0; i <= inner; i++) {
        const [y, x] = cell(o, i);
        if (i < inner && at(y, x)) cells.push([y, x]);
        else {
          if (cells.length >= 2) runs.push({ dir, cells, word: cells.map(([cy, cx]) => at(cy, cx)).join("") });
          cells = [];
        }
      }
    }
  };
  scan("across", rows, cols, (y, x) => [y, x]);
  scan("down", cols, rows, (x, y) => [y, x]);
  return runs;
}
