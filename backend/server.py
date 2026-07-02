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
    lat_column: str
    lng_column: str
    visible_columns: List[str] = []
    header_row: int = 1  # 1-indexed row that contains headers
    first_col: int = 1   # 1-indexed first column to consider
    status_column: Optional[str] = None
    status_visible_values: List[str] = []


class MapUpdate(BaseModel):
    name: Optional[str] = None
    visible_columns: Optional[List[str]] = None
    lat_column: Optional[str] = None
    lng_column: Optional[str] = None
    header_row: Optional[int] = None
    first_col: Optional[int] = None
    status_column: Optional[str] = None
    status_visible_values: Optional[List[str]] = None


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
    seen = {}

    # 1) Root children (top-level files in OneDrive root)
    try:
        data = await graph_get(s, f"{GRAPH}/me/drive/root/children", params={"$top": "200"})
        for f in data.get("value", []):
            name = f.get("name", "")
            if name.lower().endswith(".xlsx") and "file" in f:
                seen[f["id"]] = f
    except HTTPException as e:
        logger.warning(f"root/children failed: {e.detail}")

    # 2) Full-drive search (indexed, includes subfolders)
    try:
        data = await graph_get(s, f"{GRAPH}/me/drive/root/search(q='.xlsx')")
        for f in data.get("value", []):
            name = f.get("name", "")
            if name.lower().endswith(".xlsx") and "file" in f:
                seen[f["id"]] = f
    except HTTPException as e:
        logger.warning(f"search failed: {e.detail}")

    # 3) Recent files (catches files opened recently, even shared)
    try:
        data = await graph_get(s, f"{GRAPH}/me/drive/recent", params={"$top": "50"})
        for f in data.get("value", []):
            name = f.get("name", "")
            if name.lower().endswith(".xlsx") and "file" in f:
                seen.setdefault(f["id"], f)
    except HTTPException as e:
        logger.warning(f"recent failed: {e.detail}")

    files = [
        {
            "id": f["id"],
            "name": f.get("name", ""),
            "size": f.get("size"),
            "modified": f.get("lastModifiedDateTime"),
            "web_url": f.get("webUrl"),
            "path": (f.get("parentReference") or {}).get("path"),
        }
        for f in seen.values()
    ]
    files.sort(key=lambda x: x.get("modified") or "", reverse=True)
    return {"files": files, "count": len(files)}


async def _load_workbook(session: dict, item_id: str) -> openpyxl.Workbook:
    content = await graph_get(session, f"{GRAPH}/me/drive/items/{item_id}/content", stream_bytes=True)
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    return wb


