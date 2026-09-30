# Small image: Python + Tesseract (CPU) + English language data only.
FROM python:3.11-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*
# Add more languages later with e.g. tesseract-ocr-ara and OCR_LANGS=eng+ara
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV OMP_THREAD_LIMIT=1 MALLOC_ARENA_MAX=2 OCR_LANGS=eng OCR_MAX_CONCURRENCY=1
# PORT is injected by Render at runtime; default 8001 for local Docker runs.
ENV PORT=8001
# Shell form so $PORT is expanded at container start by the shell.
# One worker process on purpose: memory stays at "one page + one Tesseract".
CMD uvicorn app.main:app_factory --factory --host 0.0.0.0 --port $PORT --workers 1
