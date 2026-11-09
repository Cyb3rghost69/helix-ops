# HELIX/OPS — RAGNAR SHIELD scanner for Unraid.
# Build from the repo root:  docker build -f unraid/helix-shield/Dockerfile -t helix-shield:latest .
FROM python:3.12-alpine
RUN adduser -D -H -u 10001 shield && mkdir -p /data && chown shield /data
WORKDIR /app
COPY helix_shield.py /app/helix_shield.py
USER shield
ENV SHIELD_DATA=/data SHIELD_PORT=8791 SHIELD_SCOPE=192.168.1.0/24 SHIELD_INTERVAL_H=6 PYTHONUNBUFFERED=1
EXPOSE 8791
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8791/health || exit 1
CMD ["python3", "-I", "/app/helix_shield.py", "serve"]
