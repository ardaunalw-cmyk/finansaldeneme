# ==============================================================================
# UTL FİNANS - Production Multi-Stage Container Dockerfile
# ==============================================================================
# Role: Senior FinTech Systems Architect & DevOps Engineer
# Standards: OWASP Docker Top 10 (Non-root user, minimal attack surface, reproducible build)
#
# ARCHITECTURAL BOTTLENECK ANALYSIS:
# ------------------------------------------------------------------------------
# 1. BOTTLENECK: Python GIL Event Loop Contention in Single-Process Mode
#    - Risk: Running a single uvicorn worker causes CPU-bound quantitative calculations
#      (DuPont, Altman Z, Swiss Risk Parity) to block asynchronous WebSocket I/O.
#    - Mitigation: Production multi-worker execution managed by Gunicorn using
#      UvicornWorker (`-k uvicorn.workers.UvicornWorker -w 4`), binding multiple
#      OS processes to distribute calculation loads across multi-core CPUs.
#
# 2. BOTTLENECK: Image Bloat & Security Vulnerabilities from Build Tools in Production
#    - Risk: Including gcc, build-essential, and git in the production image increases
#      container size (>1GB) and expands attack vectors.
#    - Mitigation: Multi-stage build isolating compilation tools into the builder stage,
#      yielding a lean ~180MB runtime image running as unprivileged user 'appuser'.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build & Wheel Compilation Stage
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install dependencies into wheel directory
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --user -r requirements.txt


# ------------------------------------------------------------------------------
# Stage 2: Hardened Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM python:3.12-slim AS runner

WORKDIR /app

ENV PATH=/home/appuser/.local/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    ENVIRONMENT=production

# Install only essential runtime C libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged non-root user (OWASP Standard)
RUN groupadd -g 10001 appgroup && \
    useradd -u 10001 -g appgroup -m -s /bin/bash appuser

# Copy installed wheels from builder
COPY --from=builder /root/.local /home/appuser/.local

# Copy application source code
COPY --chown=appuser:appgroup . /app

# Create logs directory with correct permissions
RUN mkdir -p /app/logs && chown -R appuser:appgroup /app/logs

USER appuser

EXPOSE 8000

# Docker Healthcheck targeting the application health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Production Start Command: Gunicorn with Uvicorn Workers
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", "--limit-concurrency", "1000", "--backlog", "2048"]
