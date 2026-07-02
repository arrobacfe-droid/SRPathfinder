"""
Iteration 4 tests: share/public map endpoints + status/range configuration.

Covers:
- MapCreate accepts optional header_row, first_col, status_column, status_visible_values
- MapCreate default values (header_row=1, first_col=1, status_column=None, status_visible_values=[])
- On create: is_public=False, share_token=None, cached_rows=[], cached_at=None, cached_headers=[]
- PATCH /api/maps/{id} accepts new fields
- POST /api/maps/{id}/share  -> creates 32-hex share_token, is_public=True
- POST /api/maps/{id}/share/rotate -> generates NEW token
- DELETE /api/maps/{id}/share -> is_public=False, token preserved
- Auth: share endpoints require x-session-id (401 without)
- Auth: user cannot share another user's map (404)
- Public: GET /api/public/maps/{token} no auth, sensitive fields excluded
- Public: invalid token -> 404
- Public: disabled (is_public=False) -> 404
"""
import os
import uuid
import re
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

HEX32 = re.compile(r"^[0-9a-f]{32}$")


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    db = c[DB_NAME]
    yield db
    c.close()


def _inject_session(mongo, label="A"):
    session_id = f"TEST_sess_{label}_{uuid.uuid4().hex}"
    user_id = f"TEST_user_{label}_{uuid.uuid4().hex}"
    mongo.sessions.insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "display_name": f"TEST {label}",
        "email": f"test_{label}@example.com",
        "access_token": "TEST_access",
        "refresh_token": "TEST_refresh",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    return {"session_id": session_id, "user_id": user_id}


@pytest.fixture(scope="module")
def session_a(mongo):
    s = _inject_session(mongo, "A")
    yield s
    mongo.sessions.delete_many({"session_id": s["session_id"]})
    mongo.maps.delete_many({"user_id": s["user_id"]})


@pytest.fixture(scope="module")
def session_b(mongo):
    s = _inject_session(mongo, "B")
    yield s
    mongo.sessions.delete_many({"session_id": s["session_id"]})
    mongo.maps.delete_many({"user_id": s["user_id"]})


def _headers(s):
    return {"Content-Type": "application/json", "x-session-id": s["session_id"]}


