import functools
import http.client
import importlib.util
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer


root = Path(__file__).resolve().parents[1]
module_spec = importlib.util.spec_from_file_location('hurricanemap_serve', root / 'serve.py')
serve = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(serve)

server = ThreadingHTTPServer(
    ('127.0.0.1', 0),
    functools.partial(serve.HurricaneMapHandler, directory=str(root)),
)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()


def fetch(path):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        response.read()
        return response
    finally:
        connection.close()


try:
    primary = fetch('/')
    csp = primary.getheader('Content-Security-Policy') or ''
    assert primary.status == 200
    assert "form-action 'none'" in csp
    assert "frame-ancestors 'self'" in csp
    assert 'https://www.fema.gov' in csp
    assert primary.getheader('Cache-Control') == 'no-cache'
    assert primary.getheader('X-Content-Type-Options') == 'nosniff'
    assert primary.getheader('Referrer-Policy') == 'strict-origin-when-cross-origin'

    globe = fetch('/globe.html')
    assert globe.status == 200
    assert globe.getheader('Content-Security-Policy') is None
    assert globe.getheader('Cache-Control') == 'no-cache'

    data = fetch('/data/metadata.json')
    assert data.status == 200
    assert data.getheader('Content-Security-Policy') is None
    assert data.getheader('Cache-Control') == 'no-cache'
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)

print('static server security headers ok (primary CSP, non-primary isolation, hardening headers)')
