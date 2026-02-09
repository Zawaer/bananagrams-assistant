from ultralytics import YOLO
import supervision as sv
import cv2

model = YOLO("models/yolo11x-seg-200epochs-100images.pt")

file_name = "test3.jpg"

results = model(file_name)

detections = sv.Detections.from_ultralytics(results[0])

# Apply Non-Maximum Suppression to remove overlapping detections
detections = detections.with_nms(threshold=0.8)

# Filter out detections with confidence under 0.8
detections = detections[detections.confidence >= 0.8]

print(results[0])

# Create annotators for segmentation visualization
mask_annotator = sv.MaskAnnotator()
box_annotator = sv.BoxAnnotator()
label_annotator = sv.LabelAnnotator(text_position=sv.Position.BOTTOM_CENTER, text_scale=1, text_thickness=1)

# Generate labels with confidence scores
labels = [
    f"{model.names[class_id]} {confidence:.2f}"
    for class_id, confidence in zip(detections.class_id, detections.confidence)
]

# Apply annotations in layers: masks -> boxes -> labels
annotated_frame = cv2.imread(file_name)
annotated_frame = mask_annotator.annotate(scene=annotated_frame, detections=detections)
#annotated_frame = box_annotator.annotate(scene=annotated_frame, detections=detections)
annotated_frame = label_annotator.annotate(scene=annotated_frame, detections=detections, labels=labels)

# Save the annotated image to disk
output_filename = "test_annotated.jpg"
cv2.imwrite(output_filename, annotated_frame)
print(f"Saved annotated image to {output_filename}")
