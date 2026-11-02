import argparse
from contextlib import closing
import json
import logging
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "data" / "sandbox.sqlite3"
MAX_REQUEST_BYTES = 8192
MAX_AMOUNT_NAIRA = Decimal("1000000000")
ALLOWED_BANKS = {
    "Access Bank",
    "First Bank of Nigeria",
    "Guaranty Trust Bank",
    "United Bank for Africa",
    "Zenith Bank",
    "Opay",
    "Moniepoint",
    "Other Nigerian bank",
}
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}
LOGGER = logging.getLogger("green-nigeria-sandbox")


def initialize_database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sandbox_transfers (
                reference TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                recipient_name TEXT NOT NULL,
                bank TEXT NOT NULL,
                amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
                created_at TEXT NOT NULL
            )
            """
        )
        connection.commit()


def transaction_response(row):
    reference, _, recipient_name, bank, amount_kobo, created_at = row
    return {
        "reference": reference,
        "name": recipient_name,
        "description": f"Sandbox transfer · {bank}",
        "timestamp": created_at,
        "amount": -(amount_kobo / 100),
        "icon": "↗",
        "kind": "outgoing",
        "status": "SIMULATED",
    }


class SandboxServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, database_path):
        super().__init__(address, SandboxRequestHandler)
        self.database_path = database_path


class SandboxRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "GreenNigeriaSandbox"
    sys_version = ""

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            LOGGER.debug("Client disconnected during request handling")

    def end_headers(self):
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' blob: data:; connect-src 'self' https://cdn.jsdelivr.net; "
            "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_bytes(self, status, content, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_bytes(status, content, "application/json; charset=utf-8")

    def send_error_json(self, status, message):
        self.send_json(status, {"error": message})

    def has_local_host_header(self):
        port = self.server.server_port
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host", "").lower() not in allowed_hosts:
            self.send_error_json(400, "Use the local sandbox address.")
            return False
        return True

    def do_GET(self):
        if not self.has_local_host_header():
            return
        path = urlsplit(self.path).path
        if path == "/api/health":
            self.send_json(
                200,
                {"mode": "sandbox", "livePaymentsEnabled": False},
            )
            return
        if path == "/api/transactions":
            try:
                with closing(sqlite3.connect(self.server.database_path)) as connection:
                    rows = connection.execute(
                        """
                        SELECT reference, idempotency_key, recipient_name, bank,
                               amount_kobo, created_at
                        FROM sandbox_transfers
                        ORDER BY created_at DESC
                        """
                    ).fetchall()
            except sqlite3.Error:
                LOGGER.exception("Could not read sandbox transaction history")
                self.send_error_json(503, "Sandbox transaction history is unavailable.")
                return
            self.send_json(200, {"transactions": [transaction_response(row) for row in rows]})
            return
        if path in STATIC_FILES:
            file_name, content_type = STATIC_FILES[path]
            try:
                content = (ROOT / file_name).read_bytes()
            except OSError:
                LOGGER.exception("Could not read application asset %s", file_name)
                self.send_error_json(500, "Application asset is unavailable.")
                return
            self.send_bytes(200, content, content_type)
            return
        self.send_error_json(404, "Not found.")

    def do_POST(self):
        if not self.has_local_host_header():
            return
        if urlsplit(self.path).path != "/api/transfers":
            self.send_error_json(404, "Not found.")
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self.send_error_json(415, "Content-Type must be application/json.")
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.send_error_json(411, "A valid Content-Length header is required.")
            return
        if content_length < 1 or content_length > MAX_REQUEST_BYTES:
            self.send_error_json(413, "Request body is empty or too large.")
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error_json(400, "Request body must be valid JSON.")
            return
        if not isinstance(payload, dict):
            self.send_error_json(400, "Request body must be a JSON object.")
            return

        recipient_name = payload.get("recipientName")
        bank = payload.get("bank")
        account_number = payload.get("accountNumber")
        raw_amount = payload.get("amount")
        idempotency_key = payload.get("idempotencyKey")

        if not isinstance(recipient_name, str) or not recipient_name.strip() or len(recipient_name.strip()) > 80:
            self.send_error_json(400, "Recipient name must be between 1 and 80 characters.")
            return
        if not isinstance(bank, str) or bank not in ALLOWED_BANKS:
            self.send_error_json(400, "Select a supported Nigerian bank.")
            return
        if not isinstance(account_number, str) or re.fullmatch(r"\d{10}", account_number) is None:
            self.send_error_json(400, "Account number must contain exactly 10 digits.")
            return
        if not isinstance(raw_amount, str):
            self.send_error_json(400, "Amount must be supplied as a decimal string.")
            return
        try:
            amount = Decimal(raw_amount)
        except InvalidOperation:
            self.send_error_json(400, "Enter a valid transfer amount.")
            return
        if (
            not amount.is_finite()
            or amount <= 0
            or amount > MAX_AMOUNT_NAIRA
            or amount.as_tuple().exponent < -2
        ):
            self.send_error_json(400, "Amount must be positive, no more than 2 decimal places, and at most ₦1,000,000,000.")
            return
        try:
            idempotency_key = str(uuid.UUID(idempotency_key))
        except (ValueError, TypeError, AttributeError):
            self.send_error_json(400, "A valid idempotency key is required.")
            return

        amount_kobo = int(amount * 100)
        reference = f"GN-SBX-{uuid.uuid4().hex[:16].upper()}"
        created_at = datetime.now(timezone.utc).isoformat()
        try:
            with closing(sqlite3.connect(self.server.database_path)) as connection:
                connection.execute("BEGIN IMMEDIATE")
                existing = connection.execute(
                    """
                    SELECT reference, idempotency_key, recipient_name, bank,
                           amount_kobo, created_at
                    FROM sandbox_transfers
                    WHERE idempotency_key = ?
                    """,
                    (idempotency_key,),
                ).fetchone()
                if existing is not None:
                    self.send_json(200, transaction_response(existing))
                    return
                connection.execute(
                    """
                    INSERT INTO sandbox_transfers
                        (reference, idempotency_key, recipient_name, bank, amount_kobo, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (reference, idempotency_key, recipient_name.strip(), bank, amount_kobo, created_at),
                )
                row = connection.execute(
                    """
                    SELECT reference, idempotency_key, recipient_name, bank,
                           amount_kobo, created_at
                    FROM sandbox_transfers
                    WHERE reference = ?
                    """,
                    (reference,),
                ).fetchone()
                connection.commit()
        except sqlite3.Error:
            LOGGER.exception("Could not record sandbox transfer")
            self.send_error_json(503, "Sandbox could not record this transfer.")
            return
        self.send_json(201, transaction_response(row))

    def log_message(self, format_string, *args):
        LOGGER.info("%s - %s", self.address_string(), format_string % args)


def main():
    parser = argparse.ArgumentParser(description="Run the local Green Nigeria sandbox app.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    initialize_database(DATABASE)
    server = SandboxServer(("127.0.0.1", args.port), DATABASE)
    LOGGER.warning(
        "Sandbox only; listening on http://127.0.0.1:%s. No real payments are enabled.",
        args.port,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Stopping sandbox server")
    finally:
        server.server_close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    main()
