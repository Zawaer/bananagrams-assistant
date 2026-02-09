# Bananagrams Assistant

A complete game assistant for Bananagrams gameplay combining computer vision tile detection, automatic word solving, and an intuitive web interface. Uses YOLO11x segmentation for real-time tile recognition and a C++ backtracking solver for optimal word placement.

## System Architecture

The assistant consists of three independent services communicating via HTTP:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                       │
│                    Port 3000 (Turbopack)                    │
│  ┌──────────────┐              ┌──────────────┐            │
│  │ Setup        │──────────────│ Capture      │            │
│  │ (tile count) │              │ (camera/img) │            │
│  └──────────────┘              └──────────────┘            │
│         ▲                               ▲                   │
│         │                               │                   │
│         └───────────────┬───────────────┘                   │
│                         │                                    │
└─────────────────────────┼────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
    ┌────────┐      ┌──────────┐      ┌────────┐
    │Solver  │      │Segmenter │      │Display │
    │:8080   │      │:8081     │      │Results │
    └────────┘      └──────────┘      └────────┘
        │                 │                 │
        └─────────────────┬─────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   ┌─────────┐      ┌──────────┐      ┌──────────┐
   │C++ HTTP │      │YOLO ONNX │      │Wordlist  │
   │Server   │      │Model     │      │(Finnish) │
   └─────────┘      └──────────┘      └──────────┘
```

## Project Structure

```
bananagrams-assistant/
├── backend/
│   ├── solver/              # C++ solving engine
│   │   ├── main.cpp        # HTTP server (port 8080)
│   │   ├── solver.h        # Game board & backtracking solver
│   │   └── utils.h         # Utilities (timers, conversions)
│   ├── segmentation/       # Python tile detection
│   │   ├── segmentation-server.py  # Flask server (port 8081)
│   │   └── requirements.txt
│   └── wordlist-parser/    # Finnish word list processing
│       ├── wordlist-parser.py
│       ├── wordlist.txt    # Filtered word list
│       └── nykysuomensanalista2024.txt  # Source dictionary
├── frontend/               # Next.js web UI
│   ├── app/
│   │   ├── page.tsx       # Main game interface
│   │   ├── layout.tsx     # Root layout
│   │   └── globals.css    # Styling
│   ├── package.json
│   └── tsconfig.json
└── image-segmentation/    # YOLO model training
    ├── detect.py
    ├── export_onnx.py
    └── models/
        └── yolo11x-seg-200epochs-100images.onnx
```

## Getting Started

### Prerequisites

**All platforms:**
- ONNX model file in `image-segmentation/models/yolo11x-seg-200epochs-100images.onnx`
- Finnish wordlist at `backend/wordlist-parser/wordlist.txt`

**Backend (C++):**
- g++ with C++17 support
- POSIX sockets (macOS, Linux)

**Backend (Python):**
- Python 3.8+
- pip packages: Flask, flask-cors, ultralytics, supervision, opencv-python-headless, numpy

**Frontend:**
- Node.js 18+
- npm or yarn

### Building

#### 1. C++ Solver Server

```bash
cd backend/solver

# Compile with g++
g++ -std=c++17 -pthread main.cpp -o solver-server

# Or use CMake (if installed)
mkdir -p build && cd build
cmake ..
make
cd ..
```

Run the server:
```bash
# Uses default wordlist at ../wordlist-parser/wordlist.txt
./solver-server

# Or specify custom wordlist
./solver-server /path/to/wordlist.txt
```

Server listens on `http://localhost:8080`

#### 2. Segmentation Server (YOLO Tile Detection)

```bash
cd backend/segmentation

# Install Python dependencies
pip install -r requirements.txt

# Run the server
python3 segmentation-server.py
```

Server listens on `http://localhost:8081`

#### 3. Frontend (Next.js)

```bash
cd frontend

# Install dependencies
npm install
# or
yarn install

# Start development server with Turbopack
npm run dev
# or
yarn dev
```

Frontend runs on `http://localhost:3000`

### Running the Complete System

In separate terminals:

```bash
# Terminal 1: Solver server
cd backend/solver
./solver-server

# Terminal 2: Segmentation server
cd backend/segmentation
python3 segmentation-server.py

# Terminal 3: Frontend
cd frontend
yarn dev
```

Visit `http://localhost:3000` in your browser.

## API Documentation

### Solver Server (Port 8080)

#### `GET /health`
Health check endpoint.

**Response:**
```json
{"status": "ok"}
```

#### `POST /solve`
Solve a Bananagrams puzzle.

**Request:**
```json
{
  "letters": "abcdefghijk"
}
```

**Response:**
```json
{
  "solved": true,
  "time_ms": 1542,
  "grid": [
    [null, null, "A", null],
    ["D", "O", "G", null],
    [null, null, "E", null]
  ]
}
```

### Segmentation Server (Port 8081)

#### `GET /health`
Health check endpoint.

**Response:**
```json
{"status": "ok"}
```

#### `POST /detect`
Detect tiles in an uploaded image.

