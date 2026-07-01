"""
Backend tests for MS OAuth client_secret bug fix + regression coverage.
Bug: MS_CLIENT_SECRET was set to the Secret ID (GUID) instead of the Value.
     Previously produced AADSTS7000215 "Invalid client secret provided".
Fix: MS_CLIENT_SECRET updated to real value.
Expected after fix: Microsoft accepts client credentials, and rejects only
the (fake) authorization code with 'invalid_grant' / AADSTS9002313 / AADSTS70008.
"""
import os
import uuid
import json
import requests
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

# Load backend env for MONGO access
load_dotenv(Path("/app/backend/.env"))

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # Fallback: read from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def mongo_db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ============ Bug fix verification ============

class TestMicrosoftClientSecretFix:
    """Validate MS_CLIENT_SECRET is now a valid Value, not Secret ID."""

    def test_callback_with_fake_code_but_valid_state_returns_invalid_grant_not_invalid_client(self, http, mongo_db):
        # 1) Request URL to have backend register a state
        r = http.get(f"{API}/auth/microsoft/url", timeout=30)
        assert r.status_code == 200
        state = r.json()["state"]
        assert state and len(state) > 10

        # Confirm state persisted
        assert mongo_db.oauth_states.find_one({"state": state}) is not None

        # 2) POST callback with fake code + real state
        r = http.post(
            f"{API}/auth/microsoft/callback",
            json={"code": "fake_invalid_code_123", "state": state},
            timeout=45,
        )
        # Should be 400 (token exchange failed)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"

        body = r.json()
        detail = body.get("detail", "")
        detail_str = json.dumps(detail) if not isinstance(detail, str) else detail
        detail_low = detail_str.lower()

        print(f"\n[callback detail] {detail_str}\n")

        # 3) Must NOT contain the old error codes indicating bad secret
        assert "aadsts7000215" not in detail_low, (
            f"BUG NOT FIXED: MS still returns AADSTS7000215 (invalid_client). Detail: {detail_str}"
        )
        assert "invalid_client" not in detail_low, (
            f"BUG NOT FIXED: MS still returns invalid_client. Detail: {detail_str}"
        )
        assert "invalid client secret" not in detail_low, (
            f"BUG NOT FIXED: MS still complains about client secret. Detail: {detail_str}"
        )

        # 4) Should look like an invalid_grant / code-related error, which
        #    proves Microsoft accepted our client credentials.
        acceptable_markers = [
            "invalid_grant",
            "aadsts9002313",   # Invalid request. Invalid authorization code
            "aadsts70008",     # expired/revoked code
            "aadsts54005",     # code already redeemed
            "aadsts50173",     # fresh auth token required
            "aadsts900144",    # code missing/malformed
            "authorization_code",
            "code",
        ]
        assert any(m in detail_low for m in acceptable_markers), (
            f"Unexpected error shape (no invalid_grant marker). Detail: {detail_str}"
        )


# ============ Regression tests ============

class TestRegression:
    def test_root(self, http):
        r = http.get(f"{API}/", timeout=15)
        assert r.status_code == 200
        assert r.json().get("message") == "Excel Maps API"

    def test_microsoft_url_valid(self, http, mongo_db):
        r = http.get(f"{API}/auth/microsoft/url", timeout=15)
        assert r.status_code == 200
        body = r.json()
        url = body["url"]
        state = body["state"]
        assert "login.microsoftonline.com" in url
        assert "client_id=" in url
        assert "response_type=code" in url
        assert "redirect_uri=" in url
        assert f"state={state}" in url
        assert mongo_db.oauth_states.find_one({"state": state}) is not None
        # cleanup
        mongo_db.oauth_states.delete_one({"state": state})

    def test_callback_missing_code_state(self, http):
        r = http.post(f"{API}/auth/microsoft/callback", json={}, timeout=15)
        assert r.status_code == 400
        assert "Missing" in json.dumps(r.json())

    def test_callback_invalid_state(self, http):
        r = http.post(
            f"{API}/auth/microsoft/callback",
            json={"code": "anything", "state": "nonexistent_state_" + uuid.uuid4().hex},
            timeout=15,
        )
        assert r.status_code == 400
        assert "Invalid state" in json.dumps(r.json())

    def test_protected_onedrive_files_requires_session(self, http):
        # Missing header -> FastAPI returns 422 (Header(...) required).
        # Empty header -> route returns 401 "Missing session".
        r = http.get(f"{API}/onedrive/files", headers={"x-session-id": ""}, timeout=15)
        assert r.status_code == 401

    def test_protected_maps_requires_session(self, http):
        r = http.get(f"{API}/maps", headers={"x-session-id": ""}, timeout=15)
        # empty header -> 401 (Missing/Invalid session)
        assert r.status_code in (401, 422)

    def test_auth_me_invalid_session(self, http):
        r = http.get(f"{API}/auth/me", headers={"x-session-id": "not-a-real-session"}, timeout=15)
        assert r.status_code == 401


