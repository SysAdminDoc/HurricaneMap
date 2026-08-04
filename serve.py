from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org "
    "https://tiles.arcgis.com https://cdn.star.nesdis.noaa.gov https://mesonet.agron.iastate.edu "
    "https://pae-paha.pacioos.hawaii.edu; connect-src 'self' https://api.weather.gov "
    "https://api.tidesandcurrents.noaa.gov https://mapservices.weather.noaa.gov "
    "https://pae-paha.pacioos.hawaii.edu https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org "
    "https://tiles.arcgis.com https://services9.arcgis.com https://services.arcgis.com "
    "https://geocode.arcgis.com https://cdn.star.nesdis.noaa.gov https://mesonet.agron.iastate.edu "
    "https://www.nhc.noaa.gov https://corsproxy.io; font-src 'self'; worker-src 'self' blob:; "
    "frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self';"
)


class HurricaneMapHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        path = urlsplit(self.path).path
        if path == '/' or path.endswith('/index.html'):
            self.send_header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        super().end_headers()


def main():
    parser = ArgumentParser(description='Serve HurricaneMap with document security headers.')
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--directory', default='.')
    args = parser.parse_args()

    handler = partial(HurricaneMapHandler, directory=args.directory)
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f'Serving HurricaneMap from {args.directory} on {args.bind}:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
