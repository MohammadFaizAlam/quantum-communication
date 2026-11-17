"""FastAPI / Python stdlib application entrypoint.

Can be launched via:
  - uvicorn app.main:app --port 8123   (when FastAPI/Uvicorn are installed)
  - python3 -m app.main --port 8123    (pure Python stdlib HTTP server)
  - python3 -m app.main --stdio        (persistent JSON-over-stdio worker)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .api.routes import ValidationError, health, router, simulate, validate_simulate_payload

_raw_origins = os.environ.get("CORS_ORIGINS", "*").strip()
_origins = ["*"] if _raw_origins == "*" else [o.strip() for o in _raw_origins.split(",") if o.strip()]


def handle_api_call(method: str, path: str, body: Any = None) -> tuple[int, dict[str, Any]]:
    """Pure-Python request dispatcher for GET /api/health and POST /api/simulate."""
    clean_path = path.split("?", 1)[0].rstrip("/")
    if method.upper() == "GET" and clean_path == "/api/health":
        return 200, health()
    if method.upper() == "POST" and clean_path == "/api/simulate":
        try:
            validated = validate_simulate_payload(body if body is not None else {})
            result = simulate(validated)
            return 200, result
        except ValidationError as exc:
            return 422, {"detail": str(exc)}
        except Exception as exc:  # pragma: no cover
            return 500, {"detail": str(exc)}
    return 404, {"detail": f"Not found: {method} {clean_path}"}


try:
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    app = FastAPI(
        title="BB84 Quantum Secure Communication API",
        description=(
            "Educational simulation of the BB84 quantum key distribution "
            "protocol, including intercept-resend eavesdropping, channel noise, "
            "sifting, QBER parameter estimation and a gated one-time-pad "
            "encryption stage. Software simulation of idealized polarization "
            "states -- not real quantum hardware."
        ),
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    if router is not None:
        app.include_router(router)

except ImportError:

    class _StdlibApp:
        """Lightweight app wrapper when FastAPI is not installed in the container."""

        title = "BB84 Quantum Secure Communication API"
        version = "1.0.0"

        def dispatch(self, method: str, path: str, body: Any = None) -> tuple[int, dict[str, Any]]:
            return handle_api_call(method, path, body)

    app = _StdlibApp()  # type: ignore[assignment]


class _BB84RequestHandler(BaseHTTPRequestHandler):
    """Stdlib HTTP request handler serving /api/health and /api/simulate."""

    def _send_cors_headers(self) -> None:
        origin = _origins[0] if _origins else "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")

    def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        status, payload = handle_api_call("GET", self.path)
        self._write_json(status, payload)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            parsed = json.loads(raw_body) if raw_body.strip() else {}
        except json.JSONDecodeError:
            self._write_json(422, {"detail": "Invalid JSON in request body."})
            return
        status, payload = handle_api_call("POST", self.path, parsed)
        self._write_json(status, payload)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


def run_stdio_worker() -> None:
    """Persistent line-delimited JSON RPC loop over stdin/stdout."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            msg = json.loads(line)
            req_id = msg.get("id")
            method = msg.get("method", "POST")
            path = msg.get("path", "/api/simulate")
            body = msg.get("body", {})
            status, payload = handle_api_call(method, path, body)
            out = {"id": req_id, "status": status, "body": payload}
        except Exception as exc:
            out = {"id": req_id, "status": 500, "body": {"detail": str(exc)}}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


def run_http_server(host: str = "127.0.0.1", port: int = 8123) -> None:
    """Start the multi-threaded Python HTTP server on host:port."""
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((host, port), _BB84RequestHandler)
    sys.stdout.write(f"BB84 Python backend listening on http://{host}:{port}\n")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BB84 Python Backend Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8123")))
    parser.add_argument("--stdio", action="store_true", help="Run persistent stdio JSON worker")
    args = parser.parse_args()
    if args.stdio:
        run_stdio_worker()
    else:
        run_http_server(args.host, args.port)

