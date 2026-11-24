import base64
import os
import signal
import threading
import time
import urllib.parse
import urllib.request

from flask import Flask, jsonify, request
from flask_cors import CORS

import ks_define

# cv2, numpy, supervision and ultralytics are imported inside detect(): see
# MODEL LOADING below for why the idle process keeps them out of memory.

app = Flask(__name__)
CORS(app)

# Detection thresholds. Measured with image-segmentation/tools/sweep.py: on
# photos of the whole pool, 0.8 threw away real tiles the model was only 50-80%
# sure of. Anything under 0.9 is marked doubtful in the app, so the extra tiles
# this lets through are flagged for checking rather than trusted. NMS runs
# across classes: one tile read as two letters is still one tile.
NMS_THRESHOLD = 0.5
CONFIDENCE_THRESHOLD = 0.5

# Class name mapping: model class names -> actual letters (for solver)
CLASS_NAME_TO_LETTER = {
    "a": "a",
    "a_dot": "ä",
    "b": "b",
    "d": "d",
    "e": "e",
    "g": "g",
    "h": "h",
    "i": "i",
    "j": "j",
    "k": "k",
    "l": "l",
    "m": "m",
    "n": "n",
    "o": "o",
    "o_dot": "ö",
    "p": "p",
    "r": "r",
    "s": "s",
    "t": "t",
    "u": "u",
    "v": "v",
    "y": "y",
}

# Class name mapping for display labels (OpenCV can't render ä/ö)
CLASS_NAME_TO_LABEL = {
    "a": "A",
    "a_dot": "A!",
    "b": "B",
    "d": "D",
    "e": "E",
    "g": "G",
    "h": "H",
    "i": "I",
    "j": "J",
    "k": "K",
    "l": "L",
    "m": "M",
    "n": "N",
    "o": "O",
    "o_dot": "O!",
    "p": "P",
    "r": "R",
    "s": "S",
    "t": "T",
    "u": "U",
    "v": "V",
    "y": "Y",
}

# ──── MODEL LOADING ────
# The model is loaded on the first /detect, not at import, and dropped again
# after IDLE_UNLOAD_SECONDS without a request. Torch, ultralytics and a loaded
# YOLO11x hold well over a gigabyte between them, which is a lot to sit on for
# an app used now and then. Unloading is done by ending the worker process:
# Python rarely hands freed memory back to the OS, so the only reliable way to
# get it back is to exit. Gunicorn starts a fresh worker straight away, and that
# worker has imported none of the heavy libraries.
#
# Where the model comes from, in order:
#   MODEL_PATH                set explicitly
#   ./model.onnx              mounted by docker-compose for local use
#   ../../image-segmentation/models/...   running from the repo checkout
#   MODEL_DOWNLOAD_URL        fetched once into MODEL_CACHE_DIR and kept there
#
# The input size comes from the ONNX file itself (ultralytics reads it from the
# export metadata), so the 640 and 960 models both work without a setting.

# The same weights as the old file, exported at 960 instead of 640: at 640 the
# tiles in a photo of the whole pool are too small and some go unseen (135 of
# 144 found on test1.jpg, against all 144 at 960). A fine-tune at 960 was tried
# and read letters slightly better but found fewer tiles in crowded photos.
MODEL_FILE = "yolo11x-seg-200epochs-100images-960.onnx"
OLD_MODEL_FILE = "yolo11x-seg-200epochs-100images.onnx"

MODEL_URL = os.environ.get("MODEL_DOWNLOAD_URL")
# Downloads are cached under the URL's file name, so pointing MODEL_DOWNLOAD_URL
# at a new model fetches it instead of reusing the old one from the volume.
MODEL_CACHE_DIR = os.environ.get(
    "MODEL_CACHE_DIR", os.path.dirname(os.environ.get("MODEL_CACHE_PATH", "/tmp/model.onnx"))
)
MODEL_CACHE_PATH = os.path.join(
    MODEL_CACHE_DIR, os.path.basename(urllib.parse.urlparse(MODEL_URL or "").path) or "model.onnx"
)
IDLE_UNLOAD_SECONDS = int(os.environ.get("IDLE_UNLOAD_SECONDS", "0"))  # 0 = never

LOCAL_MODEL_PATHS = [
    os.environ.get("MODEL_PATH", ""),
    "./model.onnx",
    f"../../image-segmentation/models/{MODEL_FILE}",
    f"../../image-segmentation/models/{OLD_MODEL_FILE}",
]

_model = None
_model_lock = threading.Lock()
_download_lock = threading.Lock()
_in_flight = 0
_last_used = time.monotonic()


