# Green Nigeria sandbox

This project runs as a local web app with a Python standard-library backend and SQLite sandbox history.

## Run locally

From this folder in PowerShell:

```powershell
py -3 server.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop the server with Ctrl+C. The server binds to loopback only; it is not configured for public hosting.

Sandbox API:

- `GET /api/health` identifies the service as sandbox-only and reports that live payments are disabled.
- `GET /api/transactions` returns locally stored simulated transactions.
- `POST /api/transfers` validates and records a simulated transfer. It never calls a bank or payment provider.

Transfer history is stored in `data/sandbox.sqlite3`. Account numbers are validated in memory but are not written to the database or returned in API responses. Use only fabricated test details.

## Test

```powershell
py -3 -m unittest discover -s tests -v
```

## Before any real-money launch

This code is not a live banking integration. Do not expose it to the public or use it for real customer data. A real launch needs a CBN-authorized bank or regulated partner, an approved production payment provider, provider-specific sandbox certification, server-side secrets management, authentication, authorization, idempotent payment processing, signed webhook verification, reconciliation, monitoring, and a compliance/security review. Production provider keys must never be placed in browser JavaScript or committed to source control.
