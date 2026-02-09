# Bananagrams Assistant

A tool to assist with Bananagrams gameplay using computer vision and word solving algorithms.

## Project Structure

- **backend/** - C++ server with word-solving engine
  - `server/` - Main solver implementation
  - `wordlist-parser/` - Finnish word list processing

- **frontend/** - Next.js web application interface

- **image-segmentation/** - YOLO-based tile detection and recognition
  - Trained model for detecting Bananagrams tiles
  - ONNX export for deployment

## Getting Started

### Backend
Navigate to `backend/server/` and build with CMake.

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Image Segmentation
```bash
cd image-segmentation
python detect.py
```
