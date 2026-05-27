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
            previous_asset_env = self._configure_asset_request_context()
            try:
                self._send_svg(200, build_svg(payload))
            finally:
                self._restore_asset_request_context(previous_asset_env)
        except Exception as error:
            self._send_text(500, str(error))

    def _configure_asset_request_context(self):
        env_keys = [
            "THANKFULFORYOU_ASSET_BASE_URL",
            "THANKFULFORYOU_ASSET_REQUEST_COOKIE",
            "THANKFULFORYOU_ASSET_PROTECTION_BYPASS",
        ]
        previous = {key: os.environ.get(key) for key in env_keys}
        forwarded_proto = self.headers.get("x-forwarded-proto", "https").split(",")[0].strip()
        forwarded_host = self.headers.get("x-forwarded-host", "").split(",")[0].strip()
        host = forwarded_host or self.headers.get("host", "").strip()
        if host:
            os.environ["THANKFULFORYOU_ASSET_BASE_URL"] = f"{forwarded_proto or 'https'}://{host}"
        cookie = self.headers.get("cookie", "").strip()
        if cookie:
            os.environ["THANKFULFORYOU_ASSET_REQUEST_COOKIE"] = cookie
        else:
            os.environ.pop("THANKFULFORYOU_ASSET_REQUEST_COOKIE", None)
        protection_bypass = self.headers.get("x-vercel-protection-bypass", "").strip()
        if protection_bypass:
            os.environ["THANKFULFORYOU_ASSET_PROTECTION_BYPASS"] = protection_bypass
        else:
            os.environ.pop("THANKFULFORYOU_ASSET_PROTECTION_BYPASS", None)
        return previous

    def _restore_asset_request_context(self, previous):
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

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
