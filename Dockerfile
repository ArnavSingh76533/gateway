# Hugging Face Docker Space: one public port, rootless process, Next.js static export.
FROM node:24-bookworm-slim AS frontend
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS backend-deps
WORKDIR /build
COPY backend/requirements.lock ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.lock

FROM python:3.12-slim-bookworm
# Embedded services are used only when external DATABASE_URL / REDIS_URL are absent.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-15 redis-server tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 gateway \
    && mkdir -p /data /app && chown -R gateway:gateway /data /app
COPY --from=backend-deps /install /usr/local
WORKDIR /app
COPY --chown=gateway:gateway backend ./backend
COPY --chown=gateway:gateway scripts ./scripts
COPY --chown=gateway:gateway deploy ./deploy
COPY --from=frontend --chown=gateway:gateway /build/out ./frontend/out
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app/backend \
    STATIC_DIR=/app/frontend/out PORT=7860 DATA_DIR=/data PG_BIN=/usr/lib/postgresql/15/bin
USER gateway
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','7860')+'/health/ready',timeout=4)"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "deploy/start.py"]
