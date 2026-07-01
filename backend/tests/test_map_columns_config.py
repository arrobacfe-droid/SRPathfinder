"""
Iteration 3 tests: verify the new lat_column/lng_column configuration feature
for maps.

Covers:
- MapCreate requires lat_column & lng_column (422 when missing)
- POST /api/maps persists lat_column/lng_column
- PATCH /api/maps/{id} accepts lat_column/lng_column and persists
- GET /api/maps and GET /api/maps/{id} return the new fields
- Backwards-compat: legacy maps without lat_column/lng_column are listable
- DELETE still works
- Regression on injected-session Maps CRUD (mirrors iteration_2 flow but with
  the new required fields)
"""
import os
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


# ---------------- Shared session fixture (injected into Mongo) ----------------

@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    db = c[DB_NAME]
    yield db
    c.close()


@pytest.fixture(scope="module")
def test_session(mongo):
    session_id = f"TEST_sess_{uuid.uuid4().hex}"
    user_id = f"TEST_user_{uuid.uuid4().hex}"
    mongo.sessions.insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "display_name": "TEST User",
        "email": "test@example.com",
        "access_token": "TEST_access",
        "refresh_token": "TEST_refresh",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    yield {"session_id": session_id, "user_id": user_id}
    # cleanup
    mongo.sessions.delete_many({"session_id": session_id})
    mongo.maps.delete_many({"user_id": user_id})


def _headers(session):
    return {"Content-Type": "application/json", "x-session-id": session["session_id"]}


# ---------------- Feature: lat_column / lng_column ----------------

