"""
Iteration 5 tests:
- GET /api/onedrive/files/{item_id}/sheets/{sheet_name}/preview auth guard
- PATCH /api/maps/{id} accepts and persists '__EMPTY__' sentinel in status_visible_values
- Code inspection: map_data response includes status_has_empty (verified via source check)
"""
import os
import re
import uuid
import requests
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/backend/.env"))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    db = c[DB_NAME]
    yield db
    c.close()


@pytest.fixture(scope="module")
def session_e(mongo):
    session_id = f"TEST_sess_E_{uuid.uuid4().hex}"
    user_id = f"TEST_user_E_{uuid.uuid4().hex}"
    mongo.sessions.insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "display_name": "TEST E",
        "email": "test_e@example.com",
        "access_token": "TEST_access",
        "refresh_token": "TEST_refresh",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    yield {"session_id": session_id, "user_id": user_id}
    mongo.sessions.delete_many({"session_id": session_id})
    mongo.maps.delete_many({"user_id": user_id})


def _headers(s):
    return {"Content-Type": "application/json", "x-session-id": s["session_id"]}


def _create_map(session, **overrides):
    payload = {
        "name": "TEST_iter5_map",
        "file_id": "fake_file",
        "file_name": "TEST.xlsx",
        "sheet_name": "Sheet1",
        "lat_column": "Lat",
        "lng_column": "Lng",
        "visible_columns": ["Name"],
    }
    payload.update(overrides)
    r = requests.post(f"{API}/maps", json=payload, headers=_headers(session), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- Sheet preview endpoint auth guard ----------------

class TestSheetPreviewAuth:
    """Only the auth guard is testable without a real MS Graph token."""

    def test_preview_missing_session_returns_401(self):
        r = requests.get(
            f"{API}/onedrive/files/fake_item/sheets/Sheet1/preview",
            headers={"x-session-id": ""},
            timeout=10,
        )
        assert r.status_code == 401

    def test_preview_missing_header_returns_422(self):
        # Header is required by FastAPI -> 422 when omitted entirely
        r = requests.get(
            f"{API}/onedrive/files/fake_item/sheets/Sheet1/preview",
            timeout=10,
        )
        assert r.status_code in (401, 422)

    def test_preview_invalid_session_returns_401(self):
        r = requests.get(
            f"{API}/onedrive/files/fake_item/sheets/Sheet1/preview",
            headers={"x-session-id": "does_not_exist_" + uuid.uuid4().hex},
            timeout=10,
        )
        assert r.status_code == 401

    def test_preview_accepts_query_params(self, session_e):
        """With a valid session but a fake token, Graph call will 401 and refresh
        will also fail. Auth-guard 401 would say 'Missing/Invalid session' — we
        assert the failure is NOT from the auth guard by checking the detail."""
        r = requests.get(
            f"{API}/onedrive/files/fake_item/sheets/Sheet1/preview",
            params={"max_rows": 10, "max_cols": 15},
            headers=_headers(session_e),
            timeout=30,
        )
        # Session guard passed (422 would mean query param validation failure)
        assert r.status_code != 422, r.text
        assert r.status_code >= 400
        # If 401, must be from Graph/refresh, not the auth guard
        if r.status_code == 401:
            detail = r.json().get("detail", "")
            assert "Missing session" not in detail and "Invalid session" not in detail, \
                f"auth guard rejected valid session: {detail}"


# ---------------- __EMPTY__ sentinel persistence ----------------

class TestEmptyStatusSentinel:

    def test_create_map_with_empty_sentinel(self, session_e, mongo):
        body = _create_map(
            session_e,
            name="TEST_empty_create",
            status_column="Estado",
            status_visible_values=["Activo", "__EMPTY__"],
        )
        assert body["status_visible_values"] == ["Activo", "__EMPTY__"]
        doc = mongo.maps.find_one({"id": body["id"]})
        assert doc["status_visible_values"] == ["Activo", "__EMPTY__"]

    def test_patch_adds_empty_sentinel(self, session_e, mongo):
        m = _create_map(session_e, name="TEST_empty_patch",
                        status_column="Estado", status_visible_values=["Activo"])
        r = requests.patch(
            f"{API}/maps/{m['id']}",
            json={"status_visible_values": ["Activo", "Pendiente", "__EMPTY__"]},
            headers=_headers(session_e),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status_visible_values"] == ["Activo", "Pendiente", "__EMPTY__"]

        # GET returns it too
        r = requests.get(f"{API}/maps/{m['id']}", headers=_headers(session_e), timeout=15)
        assert r.status_code == 200
        assert r.json()["status_visible_values"] == ["Activo", "Pendiente", "__EMPTY__"]

        # Mongo persistence
        doc = mongo.maps.find_one({"id": m["id"]})
        assert "__EMPTY__" in doc["status_visible_values"]

    def test_patch_only_empty_sentinel(self, session_e):
        m = _create_map(session_e, name="TEST_empty_only",
                        status_column="Estado", status_visible_values=[])
        r = requests.patch(
            f"{API}/maps/{m['id']}",
            json={"status_visible_values": ["__EMPTY__"]},
            headers=_headers(session_e),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["status_visible_values"] == ["__EMPTY__"]

    def test_patch_remove_empty_sentinel(self, session_e):
        m = _create_map(session_e, name="TEST_empty_remove",
                        status_column="Estado",
                        status_visible_values=["Activo", "__EMPTY__"])
        r = requests.patch(
            f"{API}/maps/{m['id']}",
            json={"status_visible_values": ["Activo"]},
            headers=_headers(session_e),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["status_visible_values"] == ["Activo"]
        assert "__EMPTY__" not in r.json()["status_visible_values"]


# ---------------- Code inspection: map_data response has status_has_empty ----------------

class TestMapDataResponseShape:
    """Static verification: map_data returns status_has_empty and excludes empty from status_values.
    Endpoint itself needs MS token, so we inspect the source."""

    def test_status_has_empty_in_source(self):
        src = Path("/app/backend/server.py").read_text()
        # Response body must include the new key
        assert '"status_has_empty": has_empty' in src, \
            "map_data response should include status_has_empty field"
        # Empty values excluded from status_values loop
        assert "has_empty = True" in src
        assert re.search(r"if v is None or \(isinstance\(v, str\) and v\.strip\(\) == \"\"\):", src), \
            "empty check for status values missing in map_data"

    def test_build_map_rows_handles_empty_sentinel(self):
        src = Path("/app/backend/server.py").read_text()
        assert '"__EMPTY__" in status_visible' in src, \
            "_build_map_rows must treat __EMPTY__ as sentinel for empty status"
