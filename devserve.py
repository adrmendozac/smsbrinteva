#!/usr/bin/env python3
"""
Local debug server for the admin UI.

Serves the built SPA from public/ and proxies /api/* to production, so the page
runs against real campaigns and the real PIN instead of an empty shell.

    python3 devserve.py [port]      ->  http://localhost:8080/admin/
"""
import sys
import os
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
UPSTREAM = "https://sms.brintevaworlds.com"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def end_headers(self):
        # Never let a rebuild be masked by a cached index.html or a 304.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # Drop validators so the browser cannot revalidate into a 304.
        if keyword.lower() in ("last-modified", "etag"):
            return
        super().send_header(keyword, value)

    def _proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=self.command)
        for h in ("Content-Type", "Authorization"):
            if self.headers.get(h):
                req.add_header(h, self.headers[h])

        try:
            with urllib.request.urlopen(req) as res:
                payload, status, ctype = res.read(), res.status, res.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            payload, status, ctype = e.read(), e.code, e.headers.get("Content-Type", "application/json")
        except Exception as e:
            payload, status, ctype = str(e).encode(), 502, "text/plain"

        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._proxy()
        # SPA fallback: deep links under /admin return the app shell.
        path = self.path.split("?")[0]
        if path.startswith("/admin") and "." not in os.path.basename(path):
            self.path = "/admin/index.html"
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._proxy()
        self.send_error(405)


if __name__ == "__main__":
    os.chdir(ROOT)
    print(f"serving {ROOT} on http://localhost:{PORT}/admin/")
    print(f"proxying /api/* -> {UPSTREAM}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
