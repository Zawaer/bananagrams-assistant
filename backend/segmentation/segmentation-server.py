import base64
import os

import cv2
import numpy as np
import supervision as sv
from flask import Flask, jsonify, request
from flask_cors import CORS
from ultralytics import YOLO

app = Flask(__name__)
CORS(app)

# Detection thresholds
NMS_THRESHOLD = 0.8
CONFIDENCE_THRESHOLD = 0.8

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

# Load ONNX model at startup
MODEL_PATH = "../../image-segmentation/models/yolo11x-seg-200epochs-100images.onnx"
print(f"Loading ONNX model from: {os.path.abspath(MODEL_PATH)}")
model = YOLO(MODEL_PATH, task="segment")
print("Model loaded successfully.")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/detect", methods=["POST"])
def detect():
    """
    Accepts a multipart image upload (field name: "image").
    Returns JSON with timing, thresholds, and detection results.
    """
    import time
    
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
    inference_start = time.time()
    results = model(image)
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
    
    # Apply Non-Maximum Suppression
    detections = detections.with_nms(threshold=NMS_THRESHOLD)

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

    # Create annotated image with segmentation masks and labels
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
    annotated_b64 = base64.b64encode(buffer).decode("utf-8")
    
    postprocess_time_ms = round((time.time() - postprocess_start) * 1000)
    total_time_ms = round((time.time() - total_start) * 1000)

    # Calculate statistics
    avg_confidence = round(sum(item["confidence"] for item in letter_list) / len(letter_list) * 100) if letter_list else 0

    return jsonify(
        {
            "letters": letters,
            "letter_list": letter_list,
            "annotated_image": annotated_b64,
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
