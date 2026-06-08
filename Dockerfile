# ── Python application image ─────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (layer cache)
COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY server/ ./server/
COPY static/ ./static/

# Non-root user
RUN useradd -m resonance
USER resonance

EXPOSE 8000

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
