import shutil

from ultralytics import YOLO

model = YOLO("models/yolo11x-seg-200epochs-100images.pt")

# 960, not the 640 it was trained at: tiles in a photo of the whole pool are too
# small at 640. The size is stored in the ONNX metadata, where the server reads it.
path = model.export(format="onnx", opset=21, imgsz=960)
shutil.move(path, "models/yolo11x-seg-200epochs-100images-960.onnx")