def _create_map(session, **overrides):
    payload = {
        "name": "TEST_share_map",
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


# ---------------- Models: new optional fields ----------------

class TestMapCreateNewFields:

    def test_create_map_defaults(self, session_a):
        body = _create_map(session_a, name="TEST_defaults")
        # Defaults
        assert body["header_row"] == 1
        assert body["first_col"] == 1
        assert body["status_column"] is None
        assert body["status_visible_values"] == []
        # Sharing/cache init
        assert body["is_public"] is False
        assert body["share_token"] is None
        assert body["cached_rows"] == []
        assert body["cached_at"] is None
        assert body["cached_headers"] == []

    def test_create_map_with_all_new_fields(self, session_a, mongo):
        body = _create_map(
            session_a,
            name="TEST_full_fields",
            header_row=3,
            first_col=2,
            status_column="Estado",
            status_visible_values=["Activo", "Pendiente"],
        )
        assert body["header_row"] == 3
        assert body["first_col"] == 2
        assert body["status_column"] == "Estado"
        assert body["status_visible_values"] == ["Activo", "Pendiente"]
        doc = mongo.maps.find_one({"id": body["id"]})
        assert doc["header_row"] == 3
        assert doc["first_col"] == 2
        assert doc["status_column"] == "Estado"
        assert doc["status_visible_values"] == ["Activo", "Pendiente"]

    def test_patch_map_updates_new_fields(self, session_a):
        m = _create_map(session_a, name="TEST_patch_new")
        r = requests.patch(
            f"{API}/maps/{m['id']}",
            json={
                "header_row": 5,
                "first_col": 4,
                "status_column": "Status",
                "status_visible_values": ["Open"],
            },
            headers=_headers(session_a),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["header_row"] == 5
        assert body["first_col"] == 4
        assert body["status_column"] == "Status"
        assert body["status_visible_values"] == ["Open"]

        # GET returns them
        r = requests.get(f"{API}/maps/{m['id']}", headers=_headers(session_a), timeout=15)
        assert r.status_code == 200
        got = r.json()
        assert got["header_row"] == 5
        assert got["status_column"] == "Status"
        assert got["status_visible_values"] == ["Open"]


# ---------------- Share endpoints ----------------

class TestShareEndpoints:

    def test_enable_share_generates_hex32(self, session_a, mongo):
        m = _create_map(session_a, name="TEST_enable_share")
        r = requests.post(
            f"{API}/maps/{m['id']}/share",
            headers=_headers(session_a),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_public"] is True
        token = body["share_token"]
        assert isinstance(token, str)
        assert HEX32.match(token), f"share_token not 32-hex: {token}"
        assert "map" in body
        assert body["map"]["share_token"] == token
        assert body["map"]["is_public"] is True

        # Verify in Mongo
        doc = mongo.maps.find_one({"id": m["id"]})
        assert doc["is_public"] is True
        assert doc["share_token"] == token
        TestShareEndpoints.map_id = m["id"]
        TestShareEndpoints.token_1 = token

    def test_rotate_share_generates_different_token(self, session_a, mongo):
        map_id = getattr(TestShareEndpoints, "map_id", None)
        prev = getattr(TestShareEndpoints, "token_1", None)
        if not map_id:
            pytest.skip("prior enable did not run")
        r = requests.post(
            f"{API}/maps/{map_id}/share/rotate",
            headers=_headers(session_a),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_public"] is True
        new_token = body["share_token"]
        assert HEX32.match(new_token)
        assert new_token != prev, "rotate did not produce a new token"
        # Mongo
        doc = mongo.maps.find_one({"id": map_id})
        assert doc["share_token"] == new_token
        assert doc["is_public"] is True
        TestShareEndpoints.token_2 = new_token

    def test_disable_share_keeps_token_but_sets_public_false(self, session_a, mongo):
        map_id = getattr(TestShareEndpoints, "map_id", None)
        token = getattr(TestShareEndpoints, "token_2", None)
        if not map_id:
            pytest.skip("prior tests did not run")
        r = requests.delete(
            f"{API}/maps/{map_id}/share",
            headers=_headers(session_a),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_public"] is False
        doc = mongo.maps.find_one({"id": map_id})
        assert doc["is_public"] is False
        # Token preserved
        assert doc["share_token"] == token

    def test_reenable_share_reuses_existing_token(self, session_a, mongo):
        """After disable, POST /share should keep the same token (not rotate)."""
        map_id = getattr(TestShareEndpoints, "map_id", None)
        prev = getattr(TestShareEndpoints, "token_2", None)
        if not map_id:
            pytest.skip("prior tests did not run")
        r = requests.post(
            f"{API}/maps/{map_id}/share",
            headers=_headers(session_a),
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["is_public"] is True
        assert body["share_token"] == prev, "enable_share should reuse existing token, not rotate"


# ---------------- Share auth ----------------

class TestShareAuth:

    def test_enable_share_without_session_returns_401(self, session_a):
        m = _create_map(session_a, name="TEST_auth_enable")
        r = requests.post(
            f"{API}/maps/{m['id']}/share",
            headers={"Content-Type": "application/json", "x-session-id": ""},
            timeout=10,
        )
        assert r.status_code == 401

    def test_rotate_share_without_session_returns_401(self, session_a):
        m = _create_map(session_a, name="TEST_auth_rotate")
        r = requests.post(
            f"{API}/maps/{m['id']}/share/rotate",
            headers={"Content-Type": "application/json", "x-session-id": ""},
            timeout=10,
        )
        assert r.status_code == 401

    def test_disable_share_without_session_returns_401(self, session_a):
        m = _create_map(session_a, name="TEST_auth_disable")
        r = requests.delete(
            f"{API}/maps/{m['id']}/share",
            headers={"x-session-id": ""},
            timeout=10,
        )
        assert r.status_code == 401

    def test_cannot_share_another_users_map(self, session_a, session_b):
        # A creates map, B tries to share it
        m = _create_map(session_a, name="TEST_cross_user")
        r = requests.post(
            f"{API}/maps/{m['id']}/share",
            headers=_headers(session_b),
            timeout=10,
        )
        assert r.status_code == 404

        r = requests.post(
            f"{API}/maps/{m['id']}/share/rotate",
            headers=_headers(session_b),
            timeout=10,
        )
        assert r.status_code == 404

        r = requests.delete(
            f"{API}/maps/{m['id']}/share",
            headers=_headers(session_b),
            timeout=10,
        )
        assert r.status_code == 404


# ---------------- Public endpoint ----------------

class TestPublicEndpoint:

    def test_public_map_returns_data_and_hides_sensitive(self, session_a, mongo):
        # Create map, share, then inject cached_rows/cached_headers manually
        m = _create_map(
            session_a,
            name="TEST_public_ok",
            status_column="Estado",
            status_visible_values=["Activo"],
        )
        r = requests.post(f"{API}/maps/{m['id']}/share", headers=_headers(session_a), timeout=15)
        assert r.status_code == 200
        token = r.json()["share_token"]

        cached_headers = ["Name", "Estado", "Lat", "Lng"]
        cached_rows = [
            {"row_index": 0, "lat": 40.0, "lng": -3.0,
             "data": {"Name": "P1", "Estado": "Activo", "Lat": 40.0, "Lng": -3.0},
             "edited": False, "visible": True},
            {"row_index": 1, "lat": 41.0, "lng": -4.0,
             "data": {"Name": "P2", "Estado": "Inactivo", "Lat": 41.0, "Lng": -4.0},
             "edited": False, "visible": False},
        ]
        mongo.maps.update_one(
            {"id": m["id"]},
            {"$set": {
                "cached_rows": cached_rows,
                "cached_headers": cached_headers,
                "cached_at": "2026-01-15T00:00:00Z",
            }},
        )

        # Public GET (no auth)
        r = requests.get(f"{API}/public/maps/{token}", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()

        # Structure
        assert body["headers"] == cached_headers
        assert body["rows"] == cached_rows
        assert body["lat_column"] == "Lat"
        assert body["lng_column"] == "Lng"
        assert body["status_column"] == "Estado"
        assert body["cached_at"] == "2026-01-15T00:00:00Z"

        assert body["map"]["id"] == m["id"]
        assert body["map"]["name"] == "TEST_public_ok"
        assert body["map"]["status_column"] == "Estado"
        assert body["map"]["status_visible_values"] == ["Activo"]

        # Sensitive fields must NOT be exposed anywhere in response
        flat = str(body)
        assert "user_id" not in flat, "user_id leaked in public response"
        assert "point_overrides" not in flat, "point_overrides leaked in public response"
        assert "file_id" not in body["map"], "file_id leaked in public map"
        # file_id should also not appear at top level
        assert "file_id" not in body, "file_id at top level"
        # Also verify the raw token/access fields absent
        assert "access_token" not in flat
        assert "refresh_token" not in flat

    def test_public_map_invalid_token_returns_404(self):
        bogus = uuid.uuid4().hex
        r = requests.get(f"{API}/public/maps/{bogus}", timeout=10)
        assert r.status_code == 404
        detail = r.json().get("detail", "")
        assert "no encontrado" in detail.lower() or "no compartido" in detail.lower()

    def test_public_map_disabled_returns_404_even_with_valid_token(self, session_a, mongo):
        m = _create_map(session_a, name="TEST_public_disabled")
        r = requests.post(f"{API}/maps/{m['id']}/share", headers=_headers(session_a), timeout=15)
        token = r.json()["share_token"]

        # Confirm public GET works while enabled
        r = requests.get(f"{API}/public/maps/{token}", timeout=10)
        assert r.status_code == 200

        # Disable
        r = requests.delete(f"{API}/maps/{m['id']}/share", headers=_headers(session_a), timeout=15)
        assert r.status_code == 200

        # Now public should 404
        r = requests.get(f"{API}/public/maps/{token}", timeout=10)
        assert r.status_code == 404

    def test_public_endpoint_requires_no_auth(self, session_a):
        """Ensure sending no headers at all works."""
        m = _create_map(session_a, name="TEST_public_no_auth")
        r = requests.post(f"{API}/maps/{m['id']}/share", headers=_headers(session_a), timeout=15)
        token = r.json()["share_token"]
        # Explicitly bare request (no session header)
        r = requests.get(f"{API}/public/maps/{token}", headers={}, timeout=10)
        assert r.status_code == 200
