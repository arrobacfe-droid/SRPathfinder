# CartoSheet — Excel Maps from OneDrive

## Problem Statement (original)
"Una pagina conectada a onedrive excel la cual con la informacion del excel haga un mapa donde editando unos puntos estos se reflejen en el mapa, la pagina deberia poder mantener multiples mapas del mismo excel."

## User Choices
- Auth: Microsoft OAuth (OneDrive via Microsoft Graph)
- Map provider: Google Maps
- Excel structure: 14 columns, last 2 are lat/lng. User picks which other columns to display in marker popups.
- Point editing: data only (location is immutable)
- Multiple maps: one map per Excel sheet

## Architecture
- **Backend**: FastAPI + Motor (MongoDB). Endpoints under `/api`:
  - `GET /api/auth/microsoft/url` — build OAuth URL with state
  - `POST /api/auth/microsoft/callback` — exchange code, create session
  - `GET /api/auth/me`, `POST /api/auth/logout`
  - `GET /api/onedrive/files` — list .xlsx from OneDrive
  - `GET /api/onedrive/files/{id}/sheets` — sheet names
  - `GET /api/onedrive/files/{id}/sheets/{sheet}/data` — read rows w/ last 2 cols as lat/lng
  - Maps CRUD: `POST/GET/PATCH/DELETE /api/maps`, `PUT/DELETE /api/maps/{id}/points/{row}`
  - `GET /api/maps/{id}/data` — combines Excel + overrides
- **Frontend**: React 19 + Tailwind + shadcn/ui + `@vis.gl/react-google-maps`
  - Session-based auth using `X-Session-Id` header (stored in localStorage)
  - Pages: LoginPage, CallbackPage, DashboardPage
  - Components: MapView, ControlPanel (left), EditPointSheet (right), CreateMapDialog

## Implemented (Feb 2026)
- Microsoft OAuth end-to-end flow (auth URL, callback with state, token refresh on 401)
- OneDrive Graph API: list xlsx, read sheets, parse rows
- Google Maps rendering with @vis.gl/react-google-maps + AdvancedMarker
- Multi-step CreateMapDialog: pick file → pick sheet → configure visible columns
- Map dashboard with left ControlPanel (stats, column toggles) + right Sheet (edit point data)
- Edited points highlighted amber; revert supported
- Multi-map management via dropdown; delete map

## Backlog (P0–P2)
- **P0**: Add real Google Maps API key (currently placeholder) to fully render map
- **P1**: Add ability to load Excel from sub-folders (currently only root search)
- **P1**: Show route line connecting points in order
- **P2**: Export edited map (CSV/GeoJSON)
- **P2**: Marker color/category by column value
- **P2**: Filters (by column values)
