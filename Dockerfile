# PartLens / ComponentTracker Production Dockerfile
FROM python:3.11-slim

# Prevent Python from writing .pyc files & enable unbuffered stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

# Install curl for container healthcheck and basic runtime libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pinned Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend application, frontend assets, and server entrypoint
COPY app/ ./app/
COPY frontend/ ./frontend/
COPY server.py .
COPY import_external_datasets.py .

# Create volume mount points with appropriate permissions
RUN mkdir -p /app/dataset/images/train /app/dataset/images/val \
             /app/dataset/labels/train /app/dataset/labels/val \
             /app/dataset/sidecars \
             /app/external_datasets \
             /app/config \
             /app/cache \
             /app/studies

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
