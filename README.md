# Bananagrams Assistant

**Point a camera at a pile of scattered Bananagrams tiles and get back a complete, valid crossword grid — in under two seconds.**

A full-stack computer vision + search project: a YOLO11x segmentation model reads the letters off physical tiles, and a from-scratch C++ backtracking solver arranges every one of them into a connected crossword of valid Finnish words.

<p align="center">
  <img src="docs/demo.gif" width="320" alt="End-to-end demo: choose tile count, upload a photo, tiles are detected, solution grid appears" />
</p>

<p align="center">
  <em>Real run, nothing staged: 21 tiles detected at 97% mean confidence in 1.4 s, then packed into a full grid in 4 ms.</em>
</p>

---

## How it works

Three independent services, each doing one job:

| | |
|---|---|
| **1. See** | A YOLO11x-seg model (fine-tuned on 70 hand-labelled photos) finds every tile in the frame and classifies its letter — including the Finnish `ä` and `ö`. |
| **2. Check** | Detected tile count is compared against the expected hand size. Mismatches are surfaced for manual correction rather than silently guessed at. |
| **3. Solve** | A C++17 backtracking solver packs all the letters into a single connected crossword in which every horizontal and vertical run is a real dictionary word. |

### Step 1 — Seeing the tiles

Raw photo in, per-tile instance masks and letter classes out. Tiles overlap, sit at arbitrary rotations, and are photographed under uncontrolled lighting:

<p align="center">
  <img src="docs/detection-before-after.jpg" width="820" alt="Left: raw photo of 21 scattered tiles. Right: the same photo with per-tile segmentation masks and predicted letters with confidence scores." />
</p>

Note the model reading tiles that are rotated to arbitrary angles, upside-down, and butted directly against each other — and correctly separating `A` from `Ä` (bottom right).

### Step 2 — Solving the grid

The 21 detected letters `J K O T S I L O I I I I I Ä I S S U E S A` become:

```
      S
  I   I
  S   I
O I K E U S L A I T O S
  I   I
  J
  Ä
```

`OIKEUSLAITOS` × `ISKIJÄ` × `SIILI` — 21 tiles, zero left over, every horizontal and vertical run a valid Finnish word. Found in **4 ms**.

---

## The app

<table>
<tr>
<td width="50%"><img src="docs/screens/01-setup.png" alt="Setup screen: choose 10, 15, 21 or a custom tile count" /></td>
<td width="50%"><img src="docs/screens/03-detection.jpg" alt="Detection screen showing the annotated image and a 21 / 21 match" /></td>
</tr>
<tr>
<td align="center"><b>Pick your hand size</b></td>
<td align="center"><b>Confirm the read before solving</b></td>
</tr>
</table>

<p align="center">
  <img src="docs/screens/05-solved.png" width="700" alt="Solution screen showing the completed crossword grid" />
</p>

Every run exposes its own timing breakdown, so the pipeline is measurable rather than a black box:

<p align="center">
  <img src="docs/screens/04-stats.jpg" width="330" alt="Expanded stats panel showing pipeline timings, YOLO internal timings, NMS and confidence thresholds, and average confidence" />
</p>

---

## Results

### Detection accuracy

The dataset is 100 hand-labelled photos split 70 / 20 / 10. The model was fine-tuned from `yolo11x-seg.pt` for 200 epochs on the 70-image train split, with the 20-image valid split used for validation during training. Measured with `ultralytics val` at `imgsz=640`:

| Split | Images | Instances | Precision | Recall | Box mAP@50 | Box mAP@50-95 | Mask mAP@50-95 |
|---|---|---|---|---|---|---|---|
| **test** (never seen during training) | 10 | 243 | 0.991 | 1.000 | 0.995 | 0.990 | 0.921 |
| valid (used for validation) | 20 | 471 | 0.995 | 0.997 | 0.995 | 0.993 | 0.936 |

The **test** row is the honest number: 243 tile instances the model had no contact with during training, and it found every one of them — recall 1.000 at 0.991 mean precision across the 22 classes. The valid row is listed for completeness but is not an unbiased estimate, since training used it for validation.

Caveat worth stating plainly: 10 images is a small test set, and all of it comes from the same tile set and shooting conditions. These numbers say the model has comfortably learned *these* tiles — not that it would generalise to a different Bananagrams set on a different table.

In live use the server additionally discards anything under a 0.8 confidence threshold, which is why real runs report ~96–97% mean confidence.

### Solver success rate

The solver was rewritten to do real backtracking (see below). Measured in-process — no HTTP in the loop — over 200 randomly generated hands per size, letters drawn independently in proportion to their frequency in the Finnish wordlist. Both versions saw the identical hands, and **every returned grid was machine-checked**: it must use exactly the dealt tiles, form a single connected component, and every horizontal and vertical run of 2+ letters must be in the dictionary.

