import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.export_svg import build_svg


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            self._configure_asset_base_url()
            self._send_svg(200, build_svg(payload))
        except Exception as error:
            self._send_text(500, str(error))

    def _configure_asset_base_url(self):
        forwarded_proto = self.headers.get("x-forwarded-proto", "https").split(",")[0].strip()
        forwarded_host = self.headers.get("x-forwarded-host", "").split(",")[0].strip()
        host = forwarded_host or self.headers.get("host", "").strip()
        if host:
            os.environ["THANKFULFORYOU_ASSET_BASE_URL"] = f"{forwarded_proto or 'https'}://{host}"

    def _send_svg(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
        self.send_header("Content-Disposition", 'attachment; filename="badge-reel-layout.svg"')
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def _send_text(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))
