from fastapi import FastAPI, APIRouter, HTTPException, Header, Body
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import uuid
import logging
import httpx
import openpyxl
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
CLIENT_ID = os.environ['MS_CLIENT_ID']
CLIENT_SECRET = os.environ['MS_CLIENT_SECRET']
TENANT_ID = os.environ.get('MS_TENANT_ID', 'common')
REDIRECT_URI = os.environ['MS_REDIRECT_URI']

SCOPES = "offline_access User.Read Files.Read Files.Read.All"
GRAPH = "https://graph.microsoft.com/v1.0"
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============ Helpers ============

def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def get_session(session_id: str) -> dict:
    if not session_id:
        raise HTTPException(status_code=401, detail="Missing session")
    s = await db.sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=401, detail="Invalid session")
    return s


async def refresh_token_if_needed(session: dict) -> str:
    """Refresh access token using stored refresh token."""
    async with httpx.AsyncClient() as http:
        resp = await http.post(
            f"{AUTHORITY}/oauth2/v2.0/token",
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "refresh_token": session.get("refresh_token", ""),
                "grant_type": "refresh_token",
                "scope": SCOPES,
            },
            timeout=30,
        )
        data = resp.json()
        if "access_token" not in data:
            raise HTTPException(status_code=401, detail=f"Token refresh failed: {data}")
        await db.sessions.update_one(
            {"session_id": session["session_id"]},
            {"$set": {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token", session.get("refresh_token")),
                "updated_at": now_iso(),
            }},
        )
        return data["access_token"]


async def graph_get(session: dict, url: str, params: dict = None, stream_bytes: bool = False):
    """GET MS Graph with auto-refresh on 401."""
    token = session["access_token"]
    async with httpx.AsyncClient() as http:
        headers = {"Authorization": f"Bearer {token}"}
        resp = await http.get(url, headers=headers, params=params, follow_redirects=True, timeout=60)
        if resp.status_code == 401:
            token = await refresh_token_if_needed(session)
            headers["Authorization"] = f"Bearer {token}"
            resp = await http.get(url, headers=headers, params=params, follow_redirects=True, timeout=60)
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail=f"Graph error: {resp.text}")
        return resp.content if stream_bytes else resp.json()


# ============ Models ============

class MapCreate(BaseModel):
    name: str
    file_id: str
    file_name: str
    sheet_name: str
    visible_columns: List[str] = []


class MapUpdate(BaseModel):
    name: Optional[str] = None
    visible_columns: Optional[List[str]] = None


class PointEdit(BaseModel):
    overrides: Dict[str, Any]


# ============ Auth ============

@api_router.get("/auth/microsoft/url")
async def microsoft_auth_url():
    state = str(uuid.uuid4())
    await db.oauth_states.insert_one({"state": state, "created_at": now_iso()})
    url = (
        f"{AUTHORITY}/oauth2/v2.0/authorize"
        f"?client_id={CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={REDIRECT_URI}"
        f"&response_mode=query"
        f"&scope={SCOPES}"
        f"&state={state}"
    )
    return {"url": url, "state": state}