class TestMapColumnsFeature:

    def test_create_map_missing_lat_lng_returns_422(self, test_session):
        payload = {
            "name": "TEST_no_latlng",
            "file_id": "fake_file",
            "file_name": "TEST.xlsx",
            "sheet_name": "Sheet1",
            "visible_columns": ["a"],
            # lat_column, lng_column intentionally missing
        }
        r = requests.post(f"{API}/maps", json=payload, headers=_headers(test_session), timeout=15)
        assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"
        body = r.json()
        text = str(body).lower()
        assert "lat_column" in text and "lng_column" in text, f"Missing field names in error: {body}"

    def test_create_map_missing_only_lng_returns_422(self, test_session):
        payload = {
            "name": "TEST_only_lat",
            "file_id": "fake_file",
            "file_name": "TEST.xlsx",
            "sheet_name": "Sheet1",
            "lat_column": "Latitude",
            "visible_columns": [],
        }
        r = requests.post(f"{API}/maps", json=payload, headers=_headers(test_session), timeout=15)
        assert r.status_code == 422
        assert "lng_column" in str(r.json()).lower()

    def test_create_map_with_lat_lng_persists(self, test_session, mongo):
        payload = {
            "name": "TEST_with_latlng",
            "file_id": "fake_file_1",
            "file_name": "TEST1.xlsx",
            "sheet_name": "Hoja1",
            "lat_column": "Latitude",
            "lng_column": "Longitude",
            "visible_columns": ["Name", "City"],
        }
        r = requests.post(f"{API}/maps", json=payload, headers=_headers(test_session), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["lat_column"] == "Latitude"
        assert body["lng_column"] == "Longitude"
        assert body["visible_columns"] == ["Name", "City"]
        assert body["name"] == "TEST_with_latlng"
        assert isinstance(body["id"], str) and len(body["id"]) > 0
        assert body["point_overrides"] == {}

        # Verify persistence in Mongo directly
        doc = mongo.maps.find_one({"id": body["id"]})
        assert doc is not None
        assert doc["lat_column"] == "Latitude"
        assert doc["lng_column"] == "Longitude"

        # Verify GET /api/maps returns it with new fields
        r = requests.get(f"{API}/maps", headers=_headers(test_session), timeout=15)
        assert r.status_code == 200
        maps = r.json()["maps"]
        found = [m for m in maps if m["id"] == body["id"]]
        assert len(found) == 1
        assert found[0]["lat_column"] == "Latitude"
        assert found[0]["lng_column"] == "Longitude"

        # Verify GET /api/maps/{id} returns them
        r = requests.get(f"{API}/maps/{body['id']}", headers=_headers(test_session), timeout=15)
        assert r.status_code == 200
        got = r.json()
        assert got["lat_column"] == "Latitude"
        assert got["lng_column"] == "Longitude"
        assert got["visible_columns"] == ["Name", "City"]

        # save id for cleanup
        TestMapColumnsFeature.created_id = body["id"]

    def test_patch_map_updates_lat_lng(self, test_session, mongo):
        # Reuse the map created above (fallback: create one)
        map_id = getattr(TestMapColumnsFeature, "created_id", None)
        if not map_id:
            pytest.skip("Prior create test did not run")

        r = requests.patch(
            f"{API}/maps/{map_id}",
            json={"lat_column": "Lat_NEW", "lng_column": "Lng_NEW"},
            headers=_headers(test_session),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["lat_column"] == "Lat_NEW"
        assert body["lng_column"] == "Lng_NEW"

        # Verify persistence
        doc = mongo.maps.find_one({"id": map_id})
        assert doc["lat_column"] == "Lat_NEW"
        assert doc["lng_column"] == "Lng_NEW"

        # PATCH only lat_column, lng should be unchanged
        r = requests.patch(
            f"{API}/maps/{map_id}",
            json={"lat_column": "Lat_ONLY"},
            headers=_headers(test_session),
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["lat_column"] == "Lat_ONLY"
        assert body["lng_column"] == "Lng_NEW"  # unchanged

    def test_backwards_compat_legacy_map_listable(self, test_session, mongo):
        """Insert a map directly (no lat/lng fields) — GET should not break."""
        legacy_id = str(uuid.uuid4())
        mongo.maps.insert_one({
            "id": legacy_id,
            "user_id": test_session["user_id"],
            "name": "TEST_legacy_no_latlng",
            "file_id": "legacy_file",
            "file_name": "LEGACY.xlsx",
            "sheet_name": "Sheet1",
            "visible_columns": [],
            "point_overrides": {},
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            # lat_column and lng_column intentionally NOT set
        })
        # GET list
        r = requests.get(f"{API}/maps", headers=_headers(test_session), timeout=15)
        assert r.status_code == 200
        maps = r.json()["maps"]
        legacy = [m for m in maps if m["id"] == legacy_id]
        assert len(legacy) == 1, "Legacy map not in list"
        # lat_column and lng_column absent (or null) — must not error
        assert legacy[0].get("lat_column") in (None, "", None)
        assert legacy[0].get("lng_column") in (None, "", None)

        # GET by id also works
        r = requests.get(f"{API}/maps/{legacy_id}", headers=_headers(test_session), timeout=15)
        assert r.status_code == 200
        got = r.json()
        assert got["id"] == legacy_id
        assert got.get("lat_column") in (None, "")
        assert got.get("lng_column") in (None, "")

    def test_delete_map_still_works(self, test_session, mongo):
        map_id = getattr(TestMapColumnsFeature, "created_id", None)
        if not map_id:
            pytest.skip("No map to delete")
        r = requests.delete(
            f"{API}/maps/{map_id}",
            headers=_headers(test_session),
            timeout=15,
        )
        assert r.status_code == 200
        # verify gone
        r = requests.get(f"{API}/maps/{map_id}", headers=_headers(test_session), timeout=15)
        assert r.status_code == 404


# ---------------- Regression (parity with iteration_2) ----------------

class TestRegressionSummary:
    """Quick smoke tests on unchanged endpoints."""

    def test_root(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
        assert r.json().get("message") == "Excel Maps API"

    def test_microsoft_url(self, mongo):
        r = requests.get(f"{API}/auth/microsoft/url", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "login.microsoftonline.com" in body["url"]
        assert body["state"]
        mongo.oauth_states.delete_one({"state": body["state"]})

    def test_callback_missing_fields(self):
        r = requests.post(f"{API}/auth/microsoft/callback", json={}, timeout=10)
        assert r.status_code == 400

    def test_callback_invalid_state(self):
        r = requests.post(
            f"{API}/auth/microsoft/callback",
            json={"code": "x", "state": f"nonexistent_{uuid.uuid4().hex}"},
            timeout=10,
        )
        assert r.status_code == 400

    def test_maps_requires_session(self):
        r = requests.get(f"{API}/maps", headers={"x-session-id": ""}, timeout=10)
        assert r.status_code == 401

    def test_auth_me_invalid_session(self):
        r = requests.get(f"{API}/auth/me", headers={"x-session-id": "bad"}, timeout=10)
        assert r.status_code == 401

    def test_point_override_flow(self, test_session, mongo):
        # Create a fresh map for this
        payload = {
            "name": "TEST_override_flow",
            "file_id": "f1", "file_name": "T.xlsx", "sheet_name": "S1",
            "lat_column": "Lat", "lng_column": "Lng",
            "visible_columns": [],
        }
        r = requests.post(f"{API}/maps", json=payload, headers=_headers(test_session), timeout=15)
        assert r.status_code == 200
        map_id = r.json()["id"]

        r = requests.put(
            f"{API}/maps/{map_id}/points/2",
            json={"overrides": {"note": "hi", "color": "red"}},
            headers=_headers(test_session),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["point_overrides"]["2"] == {"note": "hi", "color": "red"}

        r = requests.delete(
            f"{API}/maps/{map_id}/points/2",
            headers=_headers(test_session),
            timeout=15,
        )
        assert r.status_code == 200
        assert "2" not in (r.json().get("point_overrides") or {})

        # cleanup
        requests.delete(f"{API}/maps/{map_id}", headers=_headers(test_session), timeout=15)