def _download_model():
    """Fetch the model into MODEL_CACHE_PATH unless it is already there."""
    with _download_lock:
        if os.path.exists(MODEL_CACHE_PATH):
            return MODEL_CACHE_PATH
        os.makedirs(os.path.dirname(MODEL_CACHE_PATH) or ".", exist_ok=True)
        partial = MODEL_CACHE_PATH + ".part"
        print(f"Downloading model from {MODEL_URL}...", flush=True)
        urllib.request.urlretrieve(MODEL_URL, partial)
        # Rename only once complete, so an interrupted download is never
        # mistaken for a model on the next start.
        os.replace(partial, MODEL_CACHE_PATH)
        print(f"Model saved to {MODEL_CACHE_PATH}", flush=True)
        return MODEL_CACHE_PATH


def _find_model_path():
    for path in LOCAL_MODEL_PATHS:
        if path and os.path.exists(path):
            return path
    if MODEL_URL:
        return _download_model()
    raise RuntimeError(
        "Model file not found! "
        f"For local development: Ensure ../../image-segmentation/models/{MODEL_FILE} exists. "
        "For production: Set MODEL_DOWNLOAD_URL to download it from the GitHub release."
    )


def get_model():
    global _model
    with _model_lock:
        if _model is None:
            path = _find_model_path()
            print(f"Loading ONNX model from: {os.path.abspath(path)}", flush=True)
            from ultralytics import YOLO  # heavy: pulls in torch

            _model = YOLO(path, task="segment")
            print("Model loaded successfully.", flush=True)
        return _model


def _unload_when_idle():
    while True:
        time.sleep(30)
        with _model_lock:
            idle = time.monotonic() - _last_used
            if _model is not None and _in_flight == 0 and idle > IDLE_UNLOAD_SECONDS:
                print(f"Idle for {int(idle)}s, exiting worker to free the model's memory.", flush=True)
                os.kill(os.getpid(), signal.SIGTERM)
                return


if IDLE_UNLOAD_SECONDS > 0:
    threading.Thread(target=_unload_when_idle, daemon=True).start()

# Fetch the model in the background at startup, so the first photo after a
# deploy does not also wait for a 250 MB download.
if MODEL_URL and not any(p and os.path.exists(p) for p in LOCAL_MODEL_PATHS):
    threading.Thread(target=_download_model, daemon=True).start()


def _annotate(image, detections, model):
    import cv2
    import supervision as sv

    mask_annotator = sv.MaskAnnotator()
    label_annotator = sv.LabelAnnotator(
        text_position=sv.Position.BOTTOM_CENTER,
        text_scale=1,
        text_thickness=1,
    )

    labels = [
        f"{CLASS_NAME_TO_LABEL.get(model.names[class_id], model.names[class_id])} {confidence:.2f}"
        for class_id, confidence in zip(detections.class_id, detections.confidence)
    ]

    annotated_frame = image.copy()
    annotated_frame = mask_annotator.annotate(scene=annotated_frame, detections=detections)
    annotated_frame = label_annotator.annotate(scene=annotated_frame, detections=detections, labels=labels)

    # Encode annotated image to base64 JPEG
    _, buffer = cv2.imencode(".jpg", annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buffer).decode("utf-8")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/define", methods=["GET"])
def define():
    """A word's meanings from Kielitoimiston sanakirja (see ks_define.py).
    Has nothing to do with the model and never loads it."""
    word = (request.args.get("word") or "").strip().lower()
    if not ks_define.valid(word):
        return jsonify({"error": "Not a word."}), 400
    try:
        return jsonify(ks_define.define(word))
    except ks_define.Busy:
        return jsonify({"error": "The dictionary is busy. Try again in a minute."}), 503
    except ks_define.Unavailable as e:
        print(f"/define {word}: {e}", flush=True)
        return jsonify({"error": "Couldn't reach the dictionary."}), 502


@app.route("/warm", methods=["POST"])
def warm():
    """Start loading the model in the background, so it is ready by the time
    the photo arrives. The app calls this when it opens."""
    global _last_used
    with _model_lock:
        loaded = _model is not None
        _last_used = time.monotonic()
    if not loaded:
        threading.Thread(target=get_model, daemon=True).start()
    return jsonify({"loaded": loaded})


@app.route("/detect", methods=["POST"])
def detect():
    """
    Accepts a multipart image upload (field name: "image").
    Returns JSON with timing, thresholds, and detection results.
    """
    global _in_flight, _last_used
    with _model_lock:
        _in_flight += 1
    try:
        return _detect()
    finally:
        with _model_lock:
            _in_flight -= 1
            _last_used = time.monotonic()


