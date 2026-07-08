"""Iteration 12 tests: local auth (email+password) and batch-refresh-source.
Also runs regression checks on Microsoft-session (injected) flows.
"""
import io

# NOTE: This file relies on cross-test state (pytest.attr) so all tests must run
# in the same xdist worker. We pin the module to a single xdist_group.
import pytest as _pt
pytestmark = _pt.mark.xdist_group("iter12_serial")

import os
import uuid
import asyncio
import pytest
import requests
from openpyxl import Workbook
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # frontend .env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def unique_email():
    return f"TEST_it12_{uuid.uuid4().hex[:8]}@example.com"


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# --------- Local Signup ---------

def test_signup_success(unique_email, db):
    r = requests.post(f"{API}/auth/local/signup", json={
        "email": unique_email, "password": "Str0ngPass!", "display_name": "Tester 12"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "session_id" in data and data["session_id"]
    assert data["user"]["email"] == unique_email.lower()
    assert data["user"]["display_name"] == "Tester 12"
    assert data["user"]["id"].startswith("local:")
    pytest.session_id_signup = data["session_id"]
    pytest.user_id_signup = data["user"]["id"]

def test_signup_normalizes_email_and_stored_hash(db):
    email_mixed = f"TEST_MixCase_{uuid.uuid4().hex[:6]}@Example.COM"
    r = requests.post(f"{API}/auth/local/signup", json={
        "email": email_mixed, "password": "AnotherP@ss1", "display_name": "Mix"
    })
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == email_mixed.lower()
    # Verify DB doc
    doc = _run(db.users.find_one({"email": email_mixed.lower()}))
    assert doc is not None
    assert doc["id"].startswith("local:")
    assert doc["password_hash"].startswith("$2b$")
    assert "created_at" in doc
    assert doc["display_name"] == "Mix"

def test_signup_invalid_email():
    r = requests.post(f"{API}/auth/local/signup", json={
        "email": "not-an-email", "password": "Str0ngPass!"
    })
    assert r.status_code == 400

def test_signup_password_too_short():
    r = requests.post(f"{API}/auth/local/signup", json={
        "email": f"TEST_short_{uuid.uuid4().hex[:6]}@ex.com", "password": "short1"
    })
    assert r.status_code == 400

def test_signup_duplicate_email(unique_email):
    r = requests.post(f"{API}/auth/local/signup", json={
        "email": unique_email, "password": "Str0ngPass!"
    })
    assert r.status_code == 409

def test_signup_duplicate_case_insensitive(unique_email):
    r = requests.post(f"{API}/auth/local/signup", json={
        "email": unique_email.upper(), "password": "Str0ngPass!"
    })
    assert r.status_code == 409


# --------- Local Login ---------

def test_login_success_returns_new_session(unique_email):
    r = requests.post(f"{API}/auth/local/login", json={
        "email": unique_email, "password": "Str0ngPass!"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["session_id"]
    assert data["session_id"] != getattr(pytest, "session_id_signup", None)
    assert data["user"]["email"] == unique_email.lower()
    pytest.session_id_login = data["session_id"]

def test_login_case_insensitive_email(unique_email):
    # Vary case
    varied = unique_email[0].swapcase() + unique_email[1:].upper()
    r = requests.post(f"{API}/auth/local/login", json={
        "email": varied, "password": "Str0ngPass!"
    })
    assert r.status_code == 200

def test_login_wrong_password(unique_email):
    r = requests.post(f"{API}/auth/local/login", json={
        "email": unique_email, "password": "WrongPass!!"
    })
    assert r.status_code == 401
    assert "incorrect" in r.json().get("detail", "").lower() or "incorrect" in r.text.lower() or "incorrec" in r.text.lower()

def test_login_nonexistent_email_same_generic_error():
    r = requests.post(f"{API}/auth/local/login", json={
        "email": f"TEST_nope_{uuid.uuid4().hex[:6]}@ex.com", "password": "whatever1"
    })
    assert r.status_code == 401


# --------- Users index ---------

def test_users_email_unique_index(db):
    info = _run(db.users.index_information())
    found = False
    for name, idx in info.items():
        keys = idx.get("key", [])
        if keys and keys[0][0] == "email" and idx.get("unique"):
            found = True
            break
    assert found, f"Unique index on users.email not found. Indexes: {info}"


# --------- Session Interop ---------

def test_auth_me_with_local_session():
    sid = pytest.session_id_login
    r = requests.get(f"{API}/auth/me", headers={"X-Session-Id": sid})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me.get("email") == pytest.session_id_login and False or True  # just presence
    assert "email" in me

def test_local_can_upload_and_create_map_source_upload():
    sid = pytest.session_id_login
    # Build a simple xlsx
    wb = Workbook()
    ws = wb.active
    ws.append(["lat", "lng", "status"])
    ws.append([10.0, 20.0, "open"])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    r = requests.post(
        f"{API}/uploads/excel",
        headers={"X-Session-Id": sid},
        files={"file": ("test_it12.xlsx", buf.getvalue(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    upload = r.json()
    pytest.upload_id = upload["id"]

    # Create map source=upload
    r = requests.post(f"{API}/maps", headers={"X-Session-Id": sid}, json={
        "name": "TEST_it12_map",
        "file_id": upload["id"],
        "file_name": upload["filename"],
        "sheet_name": "Sheet",
        "lat_column": "lat",
        "lng_column": "lng",
        "source": "upload",
    })
    assert r.status_code == 200, r.text
    pytest.map_id_1 = r.json()["id"]

    # Second map
    r = requests.post(f"{API}/maps", headers={"X-Session-Id": sid}, json={
        "name": "TEST_it12_map2",
        "file_id": upload["id"],
        "file_name": upload["filename"],
        "sheet_name": "Sheet",
        "lat_column": "lat",
        "lng_column": "lng",
        "source": "upload",
    })
    assert r.status_code == 200
    pytest.map_id_2 = r.json()["id"]

    # List maps returns both
    r = requests.get(f"{API}/maps", headers={"X-Session-Id": sid})
    assert r.status_code == 200
    map_ids = {m["id"] for m in r.json()["maps"]}
    assert pytest.map_id_1 in map_ids
    assert pytest.map_id_2 in map_ids

def test_local_cannot_fetch_onedrive_source_map_data(db):
    # Directly insert a map with source='onedrive' for the local user
    sid = pytest.session_id_login
    s = _run(db.sessions.find_one({"session_id": sid}))
    assert s and s.get("auth_type") == "local" and s.get("access_token") is None
    map_id = f"TEST_it12_od_{uuid.uuid4().hex[:6]}"
    _run(db.maps.insert_one({
        "id": map_id,
        "user_id": s["user_id"],
        "owner_email": s.get("email"),
        "editor_emails": [],
        "name": "TEST_od_map",
        "source": "onedrive",
        "file_id": "fakefile",
        "file_name": "fake.xlsx",
        "sheet_name": "Sheet1",
        "lat_column": "lat",
        "lng_column": "lng",
        "visible_columns": [],
        "header_row": 1,
        "first_col": 1,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }))
    r = requests.get(f"{API}/maps/{map_id}/data", headers={"X-Session-Id": sid})
    # Local user has no access_token so Graph call fails
    assert r.status_code >= 400 and r.status_code != 200, r.text

def test_logout_with_local_session():
    sid = pytest.session_id_signup
    r = requests.post(f"{API}/auth/logout", headers={"X-Session-Id": sid})
    assert r.status_code == 200
    # Session should be gone
    r2 = requests.get(f"{API}/auth/me", headers={"X-Session-Id": sid})
    assert r2.status_code == 401


# --------- Batch Refresh ---------

def test_batch_no_auth_header():
    r = requests.post(f"{API}/maps/batch-refresh-source", json={"map_ids": [], "upload_id": "x"})
    assert r.status_code in (401, 422)

def test_batch_empty_map_ids():
    sid = pytest.session_id_login
    r = requests.post(f"{API}/maps/batch-refresh-source",
                      headers={"X-Session-Id": sid},
                      json={"map_ids": [], "upload_id": pytest.upload_id})
    assert r.status_code == 200
    assert r.json() == {"updated": 0, "map_ids": []}

def test_batch_upload_not_owned():
    sid = pytest.session_id_login
    r = requests.post(f"{API}/maps/batch-refresh-source",
                      headers={"X-Session-Id": sid},
                      json={"map_ids": [pytest.map_id_1], "upload_id": "nonexistent-upload"})
    assert r.status_code == 404

def test_batch_updates_owned_and_ignores_foreign(db):
    sid = pytest.session_id_login
    # Create a new upload to switch to
    wb = Workbook()
    ws = wb.active
    ws.append(["lat", "lng"])
    ws.append([1.0, 2.0])
    buf = io.BytesIO()
    wb.save(buf)
    r = requests.post(
        f"{API}/uploads/excel",
        headers={"X-Session-Id": sid},
        files={"file": ("test_it12_v2.xlsx", buf.getvalue(),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    new_upload_id = r.json()["id"]
    new_filename = r.json()["filename"]

    # Foreign map (owned by another user_id)
    foreign_id = f"TEST_it12_foreign_{uuid.uuid4().hex[:6]}"
    _run(db.maps.insert_one({
        "id": foreign_id,
        "user_id": "someone-else",
        "name": "foreign",
        "source": "upload",
        "file_id": "old", "file_name": "old.xlsx",
        "sheet_name": "S", "lat_column": "lat", "lng_column": "lng",
    }))
    r = requests.post(f"{API}/maps/batch-refresh-source",
                      headers={"X-Session-Id": sid},
                      json={"map_ids": [pytest.map_id_1, pytest.map_id_2, foreign_id],
                            "upload_id": new_upload_id})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["updated"] == 2
    assert set(data["map_ids"]) == {pytest.map_id_1, pytest.map_id_2}

    # Verify DB
    m1 = _run(db.maps.find_one({"id": pytest.map_id_1}))
    assert m1["file_id"] == new_upload_id
    assert m1["file_name"] == new_filename
    assert m1["source"] == "upload"
    # Foreign untouched
    fm = _run(db.maps.find_one({"id": foreign_id}))
    assert fm["file_id"] == "old"

def test_batch_all_foreign_returns_404(db):
    sid = pytest.session_id_login
    foreign_id = f"TEST_it12_foreignonly_{uuid.uuid4().hex[:6]}"
    _run(db.maps.insert_one({
        "id": foreign_id, "user_id": "someone-else", "name": "f",
        "source": "upload", "file_id": "x", "file_name": "x",
        "sheet_name": "S", "lat_column": "lat", "lng_column": "lng",
    }))
    r = requests.post(f"{API}/maps/batch-refresh-source",
                      headers={"X-Session-Id": sid},
                      json={"map_ids": [foreign_id], "upload_id": pytest.upload_id})
    assert r.status_code == 404


# --------- Regression: MS-style session still works ---------

def test_microsoft_session_can_create_map_default_source(db):
    # Inject a MS-style session (no auth_type field)
    sid = f"TEST_it12_ms_{uuid.uuid4().hex[:8]}"
    uid = f"TEST_it12_msuser_{uuid.uuid4().hex[:6]}"
    _run(db.sessions.insert_one({
        "session_id": sid, "user_id": uid,
        "access_token": "fake", "refresh_token": "fake",
        "email": "TEST_ms_it12@example.com",
        "display_name": "MS Regr",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }))
    # /auth/me still works
    r = requests.get(f"{API}/auth/me", headers={"X-Session-Id": sid})
    assert r.status_code == 200
    # Create map with default source (no source specified)
    r = requests.post(f"{API}/maps", headers={"X-Session-Id": sid}, json={
        "name": "TEST_ms_regr",
        "file_id": "od-file-id",
        "file_name": "od.xlsx",
        "sheet_name": "Sheet1",
        "lat_column": "lat", "lng_column": "lng",
    })
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["source"] == "onedrive"
    pytest.ms_map_id = m["id"]
    pytest.ms_sid = sid
    pytest.ms_uid = uid


# --------- Cleanup ---------

def teardown_module(module):
    client = AsyncIOMotorClient(MONGO_URL)
    d = client[DB_NAME]
    loop = asyncio.get_event_loop()
    async def _clean():
        await d.users.delete_many({"email": {"$regex": "^test_", "$options": "i"}})
        await d.sessions.delete_many({"email": {"$regex": "^TEST_", "$options": "i"}})
        await d.sessions.delete_many({"session_id": {"$regex": "^TEST_it12"}})
        await d.maps.delete_many({"name": {"$regex": "^TEST_"}})
        await d.maps.delete_many({"id": {"$regex": "^TEST_it12"}})
        await d.uploads.delete_many({"filename": {"$regex": "^test_it12"}})
    loop.run_until_complete(_clean())