@api_router.post("/auth/microsoft/callback")
async def microsoft_callback(payload: dict = Body(...)):
    code = payload.get("code")
    state = payload.get("state")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code/state")

    state_doc = await db.oauth_states.find_one({"state": state})
    if not state_doc:
        raise HTTPException(status_code=400, detail="Invalid state")
    await db.oauth_states.delete_one({"state": state})

    async with httpx.AsyncClient() as http:
        resp = await http.post(
            f"{AUTHORITY}/oauth2/v2.0/token",
            data={
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code",
                "scope": SCOPES,
            },
            timeout=30,
        )
        data = resp.json()
        if "access_token" not in data:
            raise HTTPException(status_code=400, detail=f"Token exchange failed: {data}")

    # Fetch user profile
    me_resp = None
    async with httpx.AsyncClient() as http:
        me_resp = await http.get(
            f"{GRAPH}/me",
            headers={"Authorization": f"Bearer {data['access_token']}"},
            timeout=30,
        )
    me = me_resp.json() if me_resp.status_code == 200 else {}

    session_id = str(uuid.uuid4())
    user_id = me.get("id") or session_id
    session_doc = {
        "session_id": session_id,
        "user_id": user_id,
        "display_name": me.get("displayName"),
        "email": me.get("userPrincipalName") or me.get("mail"),
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.sessions.insert_one(session_doc)
    return {
        "session_id": session_id,
        "user": {
            "id": user_id,
            "display_name": session_doc["display_name"],
            "email": session_doc["email"],
        },
    }


@api_router.get("/auth/me")
async def auth_me(x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    return {
        "id": s.get("user_id"),
        "display_name": s.get("display_name"),
        "email": s.get("email"),
    }


@api_router.post("/auth/logout")
async def auth_logout(x_session_id: str = Header(...)):
    await db.sessions.delete_one({"session_id": x_session_id})
    return {"ok": True}


# ============ OneDrive Excel ============

@api_router.get("/onedrive/files")
async def list_excel_files(x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    # Search top-level .xlsx files
    data = await graph_get(s, f"{GRAPH}/me/drive/root/search(q='.xlsx')")
    files = data.get("value", [])
    out = []
    for f in files:
        name = f.get("name", "")
        if not name.lower().endswith(".xlsx"):
            continue
        out.append({
            "id": f["id"],
            "name": name,
            "size": f.get("size"),
            "modified": f.get("lastModifiedDateTime"),
            "web_url": f.get("webUrl"),
        })
    return {"files": out}


async def _load_workbook(session: dict, item_id: str) -> openpyxl.Workbook:
    content = await graph_get(session, f"{GRAPH}/me/drive/items/{item_id}/content", stream_bytes=True)
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    return wb


@api_router.get("/onedrive/files/{item_id}/sheets")
async def list_sheets(item_id: str, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    wb = await _load_workbook(s, item_id)
    return {"sheets": wb.sheetnames}


@api_router.get("/onedrive/files/{item_id}/sheets/{sheet_name}/data")
async def sheet_data(item_id: str, sheet_name: str, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    wb = await _load_workbook(s, item_id)
    if sheet_name not in wb.sheetnames:
        raise HTTPException(status_code=404, detail="Sheet not found")
    ws = wb[sheet_name]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        headers_row = next(rows_iter)
    except StopIteration:
        return {"headers": [], "rows": []}

    headers = [str(h) if h is not None else f"col_{i}" for i, h in enumerate(headers_row)]
    if len(headers) < 2:
        raise HTTPException(status_code=400, detail="Sheet needs at least 2 columns (lat, lng)")

    rows = []
    for idx, row in enumerate(rows_iter):
        # Pad row
        vals = list(row) + [None] * (len(headers) - len(row))
        vals = vals[:len(headers)]
        # Last two are lat/lng
        try:
            lat = float(vals[-2]) if vals[-2] is not None and str(vals[-2]).strip() != "" else None
            lng = float(vals[-1]) if vals[-1] is not None and str(vals[-1]).strip() != "" else None
        except (ValueError, TypeError):
            lat, lng = None, None

        data_dict = {}
        for h, v in zip(headers, vals):
            if isinstance(v, datetime):
                v = v.isoformat()
            data_dict[h] = v
        rows.append({
            "row_index": idx,
            "lat": lat,
            "lng": lng,
            "data": data_dict,
        })
    return {
        "headers": headers,
        "lat_column": headers[-2],
        "lng_column": headers[-1],
        "rows": rows,
    }


# ============ Maps CRUD ============

@api_router.post("/maps")
async def create_map(payload: MapCreate, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    map_id = str(uuid.uuid4())
    doc = {
        "id": map_id,
        "user_id": s["user_id"],
        "name": payload.name,
        "file_id": payload.file_id,
        "file_name": payload.file_name,
        "sheet_name": payload.sheet_name,
        "visible_columns": payload.visible_columns,
        "point_overrides": {},  # row_index (str) -> {col: value}
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.maps.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/maps")
async def list_maps(x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    items = await db.maps.find({"user_id": s["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"maps": items}


@api_router.get("/maps/{map_id}")
async def get_map(map_id: str, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    m = await db.maps.find_one({"id": map_id, "user_id": s["user_id"]}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    return m


@api_router.patch("/maps/{map_id}")
async def update_map(map_id: str, payload: MapUpdate, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates")
    updates["updated_at"] = now_iso()
    res = await db.maps.update_one({"id": map_id, "user_id": s["user_id"]}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Map not found")
    m = await db.maps.find_one({"id": map_id}, {"_id": 0})
    return m


@api_router.delete("/maps/{map_id}")
async def delete_map(map_id: str, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    res = await db.maps.delete_one({"id": map_id, "user_id": s["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Map not found")
    return {"ok": True}


@api_router.put("/maps/{map_id}/points/{row_index}")
async def update_point(map_id: str, row_index: int, payload: PointEdit, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    m = await db.maps.find_one({"id": map_id, "user_id": s["user_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    key = f"point_overrides.{row_index}"
    await db.maps.update_one(
        {"id": map_id},
        {"$set": {key: payload.overrides, "updated_at": now_iso()}},
    )
    updated = await db.maps.find_one({"id": map_id}, {"_id": 0})
    return updated


@api_router.delete("/maps/{map_id}/points/{row_index}")
async def reset_point(map_id: str, row_index: int, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    m = await db.maps.find_one({"id": map_id, "user_id": s["user_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    key = f"point_overrides.{row_index}"
    await db.maps.update_one({"id": map_id}, {"$unset": {key: ""}, "$set": {"updated_at": now_iso()}})
    updated = await db.maps.find_one({"id": map_id}, {"_id": 0})
    return updated


@api_router.get("/maps/{map_id}/data")
async def map_data(map_id: str, x_session_id: str = Header(...)):
    """Combine map config with live Excel data + overrides applied."""
    s = await get_session(x_session_id)
    m = await db.maps.find_one({"id": map_id, "user_id": s["user_id"]}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    wb = await _load_workbook(s, m["file_id"])
    if m["sheet_name"] not in wb.sheetnames:
        raise HTTPException(status_code=404, detail="Sheet no longer exists in workbook")
    ws = wb[m["sheet_name"]]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        headers_row = next(rows_iter)
    except StopIteration:
        return {"map": m, "headers": [], "rows": []}
    headers = [str(h) if h is not None else f"col_{i}" for i, h in enumerate(headers_row)]
    overrides = m.get("point_overrides", {}) or {}
    rows = []
    for idx, row in enumerate(rows_iter):
        vals = list(row) + [None] * (len(headers) - len(row))
        vals = vals[:len(headers)]
        try:
            lat = float(vals[-2]) if vals[-2] is not None and str(vals[-2]).strip() != "" else None
            lng = float(vals[-1]) if vals[-1] is not None and str(vals[-1]).strip() != "" else None
        except (ValueError, TypeError):
            lat, lng = None, None
        data_dict = {}
        for h, v in zip(headers, vals):
            if isinstance(v, datetime):
                v = v.isoformat()
            data_dict[h] = v
        # Apply overrides (excluding lat/lng changes — location not editable)
        ov = overrides.get(str(idx)) or {}
        for k, v in ov.items():
            if k in (headers[-2], headers[-1]):
                continue
            data_dict[k] = v
        rows.append({
            "row_index": idx,
            "lat": lat,
            "lng": lng,
            "data": data_dict,
            "edited": bool(ov),
        })
    return {
        "map": m,
        "headers": headers,
        "lat_column": headers[-2],
        "lng_column": headers[-1],
        "rows": rows,
    }


@api_router.get("/")
async def root():
    return {"message": "Excel Maps API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
