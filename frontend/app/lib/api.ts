import { rulesToWire, type Rules } from "./rules";

// Backend calls. The page is served from the same origin as both backends
// (under /api), unless NEXT_PUBLIC_* says otherwise, as in `yarn dev`.

function serverUrl(envValue: string | undefined, devPort: number) {
  if (envValue) return envValue;
  if (typeof window !== "undefined") return `http://${window.location.hostname}:${devPort}`;
  return `http://localhost:${devPort}`;
}

const DETECTION_SERVER = serverUrl(process.env.NEXT_PUBLIC_DETECTION_SERVER_URL, 8081);
const SOLVER_SERVER = serverUrl(process.env.NEXT_PUBLIC_SOLVER_SERVER_URL, 8080);

export type DetectionResult = {
  letters: string;
  letter_list: { letter: string; confidence: number }[];
  /** Only sent when asked for; the app draws its own overlay from `tiles`. */
  annotated_image?: string | null;
  tiles?: DetectedTile[];
  /** Size of the image the outlines refer to (the uploaded one). */
  image_size?: [number, number];
  count: number;
  timing?: { preprocess_ms: number; inference_ms: number; postprocess_ms: number; total_ms: number };
  avg_confidence?: number;
};

export type DetectedTile = {
  letter: string;
  confidence: number;
  box: [number, number, number, number];
  polygon: [number, number][];
};

export type SolveResult = {
  solved: boolean;
  time_ms: number;
  grid: (string | null)[][];
};

function describe(e: unknown, what: string) {
  const raw = e instanceof Error ? e.message : String(e);
  return /failed to fetch|networkerror|load failed/i.test(raw)
    ? `Couldn't reach the ${what}. Is it running?`
    : raw;
}

// The detector loads its model on demand and drops it when idle. Poking it as
// soon as the app opens means it is usually ready by the time a photo is taken.
export function warmDetector() {
  fetch(`${DETECTION_SERVER}/warm`, { method: "POST" }).catch(() => {});
}

// Phone photos are 4-8 MB, and the model looks at a 640 px version anyway.
// Shrinking before upload makes the round trip much quicker on a slow link.
async function shrink(file: Blob, maxEdge = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2_000_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.9)
    );
  } catch {
    return file;
  }
}

// Returns the detection along with the image that was actually sent, since
// the tile outlines are in that image's coordinates.
export async function detect(
  file: Blob,
  signal?: AbortSignal
): Promise<DetectionResult & { image: Blob }> {
  const image = await shrink(file);
  const body = new FormData();
  body.append("image", image);
  body.append("annotate", "0");
  try {
    const res = await fetch(`${DETECTION_SERVER}/detect`, { method: "POST", body, signal });
    if (!res.ok) throw new Error(`The tile reader failed (${res.status}).`);
    return { ...(await res.json()), image };
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(describe(e, "tile reader"));
  }
}

export async function solve(letters: string[], rules: Rules, signal?: AbortSignal): Promise<SolveResult> {
  try {
    const res = await fetch(`${SOLVER_SERVER}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ letters: letters.join(""), ...rulesToWire(rules) }),
      signal,
    });
    if (!res.ok) throw new Error(`The solver failed (${res.status}).`);
    return await res.json();
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(describe(e, "solver"));
  }
}
