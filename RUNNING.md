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

Using it from a phone

- Open `http://<your-machine-ip>:3000` on any device that can reach the
  machine: the same LAN, or a VPN such as Tailscale, where the address is the
  node name instead.
- No configuration needed. The frontend derives the backend URLs from the
  hostname it was loaded on, so whatever address you use for the page is the
  one it uses for the solver and the detection server.
- Use "Upload photo" rather than "Open camera". On iOS and Android that
  file picker offers "Take Photo", so you still shoot the tiles right there;
  it just goes through the system camera instead of a preview inside the page.

Why "Open camera" is greyed out over the network

Browsers only hand out the camera in a secure context, meaning HTTPS or
localhost. On the machine running it, `http://localhost:3000` qualifies and
the in-page camera works. From a phone, `http://192.168.x.x:3000` does not,
so the app says so and points you at the upload path.

Putting the page behind HTTPS is not quite a one-liner, because it moves the
problem rather than solving it: an HTTPS page may not call plain-HTTP
backends, so the solver and detection server have to be served over HTTPS
too, and the frontend has to be told where they are. There are
`NEXT_PUBLIC_SOLVER_SERVER_URL` and `NEXT_PUBLIC_DETECTION_SERVER_URL` for
that (see `frontend/.env.example`); note they are read at build time, so a
Docker image has to be rebuilt to change them. With Tailscale that means a
`tailscale serve` for each of the three, on its own HTTPS port.

Not worth it just to skip a tap in the file picker, but the option is there.

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
