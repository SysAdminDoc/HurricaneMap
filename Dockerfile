FROM python:3.12-alpine

LABEL org.opencontainers.image.title="HurricaneMap"
LABEL org.opencontainers.image.description="Static NOAA HURDAT2 hurricane landfall map served by a CSP-aware Python static server"
LABEL org.opencontainers.image.source="https://github.com/SysAdminDoc/HurricaneMap"
LABEL org.opencontainers.image.vendor="HurricaneMap full/core distribution compatible"

ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN addgroup -S hurricanemap \
  && adduser -S -G hurricanemap hurricanemap

COPY --chown=hurricanemap:hurricanemap . /app

USER hurricanemap

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/data/metadata.json', timeout=2).read(1)"

CMD ["python", "serve.py", "--port", "8080", "--bind", "0.0.0.0", "--directory", "/app"]