| Hand | Before | After | Median time before → after |
|---|---|---|---|
| 10 tiles | 133/200 (66.5%) | **176/200 (88.0%)** | 4 ms → <1 ms |
| 15 tiles | 154/200 (77.0%) | **193/200 (96.5%)** | 11 ms → <1 ms |
| 21 tiles | 173/200 (86.5%) | **197/200 (98.5%)** | 44 ms → <1 ms |

Grids that failed validation: **8 before, 0 after**. The old version would occasionally return a board containing a non-word (`SHOTV`) or one that didn't use the dealt tiles — it reported success without checking that the runs it created were real words.

At 21 tiles the p95 is 31 ms and the worst case 1.3 s. The three unsolved hands all hit the search budget rather than proving anything, and all three were extreme draws with only 4–5 vowels among 21 tiles — a real tile bag produces those far less often than independent sampling does.

### Latency

End-to-end on an **Apple M3, CPU-only inference** (no GPU, no CoreML/TensorRT acceleration):

| Stage | Time |
|---|---|
| Preprocess (image decode) | 11 ms |
| YOLO inference | 834 ms |
| Postprocess (NMS, annotation, encoding) | 448 ms |
| **Detection total** | **1 294 ms** |
| Solver (21 tiles) | 4 ms |
| **Photo → finished grid** | **~1.3 s** |

Detection figures are the median of 8 consecutive runs on the same image; it varies by roughly ±100 ms run to run, and more if the machine is busy.

The solver is now a rounding error. Reading the physical world is the entire cost.

---

## The scale of the problem

To understand why the solver has to prune rather than enumerate, consider how many grids exist — even ignoring the dictionary entirely.

