from ultralytics import YOLO

model = YOLO("models/yolo11x-seg-200epochs-100images.pt")

model.export(format="onnx", opset=21)