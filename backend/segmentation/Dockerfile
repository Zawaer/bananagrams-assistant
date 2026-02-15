# Use Python base image
FROM python:3.11-slim

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY segmentation-server.py .

# Expose port
EXPOSE 8081

# Run the server with 1 worker + preload to minimize memory usage
CMD ["gunicorn", "--bind", "0.0.0.0:8081", "--workers", "1", "--timeout", "120", "--preload", "segmentation-server:app"]
