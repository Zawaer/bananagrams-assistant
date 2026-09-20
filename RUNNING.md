Quick run notes: Docker Compose (v2) and manual runs

Docker (recommended, homelab)

- Ensure Docker Engine with the Compose v2 CLI plugin and Buildx are installed.
- Start services (detached):

```bash
docker compose up --build -d
```

- To stop and remove:

```bash
docker compose down
```

- If your Docker CLI doesn't support `docker compose`, install the plugin:

```bash
# macOS (Homebrew)
brew install docker-compose-plugin docker-buildx-plugin

# verify
docker compose version
docker buildx version
```

Notes on model file:
- The segmentation service expects an ONNX model at `image-segmentation/models/yolo11x-seg-200epochs-100images.onnx`.
- Either mount it (the compose file does this) or set `MODEL_DOWNLOAD_URL` env var when starting.

Manual (no Docker)

Segmentation service (Python)

```bash
cd backend/segmentation
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# ensure model is at ../../image-segmentation/models/yolo11x-seg-200epochs-100images.onnx
python3 segmentation-server.py
```

Solver service (C++)

```bash
cd backend/solver
# simple compile
g++ -std=c++17 -O2 -pthread main.cpp -o solver-server
# run with bundled wordlist
./solver-server ../wordlist-parser/wordlist.txt
```

Frontend (Next.js)

```bash
cd frontend
yarn install   # or `npm install`
yarn dev       # runs on http://localhost:3000
```

Possible next steps

- Add the frontend to `docker compose` (needs a `Dockerfile` for `frontend`).
- Add a small `Makefile` to simplify `up`/`down`.
