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

Once up, the app is at http://localhost:3000. The backends sit behind it:

- Solver    http://localhost:3000/api/solver/health
- Detection http://localhost:3000/api/detect/health

Plain `docker compose up` (without `-f docker-compose.local.yml`) publishes
nothing; that base file is shared with the homelab deployment.

Using it from a phone

- Open `http://<your-machine-ip>:3000` on any device that can reach the
  machine: the same LAN, or a VPN such as Tailscale, where the address is the
  node name instead.
- No configuration needed: the page calls the backends on its own address,
  under `/api`.
- Use "Upload photo" rather than "Open camera". On iOS and Android that
  file picker offers "Take Photo", so you still shoot the tiles right there;
  it just goes through the system camera instead of a preview inside the page.

Why "Open camera" is greyed out over the network

Browsers only hand out the camera in a secure context, meaning HTTPS or
localhost. On the machine running it, `http://localhost:3000` qualifies and
the in-page camera works. From a phone, `http://192.168.x.x:3000` does not,
so the app says so and points you at the upload path.

Because everything is on one origin, putting that one port behind any HTTPS
reverse proxy (Caddy, `tailscale serve`) is enough to get the in-page camera;
the homelab deployment does exactly that.

Notes on model file:
- Under Docker the model is downloaded from the GitHub release into the `models` volume on first start (override with `MODEL_DOWNLOAD_URL`).
- Run by hand, the server looks for `image-segmentation/models/yolo11x-seg-200epochs-100images.onnx`, or set `MODEL_PATH`.

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
