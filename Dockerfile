FROM python:3.12-alpine

LABEL org.opencontainers.image.title="HurricaneMap"
LABEL org.opencontainers.image.description="Static NOAA HURDAT2 hurricane landfall map served by Python http.server"
LABEL org.opencontainers.image.source="https://github.com/SysAdminDoc/HurricaneMap"

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY . /app

RUN addgroup -S hurricanemap \
  && adduser -S -G hurricanemap hurricanemap \
  && chown -R hurricanemap:hurricanemap /app

USER hurricanemap

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/data/metadata.json', timeout=2).read(1)"

CMD ["python", "-m", "http.server", "8080", "--bind", "0.0.0.0", "--directory", "/app"]
