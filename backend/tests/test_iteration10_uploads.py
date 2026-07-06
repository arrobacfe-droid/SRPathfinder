"""
Iteration 10: uploads from device (.xlsx) and map source dispatch.
Endpoints under test:
  POST   /api/uploads/excel
  GET    /api/uploads/files
  DELETE /api/uploads/files/{upload_id}
  GET    /api/uploads/files/{upload_id}/sheets
  GET    /api/uploads/files/{upload_id}/sheets/{sheet_name}/preview
  GET    /api/uploads/files/{upload_id}/sheets/{sheet_name}/data
  POST   /api/maps (source='upload' / default 'onedrive')
  GET    /api/maps/{id}/data (source='upload' skips MS Graph)
"""
import io
import os
import uuid
import requests
import pytest
import openpyxl
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

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


# ============ Fixtures ============

@pytest.fixture(scope="module")
def mongo_db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


def _mk_session(mongo_db, label, email):
    sid = f"TEST_{label}_sess_{uuid.uuid4().hex}"
    uid = f"TEST_{label}_user_{uuid.uuid4().hex}"
    mongo_db.sessions.insert_one({
        "session_id": sid,
        "user_id": uid,
        "display_name": f"{label} Person",
        "email": email,
        "access_token": "TEST",
        "refresh_token": "TEST",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })
    return {"session_id": sid, "user_id": uid, "email": email}


@pytest.fixture(scope="module")
def owner_session(mongo_db):
    s = _mk_session(mongo_db, "up_owner", "TEST_up_owner@example.com")
    yield s
    mongo_db.sessions.delete_many({"session_id": s["session_id"]})
    mongo_db.uploads.delete_many({"user_id": s["user_id"]})
    mongo_db.maps.delete_many({"user_id": s["user_id"]})


@pytest.fixture(scope="module")
def other_session(mongo_db):
    s = _mk_session(mongo_db, "up_other", "TEST_up_other@example.com")
    yield s
    mongo_db.sessions.delete_many({"session_id": s["session_id"]})
    mongo_db.uploads.delete_many({"user_id": s["user_id"]})
    mongo_db.maps.delete_many({"user_id": s["user_id"]})


@pytest.fixture(scope="module")
def editor_session(mongo_db):
    s = _mk_session(mongo_db, "up_editor", "TEST_up_editor@example.com")
    yield s
    mongo_db.sessions.delete_many({"session_id": s["session_id"]})


def _headers(sess):
    return {"x-session-id": sess["session_id"]}


def _xlsx_bytes(sheets=None):
    """Create an xlsx file with the given {sheet_name: [[row], ...]} data."""
    if sheets is None:
        sheets = {
            "Datos": [
                ["Nombre", "Lat", "Lng"],
                ["A", 40.4, -3.7],
                ["B", 41.4, -2.2],
                ["C", 39.5, -0.4],
            ]
        }
    wb = openpyxl.Workbook()
    # Remove default sheet
    default = wb.active
    wb.remove(default)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture(scope="module")
