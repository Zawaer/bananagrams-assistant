"""Fine-tune the released .pt on the full-resolution photos (train split; valid for
validation; test is never seen). Rotation over the full circle, no flips (letters
must not mirror), a wide scale range so tiles of any size in the frame look familiar.

usage: train.py NAME [imgsz=960] [epochs=120] [batch=4] [scale=0.75]
Needs build_hires_dataset.py first. Runs go to $DETTOOLS/runs/NAME.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from core import WORK  # noqa: E402
from ultralytics import YOLO  # noqa: E402

name = sys.argv[1]
imgsz = int(sys.argv[2]) if len(sys.argv) > 2 else 960
epochs = int(sys.argv[3]) if len(sys.argv) > 3 else 120
batch = int(sys.argv[4]) if len(sys.argv) > 4 else 4
scale = float(sys.argv[5]) if len(sys.argv) > 5 else 0.75

model = YOLO(f"{WORK}/models/yolo11x-seg-200epochs-100images.pt")
model.train(
    data=f"{WORK}/data/hires1600/data.yaml",
    # workers=0: the container's /dev/shm is 64 MB, and dataloader workers
    # deadlock passing batches through it.
    imgsz=imgsz, epochs=epochs, batch=batch, workers=0, device=0,
    project=f"{WORK}/runs", name=name, exist_ok=True,
    patience=40, cos_lr=True, close_mosaic=15,
    degrees=180, fliplr=0.0, flipud=0.0, scale=scale, translate=0.1,
    mosaic=1.0, mixup=0.0, copy_paste=0.0,
    hsv_h=0.015, hsv_s=0.6, hsv_v=0.5,
    plots=True, verbose=False,
)