# ============ Maps CRUD regression via injected session ============

class TestMapsCRUDWithInjectedSession:
    session_id = None
    map_id = None

    @classmethod
    def setup_class(cls):
        c = MongoClient(MONGO_URL)
        cls._mongo = c
        db = c[DB_NAME]
        cls.session_id = f"TEST_sess_{uuid.uuid4().hex}"
        db.sessions.insert_one({
            "session_id": cls.session_id,
            "user_id": f"TEST_user_{uuid.uuid4().hex}",
            "display_name": "Test User",
            "email": "test@example.com",
            "access_token": "TEST_access",
            "refresh_token": "TEST_refresh",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        })
        cls._db = db

    @classmethod
    def teardown_class(cls):
        try:
            if cls.map_id:
                cls._db.maps.delete_many({"id": cls.map_id})
            cls._db.sessions.delete_many({"session_id": cls.session_id})
        finally:
            cls._mongo.close()

    def _h(self):
        return {"Content-Type": "application/json", "x-session-id": self.__class__.session_id}

    def test_create_map(self):
        payload = {
            "name": "TEST_map",
            "file_id": "fake_file_id",
            "file_name": "TEST.xlsx",
            "sheet_name": "Sheet1",
            "lat_column": "Lat",
            "lng_column": "Lng",
            "visible_columns": ["a", "b"],
        }
        r = requests.post(f"{API}/maps", json=payload, headers=self._h(), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "TEST_map"
        assert "id" in body
        self.__class__.map_id = body["id"]

    def test_list_maps_includes_created(self):
        r = requests.get(f"{API}/maps", headers=self._h(), timeout=15)
        assert r.status_code == 200
        ids = [m["id"] for m in r.json()["maps"]]
        assert self.__class__.map_id in ids

    def test_get_map(self):
        r = requests.get(f"{API}/maps/{self.__class__.map_id}", headers=self._h(), timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == self.__class__.map_id

    def test_patch_map(self):
        r = requests.patch(
            f"{API}/maps/{self.__class__.map_id}",
            json={"name": "TEST_renamed", "visible_columns": ["x"]},
            headers=self._h(),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_renamed"
        assert r.json()["visible_columns"] == ["x"]

    def test_put_point_override(self):
        r = requests.put(
            f"{API}/maps/{self.__class__.map_id}/points/0",
            json={"overrides": {"note": "hello"}},
            headers=self._h(),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["point_overrides"]["0"] == {"note": "hello"}

    def test_delete_point_override(self):
        r = requests.delete(
            f"{API}/maps/{self.__class__.map_id}/points/0",
            headers=self._h(),
            timeout=15,
        )
        assert r.status_code == 200
        assert "0" not in (r.json().get("point_overrides") or {})

    def test_delete_map(self):
        r = requests.delete(
            f"{API}/maps/{self.__class__.map_id}",
            headers=self._h(),
            timeout=15,
        )
        assert r.status_code == 200
        r2 = requests.get(f"{API}/maps/{self.__class__.map_id}", headers=self._h(), timeout=15)
        assert r2.status_code == 404