def uploaded_file(owner_session):
    """Upload a valid xlsx and return its upload id."""
    data = _xlsx_bytes()
    files = {"file": ("TEST_data.xlsx",
                      data,
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = requests.post(f"{API}/uploads/excel", files=files,
                      headers=_headers(owner_session), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    return body


# ============ POST /api/uploads/excel ============

class TestUploadExcel:
    def test_upload_valid_xlsx(self, owner_session):
        data = _xlsx_bytes()
        files = {"file": ("TEST_valid.xlsx", data,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/uploads/excel", files=files,
                          headers=_headers(owner_session), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "id" in body and isinstance(body["id"], str)
        assert body["filename"] == "TEST_valid.xlsx"
        assert body["size"] == len(data)

    def test_upload_no_session(self):
        files = {"file": ("TEST_x.xlsx", _xlsx_bytes(),
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/uploads/excel", files=files, timeout=30)
        # 401 if header handling is normalized, 422 if FastAPI rejects missing header
        assert r.status_code in (401, 422)

    def test_upload_non_xlsx_extension(self, owner_session):
        files = {"file": ("TEST_bad.txt", b"hello world", "text/plain")}
        r = requests.post(f"{API}/uploads/excel", files=files,
                          headers=_headers(owner_session), timeout=30)
        assert r.status_code == 400

    def test_upload_empty_file(self, owner_session):
        files = {"file": ("TEST_empty.xlsx", b"",
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/uploads/excel", files=files,
                          headers=_headers(owner_session), timeout=30)
        assert r.status_code == 400

    def test_upload_corrupt_xlsx(self, owner_session):
        files = {"file": ("TEST_corrupt.xlsx", os.urandom(2048),
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/uploads/excel", files=files,
                          headers=_headers(owner_session), timeout=30)
        assert r.status_code == 400
        assert "Excel" in r.json().get("detail", "") or "inv" in r.json().get("detail", "").lower()

    def test_upload_too_large(self, owner_session):
        # 16MB blob - exceeds 15MB limit
        big = b"0" * (16 * 1024 * 1024)
        files = {"file": ("TEST_big.xlsx", big,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/uploads/excel", files=files,
                          headers=_headers(owner_session), timeout=60)
        assert r.status_code == 413


# ============ GET /api/uploads/files ============

class TestListUploads:
    def test_no_session(self):
        r = requests.get(f"{API}/uploads/files", timeout=15)
        assert r.status_code in (401, 422)

    def test_list_returns_own_uploads_without_data(self, owner_session, uploaded_file):
        r = requests.get(f"{API}/uploads/files",
                         headers=_headers(owner_session), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "files" in body
        ids = [f["id"] for f in body["files"]]
        assert uploaded_file["id"] in ids
        # No 'data' field leaked
        for f in body["files"]:
            assert "data" not in f

    def test_user_isolation(self, other_session, uploaded_file):
        r = requests.get(f"{API}/uploads/files",
                         headers=_headers(other_session), timeout=15)
        assert r.status_code == 200
        ids = [f["id"] for f in r.json()["files"]]
        assert uploaded_file["id"] not in ids


# ============ Sheets / Preview / Data ============

class TestUploadSheets:
    def test_sheets_list(self, owner_session, uploaded_file):
        r = requests.get(f"{API}/uploads/files/{uploaded_file['id']}/sheets",
                         headers=_headers(owner_session), timeout=15)
        assert r.status_code == 200
        assert "Datos" in r.json()["sheets"]

    def test_sheets_not_found(self, owner_session):
        bogus = str(uuid.uuid4())
        r = requests.get(f"{API}/uploads/files/{bogus}/sheets",
                         headers=_headers(owner_session), timeout=15)
        assert r.status_code == 404

    def test_preview_ok(self, owner_session, uploaded_file):
        r = requests.get(
            f"{API}/uploads/files/{uploaded_file['id']}/sheets/Datos/preview",
            params={"max_rows": 25, "max_cols": 20},
            headers=_headers(owner_session), timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        for k in ("grid", "rows", "cols", "suggested_header_row", "suggested_first_col"):
            assert k in body
        assert body["cols"] == 20
        assert body["suggested_header_row"] == 1
        assert body["suggested_first_col"] == 1

    def test_preview_sheet_not_found(self, owner_session, uploaded_file):
        r = requests.get(
            f"{API}/uploads/files/{uploaded_file['id']}/sheets/DoesNotExist/preview",
            headers=_headers(owner_session), timeout=15,
        )
        assert r.status_code == 404

    def test_data_ok(self, owner_session, uploaded_file):
        r = requests.get(
            f"{API}/uploads/files/{uploaded_file['id']}/sheets/Datos/data",
            params={"header_row": 1, "first_col": 1},
            headers=_headers(owner_session), timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["headers"] == ["Nombre", "Lat", "Lng"]
        assert body["row_count"] == 3
        assert body["suggested_lat_column"] == "Lat"
        assert body["suggested_lng_column"] == "Lng"

    def test_data_invalid_range(self, owner_session, uploaded_file):
        # header_row way past the end (only 4 rows total including header)
        r = requests.get(
            f"{API}/uploads/files/{uploaded_file['id']}/sheets/Datos/data",
            params={"header_row": 999, "first_col": 1},
            headers=_headers(owner_session), timeout=15,
        )
        assert r.status_code == 400


# ============ Maps CRUD with upload source ============

class TestMapCreateWithSource:
    def test_default_source_is_onedrive(self, owner_session, mongo_db):
        payload = {
            "name": "TEST_default_source",
            "file_id": "fake_od_id",
            "file_name": "TEST.xlsx",
            "sheet_name": "Datos",
            "lat_column": "Lat",
            "lng_column": "Lng",
        }
        r = requests.post(f"{API}/maps", json=payload,
                          headers=_headers(owner_session), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["source"] == "onedrive"
        mongo_db.maps.delete_one({"id": body["id"]})

    def test_explicit_onedrive(self, owner_session, mongo_db):
        payload = {
            "name": "TEST_od_source",
            "file_id": "fake_od_id",
            "file_name": "TEST.xlsx",
            "sheet_name": "Datos",
            "lat_column": "Lat",
            "lng_column": "Lng",
            "source": "onedrive",
        }
        r = requests.post(f"{API}/maps", json=payload,
                          headers=_headers(owner_session), timeout=15)
        assert r.status_code == 200
        assert r.json()["source"] == "onedrive"
        mongo_db.maps.delete_one({"id": r.json()["id"]})

    def test_upload_source_persists(self, owner_session, uploaded_file, mongo_db):
        payload = {
            "name": "TEST_upload_map",
            "file_id": uploaded_file["id"],
            "file_name": uploaded_file["filename"],
            "sheet_name": "Datos",
            "lat_column": "Lat",
            "lng_column": "Lng",
            "source": "upload",
        }
        r = requests.post(f"{API}/maps", json=payload,
                          headers=_headers(owner_session), timeout=15)
        assert r.status_code == 200
        m = r.json()
        assert m["source"] == "upload"
        # GET returns same source
        r2 = requests.get(f"{API}/maps/{m['id']}",
                          headers=_headers(owner_session), timeout=15)
        assert r2.status_code == 200
        assert r2.json()["source"] == "upload"
        mongo_db.maps.delete_one({"id": m["id"]})


# ============ /maps/{id}/data with upload source ============

class TestMapDataFromUpload:
    def test_map_data_from_upload_no_ms_graph(self, owner_session, uploaded_file, mongo_db):
        payload = {
            "name": "TEST_upload_data_map",
            "file_id": uploaded_file["id"],
            "file_name": uploaded_file["filename"],
            "sheet_name": "Datos",
            "lat_column": "Lat",
            "lng_column": "Lng",
            "source": "upload",
        }
        r = requests.post(f"{API}/maps", json=payload,
                          headers=_headers(owner_session), timeout=15)
        assert r.status_code == 200
        map_id = r.json()["id"]

        # Confirm the owner's access_token is 'TEST' (fake) — this call would fail if it
        # tried to reach Graph. Successful load proves the source='upload' branch is used.
        r2 = requests.get(f"{API}/maps/{map_id}/data",
                          headers=_headers(owner_session), timeout=30)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["headers"] == ["Nombre", "Lat", "Lng"]
        assert body["lat_column"] == "Lat"
        assert body["lng_column"] == "Lng"
        rows = body["rows"]
        assert len(rows) == 3
        assert rows[0]["lat"] == 40.4
        assert rows[0]["lng"] == -3.7

        mongo_db.maps.delete_one({"id": map_id})

    def test_editor_can_access_uploaded_map(self, owner_session, editor_session,
                                            uploaded_file, mongo_db):
        # Create map owned by owner_session
        payload = {
            "name": "TEST_upload_editor_map",
            "file_id": uploaded_file["id"],
            "file_name": uploaded_file["filename"],
            "sheet_name": "Datos",
            "lat_column": "Lat",
            "lng_column": "Lng",
            "source": "upload",
        }
        r = requests.post(f"{API}/maps", json=payload,
                          headers=_headers(owner_session), timeout=15)
        assert r.status_code == 200
        map_id = r.json()["id"]
        # Add editor
        r_add = requests.post(f"{API}/maps/{map_id}/editors",
                              json={"email": editor_session["email"]},
                              headers=_headers(owner_session), timeout=15)
        assert r_add.status_code == 200, r_add.text

        # Editor can GET and access data
        r_get = requests.get(f"{API}/maps/{map_id}",
                             headers=_headers(editor_session), timeout=15)
        assert r_get.status_code == 200
        r_data = requests.get(f"{API}/maps/{map_id}/data",
                              headers=_headers(editor_session), timeout=30)
        assert r_data.status_code == 200, r_data.text
        assert len(r_data.json()["rows"]) == 3

        mongo_db.maps.delete_one({"id": map_id})


# ============ DELETE /api/uploads/files/{id} ============

class TestDeleteUpload:
    def test_delete_other_users_upload_returns_404(self, other_session, uploaded_file):
        r = requests.delete(f"{API}/uploads/files/{uploaded_file['id']}",
                            headers=_headers(other_session), timeout=15)
        assert r.status_code == 404

    def test_delete_own_upload(self, owner_session):
        # Create a fresh upload for deletion
        data = _xlsx_bytes()
        files = {"file": ("TEST_delete.xlsx", data,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{API}/uploads/excel", files=files,
                          headers=_headers(owner_session), timeout=15)
        assert r.status_code == 200
        uid = r.json()["id"]

        # Delete
        r_del = requests.delete(f"{API}/uploads/files/{uid}",
                                headers=_headers(owner_session), timeout=15)
        assert r_del.status_code == 200
        assert r_del.json() == {"ok": True}

        # Verify gone from listing
        r_list = requests.get(f"{API}/uploads/files",
                              headers=_headers(owner_session), timeout=15)
        assert uid not in [f["id"] for f in r_list.json()["files"]]
