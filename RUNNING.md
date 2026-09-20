Quick run notes: Docker Compose (v2) and manual runs

Docker (recommended)

- Ensure Docker Engine with the Compose v2 CLI plugin and Buildx are installed.
- Start everything (frontend, solver, detection), rebuilding if needed:

```bash
make up
```

- Stop and remove the containers:

```bash
make down
```

- Other targets: `make logs`, `make ps`, `make build`, `make rebuild`, `make clean`.
  Run `make help` for the full list. They are thin wrappers, so plain
  `docker compose up --build -d` works too.

- If your Docker CLI doesn't support `docker compose`, install the plugin:

```bash
# macOS (Homebrew)
brew install docker-compose-plugin docker-buildx-plugin

# verify
docker compose version
docker buildx version
```

Once up:

- Frontend  http://localhost:3000
- Solver    http://localhost:8080/health
- Detection http://localhost:8081/health

Using it from a phone:
- Open `http://<your-machine-ip>:3000` on any device on the same network.
- The frontend derives the backend URLs from the hostname it was loaded on, so
  no configuration is needed. Camera capture needs HTTPS or localhost, so from
  a phone use the upload path, or put the app behind a TLS proxy.

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
