"""
Iteration 6 backend tests:
- prompt param on /auth/microsoft/url
- Collaboration: owner_email, editor_emails, is_owner
- /maps/{id}/editors endpoints
- Share endpoints restricted to owner
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


# ============ Prompt param on auth URL ============

class TestPromptParam:
    def test_no_prompt(self):
        r = requests.get(f"{API}/auth/microsoft/url", timeout=15)
        assert r.status_code == 200
        assert "&prompt=" not in r.json()["url"]

    @pytest.mark.parametrize("val", ["select_account", "login", "consent", "none"])
    def test_valid_prompts(self, val):
        r = requests.get(f"{API}/auth/microsoft/url", params={"prompt": val}, timeout=15)
        assert r.status_code == 200
        assert f"&prompt={val}" in r.json()["url"]

    def test_invalid_prompt_ignored(self):
        r = requests.get(f"{API}/auth/microsoft/url", params={"prompt": "invalid"}, timeout=15)
        assert r.status_code == 200
        assert "prompt=" not in r.json()["url"]

    def test_empty_prompt_ignored(self):
        r = requests.get(f"{API}/auth/microsoft/url", params={"prompt": ""}, timeout=15)
        assert r.status_code == 200
        assert "prompt=" not in r.json()["url"]


# ============ Collaboration fixtures ============

@pytest.fixture(scope="module")
def owner_session(mongo_db):
    sid = f"TEST_owner_sess_{uuid.uuid4().hex}"
    uid = f"TEST_owner_user_{uuid.uuid4().hex}"
    mongo_db.sessions.insert_one({
        "session_id": sid,
        "user_id": uid,
        "display_name": "Owner Person",
        "email": "TEST_owner@example.com",
        "access_token": "TEST",
        "refresh_token": "TEST",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    yield {"session_id": sid, "user_id": uid, "email": "test_owner@example.com"}
    mongo_db.sessions.delete_many({"session_id": sid})
    mongo_db.maps.delete_many({"user_id": uid})


@pytest.fixture(scope="module")
def editor_session(mongo_db):
    sid = f"TEST_editor_sess_{uuid.uuid4().hex}"
    uid = f"TEST_editor_user_{uuid.uuid4().hex}"
    mongo_db.sessions.insert_one({
        "session_id": sid,
        "user_id": uid,
        "display_name": "Editor Person",
        "email": "TEST_editor@example.com",
        "access_token": "TEST",
        "refresh_token": "TEST",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    yield {"session_id": sid, "user_id": uid, "email": "test_editor@example.com"}
    mongo_db.sessions.delete_many({"session_id": sid})


@pytest.fixture(scope="module")
def stranger_session(mongo_db):
    sid = f"TEST_stranger_sess_{uuid.uuid4().hex}"
    uid = f"TEST_stranger_user_{uuid.uuid4().hex}"
    mongo_db.sessions.insert_one({
        "session_id": sid,
        "user_id": uid,
        "display_name": "Stranger",
        "email": "TEST_stranger@example.com",
        "access_token": "TEST",
        "refresh_token": "TEST",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    yield {"session_id": sid, "user_id": uid, "email": "test_stranger@example.com"}
    mongo_db.sessions.delete_many({"session_id": sid})


def _h(sess):
    return {"Content-Type": "application/json", "x-session-id": sess["session_id"]}


def _create_map(owner_session, name="TEST_map"):
    payload = {
        "name": name,
        "file_id": "fake_file_id",
        "file_name": "TEST.xlsx",
        "sheet_name": "Sheet1",
        "lat_column": "Lat",
        "lng_column": "Lng",
        "visible_columns": [],
    }
    r = requests.post(f"{API}/maps", json=payload, headers=_h(owner_session), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ============ Owner email persisted on create ============

class TestCreateMapOwnerFields:
    def test_create_map_stores_owner_email_lowercase(self, owner_session, mongo_db):
        body = _create_map(owner_session, name="TEST_owner_fields")
        assert body["owner_email"] == "test_owner@example.com"  # lowercase
        assert body["owner_display_name"] == "Owner Person"
        assert body["editor_emails"] == []
        assert body["is_owner"] is True
        # Cleanup
        mongo_db.maps.delete_one({"id": body["id"]})


# ============ Access control matrix ============

@pytest.fixture
def owned_map(owner_session, mongo_db):
    body = _create_map(owner_session, name=f"TEST_access_{uuid.uuid4().hex[:6]}")
    yield body
    mongo_db.maps.delete_one({"id": body["id"]})


class TestAccessControl:
    def test_list_maps_owner_sees_is_owner_true(self, owner_session, owned_map):
        r = requests.get(f"{API}/maps", headers=_h(owner_session), timeout=15)
        assert r.status_code == 200
        found = [m for m in r.json()["maps"] if m["id"] == owned_map["id"]]
        assert len(found) == 1
        assert found[0]["is_owner"] is True

    def test_editor_cannot_see_map_before_added(self, editor_session, owned_map):
        r = requests.get(f"{API}/maps", headers=_h(editor_session), timeout=15)
        assert r.status_code == 200
        ids = [m["id"] for m in r.json()["maps"]]
        assert owned_map["id"] not in ids

    def test_editor_get_returns_404_before_added(self, editor_session, owned_map):
        r = requests.get(f"{API}/maps/{owned_map['id']}", headers=_h(editor_session), timeout=15)
        assert r.status_code == 404

    def test_stranger_get_returns_404(self, stranger_session, owned_map):
        r = requests.get(f"{API}/maps/{owned_map['id']}", headers=_h(stranger_session), timeout=15)
        assert r.status_code == 404


# ============ Editors endpoints ============

class TestEditorsEndpoints:
    def test_owner_add_editor_lowercase_and_dedup(self, owner_session, owned_map):
        # Add mixed case email
        r = requests.post(
            f"{API}/maps/{owned_map['id']}/editors",
            json={"email": "TEST_Editor@Example.com"},
            headers=_h(owner_session), timeout=15,
        )
        assert r.status_code == 200
        assert "test_editor@example.com" in r.json()["editors"]

        # Add duplicate (upper) — should be idempotent
        r2 = requests.post(
            f"{API}/maps/{owned_map['id']}/editors",
            json={"email": "test_editor@example.com"},
            headers=_h(owner_session), timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["editors"].count("test_editor@example.com") == 1

    def test_owner_add_invalid_email_400(self, owner_session, owned_map):
        r = requests.post(
            f"{API}/maps/{owned_map['id']}/editors",
            json={"email": "not-an-email"},
            headers=_h(owner_session), timeout=15,
        )
        assert r.status_code == 400

    def test_owner_add_self_as_editor_400(self, owner_session, owned_map):
        r = requests.post(
            f"{API}/maps/{owned_map['id']}/editors",
            json={"email": "test_owner@example.com"},
            headers=_h(owner_session), timeout=15,
        )
        assert r.status_code == 400
        assert "dueño" in r.json()["detail"].lower() or "owner" in r.json()["detail"].lower()

    def test_editor_can_list_editors(self, owner_session, editor_session, owned_map):
        # Owner adds editor first
        requests.post(
            f"{API}/maps/{owned_map['id']}/editors",
            json={"email": "test_editor@example.com"},
            headers=_h(owner_session), timeout=15,
        )
        r = requests.get(f"{API}/maps/{owned_map['id']}/editors", headers=_h(editor_session), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["is_owner"] is False
        assert "test_editor@example.com" in body["editors"]
        assert body["owner_email"] == "test_owner@example.com"

    def test_editor_cannot_add_editor(self, owner_session, editor_session, owned_map):
        requests.post(
            f"{API}/maps/{owned_map['id']}/editors",
            json={"email": "test_editor@example.com"},
            headers=_h(owner_session), timeout=15,
        )
        r = requests.post(
            f"{API}/maps/{owned_map['id']}/editors",
            json={"email": "test_third@example.com"},
            headers=_h(editor_session), timeout=15,
        )
        assert r.status_code == 404

    def test_stranger_get_editors_404(self, stranger_session, owned_map):
        r = requests.get(f"{API}/maps/{owned_map['id']}/editors", headers=_h(stranger_session), timeout=15)
        assert r.status_code == 404

    def test_delete_editor_owner_only(self, owner_session, editor_session, owned_map):
        # add first
        requests.post(
            f"{API}/maps/{owned_map['id']}/editors",
            json={"email": "test_editor@example.com"},
            headers=_h(owner_session), timeout=15,
        )
        # Editor cannot remove
        r = requests.delete(
            f"{API}/maps/{owned_map['id']}/editors/test_editor@example.com",
            headers=_h(editor_session), timeout=15,
        )
        assert r.status_code == 404
        # Owner can remove
        r2 = requests.delete(
            f"{API}/maps/{owned_map['id']}/editors/test_editor@example.com",
            headers=_h(owner_session), timeout=15,
        )
        assert r2.status_code == 200
        assert "test_editor@example.com" not in r2.json()["editors"]

    def test_delete_nonexistent_editor_no_error(self, owner_session, owned_map):
        r = requests.delete(
            f"{API}/maps/{owned_map['id']}/editors/never_added@example.com",
            headers=_h(owner_session), timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json()["editors"], list)


# ============ Editor privileges after being added ============

@pytest.fixture
def shared_map(owner_session, mongo_db):
    body = _create_map(owner_session, name=f"TEST_shared_{uuid.uuid4().hex[:6]}")
    # Add editor
    requests.post(
        f"{API}/maps/{body['id']}/editors",
        json={"email": "test_editor@example.com"},
        headers=_h(owner_session), timeout=15,
    )
    yield body
    mongo_db.maps.delete_one({"id": body["id"]})


class TestEditorPrivileges:
    def test_editor_sees_map_in_list_with_is_owner_false(self, editor_session, shared_map):
        r = requests.get(f"{API}/maps", headers=_h(editor_session), timeout=15)
        assert r.status_code == 200
        found = [m for m in r.json()["maps"] if m["id"] == shared_map["id"]]
        assert len(found) == 1
        assert found[0]["is_owner"] is False

    def test_editor_get_map_is_owner_false(self, editor_session, shared_map):
        r = requests.get(f"{API}/maps/{shared_map['id']}", headers=_h(editor_session), timeout=15)
        assert r.status_code == 200
        assert r.json()["is_owner"] is False

    def test_owner_get_map_is_owner_true(self, owner_session, shared_map):
        r = requests.get(f"{API}/maps/{shared_map['id']}", headers=_h(owner_session), timeout=15)
        assert r.status_code == 200
        assert r.json()["is_owner"] is True

    def test_editor_can_patch(self, editor_session, shared_map):
        r = requests.patch(
            f"{API}/maps/{shared_map['id']}",
            json={"name": "TEST_edited_by_editor"},
            headers=_h(editor_session), timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_edited_by_editor"

    def test_stranger_cannot_patch(self, stranger_session, shared_map):
        r = requests.patch(
            f"{API}/maps/{shared_map['id']}",
            json={"name": "hacked"},
            headers=_h(stranger_session), timeout=15,
        )
        assert r.status_code == 404

    def test_editor_can_put_point_override(self, editor_session, shared_map):
        r = requests.put(
            f"{API}/maps/{shared_map['id']}/points/1",
            json={"overrides": {"note": "editor-added"}},
            headers=_h(editor_session), timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["point_overrides"]["1"] == {"note": "editor-added"}

    def test_editor_can_delete_point_override(self, editor_session, shared_map):
        # First add via editor
        requests.put(
            f"{API}/maps/{shared_map['id']}/points/2",
            json={"overrides": {"x": 1}},
            headers=_h(editor_session), timeout=15,
        )
        r = requests.delete(
            f"{API}/maps/{shared_map['id']}/points/2",
            headers=_h(editor_session), timeout=15,
        )
        assert r.status_code == 200

    def test_stranger_point_override_404(self, stranger_session, shared_map):
        r = requests.put(
            f"{API}/maps/{shared_map['id']}/points/0",
            json={"overrides": {"a": 1}},
            headers=_h(stranger_session), timeout=15,
        )
        assert r.status_code == 404

    def test_editor_cannot_delete_map(self, editor_session, shared_map):
        r = requests.delete(f"{API}/maps/{shared_map['id']}", headers=_h(editor_session), timeout=15)
        assert r.status_code == 404
        assert "not owned" in r.json()["detail"].lower() or "not found" in r.json()["detail"].lower()


# ============ Share endpoints owner-only ============

class TestShareEndpointsOwnerOnly:
    def test_editor_cannot_enable_share(self, owner_session, editor_session, shared_map):
        r = requests.post(f"{API}/maps/{shared_map['id']}/share", headers=_h(editor_session), timeout=15)
        assert r.status_code == 404

    def test_owner_can_enable_share(self, owner_session, shared_map):
        r = requests.post(f"{API}/maps/{shared_map['id']}/share", headers=_h(owner_session), timeout=15)
        assert r.status_code == 200
        assert r.json()["is_public"] is True

    def test_editor_cannot_rotate_share(self, editor_session, shared_map):
        r = requests.post(f"{API}/maps/{shared_map['id']}/share/rotate", headers=_h(editor_session), timeout=15)
        assert r.status_code == 404

    def test_editor_cannot_disable_share(self, editor_session, shared_map):
        r = requests.delete(f"{API}/maps/{shared_map['id']}/share", headers=_h(editor_session), timeout=15)
        assert r.status_code == 404


# ============ Regression: legacy maps without owner fields ============

class TestLegacyMapCompat:
    def test_legacy_map_is_owner_true_by_user_id(self, owner_session, mongo_db):
        """Maps created before iteration 6 don't have owner_email/editor_emails."""
        map_id = f"TEST_legacy_{uuid.uuid4().hex[:8]}"
        mongo_db.maps.insert_one({
            "id": map_id,
            "user_id": owner_session["user_id"],
            "name": "TEST_legacy",
            "file_id": "x", "file_name": "x.xlsx", "sheet_name": "Sheet1",
            "lat_column": "Lat", "lng_column": "Lng",
            "visible_columns": [], "header_row": 1, "first_col": 1,
            "point_overrides": {}, "is_public": False,
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
        })
        try:
            r = requests.get(f"{API}/maps/{map_id}", headers=_h(owner_session), timeout=15)
            assert r.status_code == 200
            assert r.json()["is_owner"] is True
        finally:
            mongo_db.maps.delete_one({"id": map_id})
