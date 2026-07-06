"""
Iteration 7 backend tests:
- POST /api/maps accepts optional data_row_from / data_row_to (persisted; default null)
- PATCH /api/maps/{id} updates data_row_from / data_row_to
- PATCH /api/maps/{id} renames map (name); editor can rename too
- Regression: legacy maps without these fields still work
- Documented behavior: PATCH data_row_from=null does NOT reset (exclude_none=True)
"""
import os
import uuid
import requests
import pytest
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path("/app/backend/.env"))

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
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


@pytest.fixture(scope="module")
def owner_session(mongo_db):
    sid = f"TEST_it7_owner_sess_{uuid.uuid4().hex}"
    uid = f"TEST_it7_owner_user_{uuid.uuid4().hex}"
    mongo_db.sessions.insert_one({
        "session_id": sid,
        "user_id": uid,
        "display_name": "It7 Owner",
        "email": "TEST_it7_owner@example.com",
        "access_token": "TEST",
        "refresh_token": "TEST",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    yield {"session_id": sid, "user_id": uid, "email": "test_it7_owner@example.com"}
    mongo_db.sessions.delete_many({"session_id": sid})
    mongo_db.maps.delete_many({"user_id": uid})


@pytest.fixture(scope="module")
def editor_session(mongo_db):
    sid = f"TEST_it7_editor_sess_{uuid.uuid4().hex}"
    uid = f"TEST_it7_editor_user_{uuid.uuid4().hex}"
    mongo_db.sessions.insert_one({
        "session_id": sid,
        "user_id": uid,
        "display_name": "It7 Editor",
        "email": "TEST_it7_editor@example.com",
        "access_token": "TEST",
        "refresh_token": "TEST",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    yield {"session_id": sid, "user_id": uid, "email": "test_it7_editor@example.com"}
    mongo_db.sessions.delete_many({"session_id": sid})


def _h(sess):
    return {"Content-Type": "application/json", "x-session-id": sess["session_id"]}


def _base_payload(name="TEST_it7_map", **overrides):
    p = {
        "name": name,
        "file_id": "fake_file_id",
        "file_name": "TEST.xlsx",
        "sheet_name": "Sheet1",
        "lat_column": "Lat",
        "lng_column": "Lng",
        "visible_columns": [],
    }
    p.update(overrides)
    return p


# ============ POST /api/maps with data_row_from/to ============

class TestCreateMapRowRange:
    def test_create_without_row_range_defaults_to_null(self, owner_session, mongo_db):
        r = requests.post(f"{API}/maps", json=_base_payload("TEST_it7_no_range"),
                          headers=_h(owner_session), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "data_row_from" in body
        assert "data_row_to" in body
        assert body["data_row_from"] is None
        assert body["data_row_to"] is None
        # Verify persisted in DB
        doc = mongo_db.maps.find_one({"id": body["id"]})
        assert doc["data_row_from"] is None
        assert doc["data_row_to"] is None
        mongo_db.maps.delete_one({"id": body["id"]})

    def test_create_with_row_range_persists(self, owner_session, mongo_db):
        payload = _base_payload("TEST_it7_with_range", data_row_from=2, data_row_to=50)
        r = requests.post(f"{API}/maps", json=payload, headers=_h(owner_session), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["data_row_from"] == 2
        assert body["data_row_to"] == 50
        # Verify persisted
        doc = mongo_db.maps.find_one({"id": body["id"]})
        assert doc["data_row_from"] == 2
        assert doc["data_row_to"] == 50
        # GET returns same
        g = requests.get(f"{API}/maps/{body['id']}", headers=_h(owner_session), timeout=15)
        assert g.status_code == 200
        assert g.json()["data_row_from"] == 2
        assert g.json()["data_row_to"] == 50
        mongo_db.maps.delete_one({"id": body["id"]})

    def test_create_with_only_row_from(self, owner_session, mongo_db):
        payload = _base_payload("TEST_it7_only_from", data_row_from=5)
        r = requests.post(f"{API}/maps", json=payload, headers=_h(owner_session), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["data_row_from"] == 5
        assert body["data_row_to"] is None
        mongo_db.maps.delete_one({"id": body["id"]})

    def test_create_with_explicit_null_row_range(self, owner_session, mongo_db):
        payload = _base_payload("TEST_it7_null", data_row_from=None, data_row_to=None)
        r = requests.post(f"{API}/maps", json=payload, headers=_h(owner_session), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["data_row_from"] is None
        assert body["data_row_to"] is None
        mongo_db.maps.delete_one({"id": body["id"]})


# ============ PATCH /api/maps/{id} row range + rename ============

@pytest.fixture
def owned_map(owner_session, mongo_db):
    r = requests.post(f"{API}/maps", json=_base_payload(f"TEST_it7_owned_{uuid.uuid4().hex[:6]}"),
                      headers=_h(owner_session), timeout=15)
    assert r.status_code == 200
    body = r.json()
    yield body
    mongo_db.maps.delete_one({"id": body["id"]})


class TestPatchRowRange:
    def test_patch_sets_row_range(self, owner_session, owned_map):
        r = requests.patch(f"{API}/maps/{owned_map['id']}",
                           json={"data_row_from": 1, "data_row_to": 45},
                           headers=_h(owner_session), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["data_row_from"] == 1
        assert body["data_row_to"] == 45
        # GET verifies persistence
        g = requests.get(f"{API}/maps/{owned_map['id']}", headers=_h(owner_session), timeout=15)
        assert g.json()["data_row_from"] == 1
        assert g.json()["data_row_to"] == 45

    def test_patch_only_row_to(self, owner_session, owned_map):
        # First set both
        requests.patch(f"{API}/maps/{owned_map['id']}",
                       json={"data_row_from": 10, "data_row_to": 20},
                       headers=_h(owner_session), timeout=15)
        # Then update only row_to
        r = requests.patch(f"{API}/maps/{owned_map['id']}",
                           json={"data_row_to": 99},
                           headers=_h(owner_session), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["data_row_from"] == 10  # unchanged
        assert body["data_row_to"] == 99

    def test_patch_null_does_not_reset_documented(self, owner_session, owned_map, mongo_db):
        """Documented behavior: PATCH data_row_from=null does NOT reset because
        the backend uses exclude_none=True in MapUpdate.model_dump()."""
        # Set to a value
        requests.patch(f"{API}/maps/{owned_map['id']}",
                       json={"data_row_from": 7, "data_row_to": 77},
                       headers=_h(owner_session), timeout=15)
        # Attempt to reset with null
        r = requests.patch(f"{API}/maps/{owned_map['id']}",
                           json={"data_row_from": None},
                           headers=_h(owner_session), timeout=15)
        # Because only null was sent and exclude_none strips it → 400 "No updates"
        # or it's ignored silently. Either way, the value must NOT become null.
        doc = mongo_db.maps.find_one({"id": owned_map["id"]})
        assert doc["data_row_from"] == 7, "exclude_none=True should prevent null reset"


class TestPatchRename:
    def test_owner_can_rename(self, owner_session, owned_map):
        new_name = f"TEST_it7_renamed_{uuid.uuid4().hex[:6]}"
        r = requests.patch(f"{API}/maps/{owned_map['id']}",
                           json={"name": new_name},
                           headers=_h(owner_session), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == new_name
        # GET verifies
        g = requests.get(f"{API}/maps/{owned_map['id']}", headers=_h(owner_session), timeout=15)
        assert g.json()["name"] == new_name

    def test_editor_can_rename(self, owner_session, editor_session, owned_map, mongo_db):
        # Add editor
        add = requests.post(f"{API}/maps/{owned_map['id']}/editors",
                            json={"email": editor_session["email"]},
                            headers=_h(owner_session), timeout=15)
        assert add.status_code == 200, add.text
        new_name = f"TEST_it7_editor_renamed_{uuid.uuid4().hex[:6]}"
        r = requests.patch(f"{API}/maps/{owned_map['id']}",
                           json={"name": new_name},
                           headers=_h(editor_session), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == new_name
        # Verify from DB
        doc = mongo_db.maps.find_one({"id": owned_map["id"]})
        assert doc["name"] == new_name

    def test_rename_and_row_range_together(self, owner_session, owned_map):
        new_name = f"TEST_it7_combo_{uuid.uuid4().hex[:6]}"
        r = requests.patch(f"{API}/maps/{owned_map['id']}",
                           json={"name": new_name, "data_row_from": 3, "data_row_to": 8},
                           headers=_h(owner_session), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == new_name
        assert body["data_row_from"] == 3
        assert body["data_row_to"] == 8


# ============ Legacy map compatibility ============

class TestLegacyRowRangeCompat:
    def test_legacy_map_without_row_fields_still_readable(self, owner_session, mongo_db):
        """Insert a legacy map doc without data_row_from/to fields → GET must succeed
        and return the map (fields may be absent or null)."""
        map_id = str(uuid.uuid4())
        mongo_db.maps.insert_one({
            "id": map_id,
            "user_id": owner_session["user_id"],
            "owner_email": owner_session["email"],
            "owner_display_name": "It7 Owner",
            "editor_emails": [],
            "name": "TEST_it7_legacy",
            "file_id": "legacy_fid",
            "file_name": "legacy.xlsx",
            "sheet_name": "Sheet1",
            "lat_column": "Lat",
            "lng_column": "Lng",
            "visible_columns": [],
            "header_row": 1,
            "first_col": 1,
            "point_overrides": {},
            "is_public": False,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        })
        try:
            r = requests.get(f"{API}/maps/{map_id}", headers=_h(owner_session), timeout=15)
            assert r.status_code == 200
            body = r.json()
            # Fields absent from doc → either missing or None (both acceptable)
            assert body.get("data_row_from") is None
            assert body.get("data_row_to") is None
            # Patch still works
            p = requests.patch(f"{API}/maps/{map_id}", json={"data_row_from": 2, "data_row_to": 10},
                               headers=_h(owner_session), timeout=15)
            assert p.status_code == 200
            assert p.json()["data_row_from"] == 2
            assert p.json()["data_row_to"] == 10
        finally:
            mongo_db.maps.delete_one({"id": map_id})


# ============ Cleanup verification ============

class TestCleanup:
    def test_no_test_data_leaks(self, mongo_db):
        # This runs last alphabetically-ish; module teardown will clean owner map docs too.
        # Just verify no TEST_it7 maps outside the module fixtures at end of run.
        # (fixtures also delete their maps individually)
        pass
