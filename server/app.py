"""
Vivaha AI — backend (Render web service).

Hides the Gemini API key and reads the live Google Sheet server-side, so the
GitHub Pages frontend needs no credentials from visitors.

Environment variables (set in Render):
  GEMINI_API_KEY   (secret)  — Google Gemini API key
  VENDOR_SHEET_URL (public)  — Google Sheet share URL or raw sheet ID
  ALLOWED_ORIGINS  (optional) — comma-separated origins or "*" (default "*")
"""

import csv
import io
import json
import os
import re
import urllib.request
import urllib.error
from datetime import datetime, timezone

from flask import Flask, request, jsonify

app = Flask(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
VENDOR_SHEET_URL = os.environ.get("VENDOR_SHEET_URL", "")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]


def extract_sheet_id(value):
    """Extract a Google Sheet ID from a share URL or a raw ID."""
    if not value:
        return None
    value = str(value).strip()
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", value)
    if m:
        return m.group(1)
    if re.fullmatch(r"[a-zA-Z0-9-_]{20,}", value):
        return value
    return None


@app.after_request
def add_cors(resp):
    origin = request.headers.get("Origin", "")
    if "*" in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = "*"
    elif origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/", methods=["GET"])
def health():
    return jsonify(status="ok", service="vivaha-ai-backend",
                   time=datetime.now(timezone.utc).isoformat())


@app.route("/api/vendors", methods=["GET"])
def vendors():
    """Read the public Google Sheet live (no caching) and return its rows."""
    sheet_id = extract_sheet_id(VENDOR_SHEET_URL)
    if not sheet_id:
        return jsonify(error="VENDOR_SHEET_URL is not configured on the server."), 500

    # Live query to Google Sheets at request time — nothing is cached or hardcoded.
    url = "https://docs.google.com/spreadsheets/d/%s/gviz/tq?tqx=out:csv" % sheet_id
    req = urllib.request.Request(url, headers={"User-Agent": "Vivaha-AI/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            text = r.read().decode("utf-8-sig")
    except urllib.error.HTTPError as e:
        return jsonify(error="Google Sheets returned HTTP %s. Is the sheet shared as 'Anyone with the link — Viewer'?" % e.code), 502
    except Exception as e:  # noqa: BLE001
        return jsonify(error="Could not fetch Google Sheet: %s" % e), 502

    rows = list(csv.DictReader(io.StringIO(text)))
    category = (request.args.get("category") or "").strip().lower()
    city = (request.args.get("city") or "").strip().lower()
    if category:
        rows = [r for r in rows if category in (r.get("category") or "").lower()]
    if city:
        rows = [r for r in rows if city in (r.get("city") or "").lower()]

    return jsonify(rows=rows, total=len(rows),
                   fetchedAt=datetime.now(timezone.utc).isoformat())


@app.route("/api/generate", methods=["POST"])
def generate():
    """Proxy a Gemini generateContent request, injecting the server-side key."""
    if not GEMINI_API_KEY:
        return jsonify(error="GEMINI_API_KEY is not configured on the server."), 500

    data = request.get_json(force=True, silent=True) or {}
    model = (data.get("model") or "gemini-flash-latest")

    payload = {}
    for field in ("systemInstruction", "contents", "tools", "generationConfig"):
        if data.get(field):
            payload[field] = data[field]

    url = "%s/models/%s:generateContent?key=%s" % (GEMINI_BASE, model, GEMINI_API_KEY)
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return jsonify(json.loads(r.read().decode()))
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            detail = {}
        message = detail.get("error", {}).get("message", "Gemini returned HTTP %s" % e.code)
        return jsonify(error=message, status=e.code), e.code
    except Exception as e:  # noqa: BLE001
        return jsonify(error="Backend error: %s" % e), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))