def _detect():
    import cv2
    import numpy as np
    import supervision as sv

    total_start = time.time()
    
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files["image"]
    image_bytes = file.read()

    # ──── PREPROCESS ────
    preprocess_start = time.time()
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        return jsonify({"error": "Could not decode image"}), 400
    
    preprocess_time_ms = round((time.time() - preprocess_start) * 1000)

    # ──── INFERENCE ────
    model = get_model()
    inference_start = time.time()
    # ultralytics' own per-class NMS and its 0.25 floor run first; ours below
    # then merges across classes and applies the real threshold.
    results = model(image, conf=min(0.25, CONFIDENCE_THRESHOLD), max_det=300)
    detections = sv.Detections.from_ultralytics(results[0])
    inference_time_ms = round((time.time() - inference_start) * 1000)
    
    # Extract YOLO's internal timing from results
    yolo_speed = results[0].speed  # dict with keys: 'preprocess', 'inference', 'postprocess' (in ms)
    yolo_timing = {
        "preprocess_ms": round(yolo_speed['preprocess']),
        "inference_ms": round(yolo_speed['inference']),
        "postprocess_ms": round(yolo_speed['postprocess']),
    }

    # ──── POSTPROCESS ────
    postprocess_start = time.time()
    
    # Non-maximum suppression on the boxes, across classes. supervision's
    # with_nms() would compare the full-size masks instead, which took ~1.8 s
    # for a photo of 144 tiles; on the evaluation sets the boxes keep exactly
    # the same tiles.
    if len(detections):
        keep = sv.box_non_max_suppression(
            np.hstack([detections.xyxy, detections.confidence[:, None]]), NMS_THRESHOLD
        )
        detections = detections[keep]

    # Filter low-confidence detections
    if CONFIDENCE_THRESHOLD > 0:
        detections = detections[detections.confidence >= CONFIDENCE_THRESHOLD]

    # Extract detected letters
    letter_list = []
    letters = ""
    for class_id, confidence in zip(detections.class_id, detections.confidence):
        class_name = model.names[class_id]
        letter = CLASS_NAME_TO_LETTER.get(class_name, class_name)
        letter_list.append({"letter": letter, "confidence": round(float(confidence), 3)})
        letters += letter

    # Sort by confidence descending
    letter_list.sort(key=lambda x: x["confidence"], reverse=True)

    # Each tile's outline, so the client can draw its own overlay on the
    # photo. A tile is roughly a square at some angle, so its mask simplifies
    # to a handful of points; the box is the fallback when there is no mask.
    tiles = []
    for i, (class_id, confidence) in enumerate(zip(detections.class_id, detections.confidence)):
        x1, y1, x2, y2 = (round(float(v)) for v in detections.xyxy[i])
        polygon = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
        if detections.mask is not None:
            contours, _ = cv2.findContours(
                detections.mask[i].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if contours:
                # Tiles are convex, so the hull drops the notches a mask picks
                # up where tiles overlap, and a light simplification keeps
                # the rounded corners in ~8-16 points.
                c = cv2.convexHull(max(contours, key=cv2.contourArea))
                approx = cv2.approxPolyDP(c, 0.008 * cv2.arcLength(c, True), True)
                if len(approx) >= 3:
                    polygon = approx.reshape(-1, 2).tolist()
        class_name = model.names[class_id]
        tiles.append({
            "letter": CLASS_NAME_TO_LETTER.get(class_name, class_name),
            "confidence": round(float(confidence), 3),
            "box": [x1, y1, x2, y2],
            "polygon": polygon,
        })
    tiles.sort(key=lambda t: t["confidence"], reverse=True)

    # The server-drawn overlay is kept for API callers, but the app draws its
    # own from "tiles" and skips this with annotate=0.
    want_annotated = request.form.get("annotate", "1") != "0"

    # Create annotated image with segmentation masks and labels
    annotated_b64 = None
    if want_annotated:
        annotated_b64 = _annotate(image, detections, model)

    postprocess_time_ms = round((time.time() - postprocess_start) * 1000)
    total_time_ms = round((time.time() - total_start) * 1000)

    # Calculate statistics
    avg_confidence = round(sum(item["confidence"] for item in letter_list) / len(letter_list) * 100) if letter_list else 0

    return jsonify(
        {
            "letters": letters,
            "letter_list": letter_list,
            "annotated_image": annotated_b64,
            "tiles": tiles,
            "image_size": [int(image.shape[1]), int(image.shape[0])],
            "count": len(letter_list),
            "timing": {
                "preprocess_ms": preprocess_time_ms,
                "inference_ms": inference_time_ms,
                "postprocess_ms": postprocess_time_ms,
                "total_ms": total_time_ms,
            },
            "yolo_timing": yolo_timing,
            "avg_confidence": avg_confidence,
            "thresholds": {
                "nms": NMS_THRESHOLD,
                "confidence": CONFIDENCE_THRESHOLD,
            },
        }
    )


if __name__ == "__main__":
    print("Starting segmentation server on http://localhost:8081")
    app.run(host="0.0.0.0", port=8081, debug=False)