**Request:**
Content-Type: `multipart/form-data`
- `image`: Image file (JPEG/PNG)

**Response:**
```json
{
  "letters": "aeioaeo",
  "letter_list": [
    {"letter": "a", "confidence": 0.95},
    {"letter": "e", "confidence": 0.92}
  ],
  "annotated_image": "base64_encoded_jpeg",
  "count": 7,
  "timing": {
    "preprocess_ms": 54,
    "inference_ms": 1082,
    "postprocess_ms": 690,
    "total_ms": 1837
  },
  "yolo_timing": {
    "preprocess_ms": 2,
    "inference_ms": 855,
    "postprocess_ms": 8
  },
  "avg_confidence": 96,
  "thresholds": {
    "nms": 0.8,
    "confidence": 0.8
  }
}
```

## Configuration

### Solver (C++)

Located in `backend/solver/`:
- Entry point: `main.cpp`
- Wordlist validation added - exits with error if wordlist.txt not found

### Frontend (React)

Located in `frontend/app/page.tsx`:
- `TILE_PRESETS`: Default tile count options
- `DETECTION_SERVER`: Segmentation server URL
- `SOLVER_SERVER`: Solver server URL
- `VALID_CHARS`: Allowed Finnish characters

### Segmentation (Python)

Located in `backend/segmentation/segmentation-server.py`:
- `NMS_THRESHOLD = 0.8`: Filter overlapping detections
- `CONFIDENCE_THRESHOLD = 0.8`: Minimum detection score
- `MODEL_PATH`: Path to YOLO ONNX model (relative path)

## Code Style & Conventions

The codebase follows consistent naming conventions across all languages:

### C++ (main.cpp, utils.h, solver.h)
- **Classes/Structs**: `PascalCase` (e.g., `Timer`, `WordUtil`, `Board`, `Hand`)
- **Functions**: `camelCase` (e.g., `start()`, `getMs()`, `startSolver()`)
- **Variables**: `snake_case` (e.g., `start_time`, `client_fd`, `board_size`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `PORT`, `MAX_GRID_SIZE`)

### Python (wordlist-parser.py, segmentation-server.py)
- **Functions**: `camelCase` (e.g., `containsOnlyAllowedChars()`, `parseDictionary()`)
- **Variables**: `snake_case` (e.g., `word_list`, `tile_count`, `homonym_buffer`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `TILE_PRESETS`, `ALLOWED_CHARS`, `NMS_THRESHOLD`)

### TypeScript/React (page.tsx)
- **Types**: `PascalCase` (e.g., `GameStep`, `DetectionResult`, `SolveResult`)
- **Functions/Hooks**: `camelCase` (e.g., `startCamera()`, `runDetection()`)
- **Variables**: `camelCase` (e.g., `tileCount`, `cameraActive`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `VALID_CHARS`, `DETECTION_SERVER`)

## Game Flow

1. **Setup**: Choose number of tiles (10, 15, 21, or custom)
2. **Capture**: Take photo with camera or upload existing image
3. **Detection**: AI identifies tiles with confidence scores
4. **Validation**: Compare detected count with expected count
5. **Correction**: Manually edit detected letters if needed
6. **Solution**: View optimal word placement grid

## Technical Details

- **Solver**: Recursive backtracking with anagram-based word lookup, collision detection for safe placement
- **Detection**: YOLO11x segmentation model trained on 100 images, 22 Finnish tile classes
- **Performance**: ~1.8s end-to-end (image upload → detection → solution)
- **Accuracy**: 96% average confidence on tile detection
- **Language**: Finnish Bananagrams tiles (full support: a-z, ä, ö)
- **HTTP**: Custom minimal JSON implementation (C++), no external dependencies

## Performance Metrics

The segmentation server provides detailed timing breakdown:

```
Pipeline (wall-clock time):
- Preprocess:   54ms (image decode)
- Inference:  1082ms (model + supervision)
- Postprocess: 690ms (NMS, annotation, encoding)
- Total:      1837ms

YOLO Internal:
- Preprocess:   2ms
- Inference:  855ms
- Postprocess:  8ms
```

## Development Notes

- C++ server uses POSIX sockets for HTTP (no external dependencies)
- Python detection uses OpenCV, supervision library for annotation
- Frontend communicates with both servers via CORS-enabled endpoints
- All servers include timing breakdown for performance debugging
- Detection stats panel shows both actual and YOLO-reported timings (collapsible UI)
- File existence validation prevents runtime crashes

## Error Handling

- **Missing wordlist**: C++ server exits immediately with error message
- **Failed detection**: Returns error response with HTTP 400
- **File not found**: Python server logs and returns error
- **Invalid image**: Proper error handling throughout pipeline
- **CORS issues**: All servers include proper CORS headers

## Future Improvements

- [ ] Real-time detection from camera stream (not just batch uploads)
- [ ] Support for multiple languages/tile sets
- [ ] Inference optimization (~500ms target)
- [ ] Mobile app version
- [ ] Game statistics tracking
- [ ] Support for different Bananagrams variants
- [ ] Batch processing for multiple game sessions
