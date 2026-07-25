# Dockerfile for VisionMate Production Application

FROM python:3.11-slim AS builder

WORKDIR /app

# Install system dependencies required for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local
COPY . /app

# Create non-root user for security
RUN useradd -m visionuser && chown -R visionuser:visionuser /app
USER visionuser

EXPOSE 5000

ENV VISIONMATE_ENV=production
ENV PORT=5000

CMD ["gunicorn", "--config", "gunicorn.conf.py", "wsgi:app"]
