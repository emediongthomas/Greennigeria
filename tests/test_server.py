import json
import sqlite3
from contextlib import closing
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from server import SandboxServer, initialize_database


class SandboxApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "sandbox.sqlite3"
        initialize_database(self.database_path)
        self.server = SandboxServer(("127.0.0.1", 0), self.database_path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary_directory.cleanup()

    def request_json(self, path, method="GET", payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def valid_payload(self):
        return {
            "recipientName": "Sandbox Recipient",
            "bank": "Access Bank",
            "accountNumber": "0123456789",
            "amount": "1250.50",
            "idempotencyKey": "7eb4a66b-b568-473b-b72e-4e963d18000b",
        }

    def test_health_is_explicitly_sandbox_only(self):
        status, response = self.request_json("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(response, {"mode": "sandbox", "livePaymentsEnabled": False})

    def test_transfer_persists_without_account_number(self):
        status, response = self.request_json("/api/transfers", "POST", self.valid_payload())
        self.assertEqual(status, 201)
        self.assertEqual(response["status"], "SIMULATED")
        self.assertEqual(response["amount"], -1250.5)
        self.assertNotIn("accountNumber", response)
        self.assertNotIn("account_number", response)

        with closing(sqlite3.connect(self.database_path)) as connection:
            columns = {
                row[1] for row in connection.execute("PRAGMA table_info(sandbox_transfers)")
            }
            row_count = connection.execute("SELECT COUNT(*) FROM sandbox_transfers").fetchone()[0]
        self.assertNotIn("account_number", columns)
        self.assertNotIn("accountNumber", columns)
        self.assertEqual(row_count, 1)

    def test_retry_with_same_idempotency_key_does_not_duplicate(self):
        payload = self.valid_payload()
        first_status, first = self.request_json("/api/transfers", "POST", payload)
        second_status, second = self.request_json("/api/transfers", "POST", payload)
        self.assertEqual(first_status, 201)
        self.assertEqual(second_status, 200)
        self.assertEqual(first["reference"], second["reference"])
        with closing(sqlite3.connect(self.database_path)) as connection:
            row_count = connection.execute("SELECT COUNT(*) FROM sandbox_transfers").fetchone()[0]
        self.assertEqual(row_count, 1)

    def test_invalid_account_and_amount_are_rejected(self):
        payload = self.valid_payload()
        payload["accountNumber"] = "1234"
        status, response = self.request_json("/api/transfers", "POST", payload)
        self.assertEqual(status, 400)
        self.assertIn("10 digits", response["error"])

        payload = self.valid_payload()
        payload["amount"] = "1.001"
        status, response = self.request_json("/api/transfers", "POST", payload)
        self.assertEqual(status, 400)
        self.assertIn("2 decimal places", response["error"])

    def test_only_app_assets_are_served(self):
        status, response = self.request_json("/api/health")
        self.assertEqual(status, 200)
        request = urllib.request.urlopen(self.base_url + "/")
        with request as page:
            self.assertIn(b"Green Nigeria", page.read())
            self.assertEqual(page.headers["X-Content-Type-Options"], "nosniff")
        status, response = self.request_json("/../../server.py")
        self.assertEqual(status, 404)
        self.assertEqual(response["error"], "Not found.")


if __name__ == "__main__":
    unittest.main()