@api_router.get("/onedrive/files/{item_id}/sheets")
async def list_sheets(item_id: str, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    wb = await _load_workbook(s, item_id)
    return {"sheets": wb.sheetnames}


def _parse_sheet(
    ws,
    header_row: int = 1,
    first_col: int = 1,
):
    """Read sheet with configurable start row/col. Returns (headers, data_rows).
    header_row is 1-indexed; first_col is 1-indexed.
    """
    header_row = max(1, header_row)
    first_col = max(1, first_col)
    all_rows = list(ws.iter_rows(values_only=True))
    if len(all_rows) < header_row:
        return [], []
    header_line = all_rows[header_row - 1]
    # Slice from first_col-1 and drop trailing None headers
    header_slice = list(header_line)[first_col - 1:]
    # Trim trailing empty header cells
    while header_slice and (header_slice[-1] is None or str(header_slice[-1]).strip() == ""):
        header_slice.pop()
    headers = [str(h) if h is not None else f"col_{i}" for i, h in enumerate(header_slice)]

    data_rows = []
    for r in all_rows[header_row:]:
        row_slice = list(r)[first_col - 1: first_col - 1 + len(headers)]
        vals = row_slice + [None] * (len(headers) - len(row_slice))
        # Skip rows that are entirely empty
        if all(v is None or (isinstance(v, str) and v.strip() == "") for v in vals):
            continue
        data_rows.append(vals)
    return headers, data_rows


@api_router.get("/onedrive/files/{item_id}/sheets/{sheet_name}/data")
async def sheet_data(
    item_id: str,
    sheet_name: str,
    header_row: int = 1,
    first_col: int = 1,
    x_session_id: str = Header(...),
):
    s = await get_session(x_session_id)
    wb = await _load_workbook(s, item_id)
    if sheet_name not in wb.sheetnames:
        raise HTTPException(status_code=404, detail="Sheet not found")
    ws = wb[sheet_name]
    headers, data_rows = _parse_sheet(ws, header_row=header_row, first_col=first_col)

    if not headers:
        raise HTTPException(status_code=400, detail="La hoja no tiene columnas en el rango indicado.")

    sample_rows = []
    for vals in data_rows[:3]:
        d = {}
        for h, v in zip(headers, vals):
            if isinstance(v, datetime):
                v = v.isoformat()
            d[h] = v
        sample_rows.append(d)

    lat_candidates = [h for h in headers if any(k in h.lower() for k in ["lat", "latitud"])]
    lng_candidates = [h for h in headers if any(k in h.lower() for k in ["lon", "lng", "longitud"])]
    suggested_lat = lat_candidates[0] if lat_candidates else (headers[-2] if len(headers) >= 2 else None)
    suggested_lng = lng_candidates[0] if lng_candidates else (headers[-1] if len(headers) >= 1 else None)

    return {
        "headers": headers,
        "sample_rows": sample_rows,
        "suggested_lat_column": suggested_lat,
        "suggested_lng_column": suggested_lng,
        "row_count": len(data_rows),
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
        "lat_column": payload.lat_column,
        "lng_column": payload.lng_column,
        "visible_columns": payload.visible_columns,
        "header_row": payload.header_row,
        "first_col": payload.first_col,
        "status_column": payload.status_column,
        "status_visible_values": payload.status_visible_values,
        "point_overrides": {},
        "is_public": False,
        "share_token": None,
        "cached_rows": [],
        "cached_at": None,
        "cached_headers": [],
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


def _build_map_rows(headers, data_rows, m):
    """Given headers + raw data_rows (list of lists) + map doc, build normalized rows."""
    lat_col = m.get("lat_column")
    lng_col = m.get("lng_column")
    status_col = m.get("status_column")
    status_visible = set(m.get("status_visible_values") or [])
    # Backwards-compat fallback
    if (not lat_col or lat_col not in headers) and len(headers) >= 2:
        lat_col = headers[-2]
    if (not lng_col or lng_col not in headers) and len(headers) >= 1:
        lng_col = headers[-1]
    if lat_col not in headers or lng_col not in headers:
        raise HTTPException(
            status_code=400,
            detail=f"Columnas de coordenadas ({lat_col}, {lng_col}) no encontradas. Disponibles: {headers}",
        )
    lat_idx = headers.index(lat_col)
    lng_idx = headers.index(lng_col)
    overrides = m.get("point_overrides", {}) or {}
    rows = []
    for idx, vals in enumerate(data_rows):
        try:
            lat_raw = vals[lat_idx]
            lat = float(lat_raw) if lat_raw is not None and str(lat_raw).strip() != "" else None
        except (ValueError, TypeError):
            lat = None
        try:
            lng_raw = vals[lng_idx]
            lng = float(lng_raw) if lng_raw is not None and str(lng_raw).strip() != "" else None
        except (ValueError, TypeError):
            lng = None
        data_dict = {}
        for h, v in zip(headers, vals):
            if isinstance(v, datetime):
                v = v.isoformat()
            data_dict[h] = v
        ov = overrides.get(str(idx)) or {}
        for k, v in ov.items():
            if k in (lat_col, lng_col):
                continue
            data_dict[k] = v
        # Status-based visibility
        is_visible = True
        if status_col and status_col in headers:
            status_val = data_dict.get(status_col)
            status_str = "" if status_val is None else str(status_val)
            # If no status_visible values configured, everything is visible
            if status_visible:
                is_visible = status_str in status_visible
        rows.append({
            "row_index": idx,
            "lat": lat,
            "lng": lng,
            "data": data_dict,
            "edited": bool(ov),
            "visible": is_visible,
        })
    return rows, lat_col, lng_col


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
    header_row = m.get("header_row") or 1
    first_col = m.get("first_col") or 1
    headers, data_rows = _parse_sheet(ws, header_row=header_row, first_col=first_col)

    rows, lat_col, lng_col = _build_map_rows(headers, data_rows, m)

    # Cache snapshot for public views
    await db.maps.update_one(
        {"id": map_id},
        {"$set": {
            "cached_rows": [{"row_index": r["row_index"], "lat": r["lat"], "lng": r["lng"],
                             "data": r["data"], "edited": r["edited"], "visible": r["visible"]}
                            for r in rows],
            "cached_headers": headers,
            "cached_at": now_iso(),
        }},
    )

    # Get unique status values if status_column configured
    status_values = []
    status_col = m.get("status_column")
    if status_col and status_col in headers:
        seen_vals = set()
        for r in rows:
            v = r["data"].get(status_col)
            if v is not None:
                s_val = str(v)
                if s_val not in seen_vals:
                    seen_vals.add(s_val)
                    status_values.append(s_val)

    return {
        "map": m,
        "headers": headers,
        "lat_column": lat_col,
        "lng_column": lng_col,
        "status_column": status_col,
        "status_values": status_values,
        "rows": rows,
    }


# ============ Share / Public ============

@api_router.post("/maps/{map_id}/share")
async def enable_share(map_id: str, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    m = await db.maps.find_one({"id": map_id, "user_id": s["user_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    token = m.get("share_token") or uuid.uuid4().hex
    await db.maps.update_one(
        {"id": map_id},
        {"$set": {"is_public": True, "share_token": token, "updated_at": now_iso()}},
    )
    updated = await db.maps.find_one({"id": map_id}, {"_id": 0})
    return {"share_token": token, "is_public": True, "map": updated}


@api_router.post("/maps/{map_id}/share/rotate")
async def rotate_share(map_id: str, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    m = await db.maps.find_one({"id": map_id, "user_id": s["user_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    token = uuid.uuid4().hex
    await db.maps.update_one(
        {"id": map_id},
        {"$set": {"is_public": True, "share_token": token, "updated_at": now_iso()}},
    )
    return {"share_token": token, "is_public": True}


@api_router.delete("/maps/{map_id}/share")
async def disable_share(map_id: str, x_session_id: str = Header(...)):
    s = await get_session(x_session_id)
    m = await db.maps.find_one({"id": map_id, "user_id": s["user_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    await db.maps.update_one(
        {"id": map_id},
        {"$set": {"is_public": False, "updated_at": now_iso()}},
    )
    return {"is_public": False}


@api_router.get("/public/maps/{share_token}")
async def public_map(share_token: str):
    """Serves cached snapshot of a shared map. No auth required."""
    m = await db.maps.find_one(
        {"share_token": share_token, "is_public": True},
        {"_id": 0, "user_id": 0, "file_id": 0, "point_overrides": 0},
    )
    if not m:
        raise HTTPException(status_code=404, detail="Mapa no encontrado o no compartido")
    cached_rows = m.get("cached_rows") or []
    cached_headers = m.get("cached_headers") or []
    return {
        "map": {
            "id": m.get("id"),
            "name": m.get("name"),
            "file_name": m.get("file_name"),
            "sheet_name": m.get("sheet_name"),
            "visible_columns": m.get("visible_columns", []),
            "status_column": m.get("status_column"),
            "status_visible_values": m.get("status_visible_values", []),
        },
        "headers": cached_headers,
        "lat_column": m.get("lat_column"),
        "lng_column": m.get("lng_column"),
        "status_column": m.get("status_column"),
        "rows": cached_rows,
        "cached_at": m.get("cached_at"),
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