**Step 1: Board shapes (fixed polyominoes).** Any connected layout of 21 squares on a grid is a fixed polyomino. Per [OEIS A001168](https://oeis.org/A001168) there are exactly **22,964,779,660** of them for 21 squares. "Fixed" because rotating a layout 90° creates a new reading path, so orientation matters.

**Step 2: Letter arrangements.** Arranging 21 distinct letters into any one of those shapes gives 21! possibilities:

$$21! = 51{,}090{,}942{,}171{,}709{,}440{,}000$$

**Step 3: Multiply.**

$$22{,}964{,}779{,}660 \times 51{,}090{,}942{,}171{,}709{,}440{,}000 = 1{,}173{,}292{,}229{,}595{,}109{,}175{,}141{,}990{,}400{,}000$$

Roughly **1.17 nonillion** layouts. The space where every run is also a valid dictionary word is a vanishing sliver of that — which is the whole argument for depth-first search with early pruning instead of generate-and-test.

### How the solver actually works

1. The 90,474-word list is indexed once at startup into per-word letter-count vectors plus a 32-bit letter-presence mask, sorted longest-first. "Which words could these tiles spell?" becomes a mask test and a 32-byte comparison instead of a dictionary scan.
2. Place a seed word in the middle of the board, trying the longest the hand can spell first.
3. Recursively extend. For each letter already on the board, find words that spend the remaining hand tiles plus that one board letter, and try every position in the word against every matching cell, in both directions.
4. A placement is legal only if the cells before and after it are empty (so the run it forms is exactly that word) and **every perpendicular run it creates is itself a dictionary word**. Tiles are then deducted based on the cells actually written, so a word crossing two existing letters is accounted for correctly.
5. Succeed when the hand is empty. On a dead end, undo the grid writes, the spent tiles and the used-word marker, and try the next candidate.

Step 4 is where most of the gain comes from. The previous version forbade adjacency altogether rather than validating the words that adjacency creates, which both rejected legal dense boards and let illegal ones through. Step 5 is the other half: the previous version mutated the board, the hand and the wordlist without ever restoring them, so a failed branch poisoned everything after it — it was a greedy descent wearing a recursive function's clothes.

The search is bounded by a node and wall-clock budget (300,000 nodes / 5 s by default, both tunable on `Board`). A `solved: false` therefore means "no packing found within budget", which is not the same as proving the hand impossible.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                 Frontend (Next.js)                  │
│                Port 3000 (Turbopack)                │
│   ┌──────────────┐              ┌──────────────┐    │
│   │ Setup        │──────────────│ Capture      │    │
│   │ (tile count) │              │ (camera/img) │    │
│   └──────────────┘              └──────────────┘    │
│          ▲                               ▲          │
│          │                               │          │
│          └───────────────┬───────────────┘          │
│                          │                          │
└──────────────────────────┼──────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
     ┌────────┐      ┌───────────┐      ┌─────────┐
     │ Solver │      │ Segmenter │      │ Display │
     │ :8080  │      │ :8081     │      │ Results │
     └────────┘      └───────────┘      └─────────┘
         │                 │                 │
         └─────────────────┬─────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
    ┌──────────┐     ┌───────────┐     ┌───────────┐
    │ C++ HTTP │     │ YOLO ONNX │     │ Wordlist  │
    │ Server   │     │ Model     │     │ (Finnish) │
    └──────────┘     └───────────┘     └───────────┘
```

| Service | Stack | Notes |
|---|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind 4 | Camera capture, file upload, manual letter entry, grid rendering |
| Solver | C++17 | Backtracking search plus an HTTP server written directly on POSIX sockets — no framework, no JSON library, no dependencies |
| Segmentation | Python, Flask, ONNX Runtime | YOLO11x-seg via Ultralytics, `supervision` for NMS and annotation |

The C++ service implements its own HTTP parsing and JSON serialisation against raw sockets. That was the point of the exercise — it builds and runs with nothing but a compiler.

---

## Project structure

```
bananagrams-assistant/
├── backend/
│   ├── solver/                     # C++ solving engine
│   │   ├── main.cpp                # HTTP server (port 8080)
│   │   ├── solver.h                # Board model & backtracking solver
│   │   └── utils.h                 # Timers, wide-char conversions
│   ├── segmentation/               # Python tile detection
│   │   ├── segmentation-server.py  # Flask server (port 8081)
│   │   └── requirements.txt
│   └── wordlist-parser/            # Finnish word list processing
│       ├── wordlist-parser.py
│       ├── wordlist.txt            # 90,474 filtered playable words
│       └── nykysuomensanalista2024.txt
├── frontend/                       # Next.js web UI
│   └── app/
│       ├── page.tsx                # Main game interface
│       ├── layout.tsx
│       └── globals.css
├── image-segmentation/             # YOLO training & export
│   ├── dataset/                    # 100 labelled images (70/20/10), 22 classes
│   ├── detect.py
│   ├── export-onnx.py
│   └── models/
│       └── yolo11x-seg-200epochs-100images.onnx
└── docs/                           # README media
```

---

## Getting started

### Prerequisites

- ONNX model at `image-segmentation/models/yolo11x-seg-200epochs-100images.onnx`
- Finnish wordlist at `backend/wordlist-parser/wordlist.txt`
- g++ with C++17 and POSIX sockets (macOS/Linux), Python 3.8+, Node.js 18+

### Docker Compose (recommended)

```bash
docker compose up --build -d      # solver on :8080, segmentation on :8081
docker compose down
```

The compose file mounts the ONNX model from `image-segmentation/models/`. Alternatively set `MODEL_DOWNLOAD_URL` to fetch it on first run.

### Manual

```bash
# Terminal 1 — C++ solver
cd backend/solver
g++ -std=c++17 -O2 -pthread main.cpp -o solver-server
./solver-server ../wordlist-parser/wordlist.txt

# Terminal 2 — segmentation server
cd backend/segmentation
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 segmentation-server.py

# Terminal 3 — frontend
cd frontend
yarn install && yarn dev
```

Then open `http://localhost:3000`. See [RUNNING.md](RUNNING.md) for more detail and [DEPLOYMENT.md](DEPLOYMENT.md) for the hosted path.

---

## API

### Solver — port 8080

`GET /health` → `{"status": "ok"}`

`POST /solve`

```jsonc
// request
{ "letters": "jkotsiloiiiiiäissuesa" }

// response
{
  "solved": true,
  "time_ms": 4,
  "grid": [[null, null, null, null, null, null, "S", ...], ["O", "I", "K", "E", "U", "S", "L", ...], ...]
}
```

`solved: false` comes back with an empty grid when no packing is found within the search budget.

The request body may use raw UTF-8 or `\uXXXX` escapes for `ä` and `ö` — both decode correctly, so clients like Python's `json.dumps` (which escapes non-ASCII by default) work as well as the browser's `JSON.stringify`.

### Segmentation — port 8081

`GET /health` → `{"status": "ok"}`

`POST /detect` — `multipart/form-data` with an `image` field

```jsonc
{
  "letters": "jkotsiloiiiiiäissuesa",
  "letter_list": [{ "letter": "j", "confidence": 0.985 }, ...],
  "annotated_image": "<base64 jpeg>",
  "count": 21,
  "timing":      { "preprocess_ms": 11, "inference_ms": 926, "postprocess_ms": 448, "total_ms": 1387 },
  "yolo_timing": { "preprocess_ms": 2,  "inference_ms": 885, "postprocess_ms": 6 },
  "avg_confidence": 97,
  "thresholds": { "nms": 0.8, "confidence": 0.8 }
}
```

---

## Configuration

| Where | Setting | Purpose |
|---|---|---|
| `backend/segmentation/segmentation-server.py` | `NMS_THRESHOLD = 0.8` | Suppress overlapping detections |
| | `CONFIDENCE_THRESHOLD = 0.8` | Minimum detection score |
| | `MODEL_PATH` | ONNX model location |
| `frontend/app/page.tsx` | `TILE_PRESETS` | Default hand-size options |
| | `VALID_CHARS` | The 22 letters on the Finnish tile set |
| | `NEXT_PUBLIC_*_SERVER_URL` | Backend endpoints (see `.env.example`) |

---

## Notes

- The tile set is Finnish, so the alphabet is 22 letters — `c`, `f`, `q`, `w`, `x`, `z` and `å` never appear on a tile.
- Camera capture requires HTTPS or `localhost`; the upload path works anywhere.
- Both backends report timing breakdowns on every request, which is how the numbers above were measured.
