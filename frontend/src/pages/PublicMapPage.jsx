import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import MapView from "@/components/MapView";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, MapPin, AlertTriangle, Navigation, CheckCircle2, Clock } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function PublicMapPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/public/maps/${token}`);
      setData(r.data);
      // Re-sync selectedPoint with the fresh data if it exists
      setSelectedPoint((prev) => {
        if (!prev) return null;
        const updated = r.data?.rows?.find((row) => row.row_index === prev.row_index);
        return updated || prev;
      });
    } catch (e) {
      setError(e.response?.data?.detail || "No se pudo cargar el mapa");
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Refresh every 60s to catch expired visits from other visitors
  useEffect(() => {
    const t = setInterval(() => load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  const toggleVisited = async (point) => {
    if (busy) return;
    setBusy(true);
    const wasVisited = point.visited === true;
    // Optimistic update
    setData((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((r) => r.row_index === point.row_index ? { ...r, visited: !wasVisited } : r);
      return { ...prev, rows };
    });
    setSelectedPoint((prev) => prev ? { ...prev, visited: !wasVisited } : prev);
    try {
      if (wasVisited) {
        await axios.delete(`${API}/public/maps/${token}/visits/${point.row_index}`);
      } else {
        await axios.post(`${API}/public/maps/${token}/visits/${point.row_index}`);
      }
      // Sync with server truth (in case another visitor changed it too)
      await load();
    } catch (e) {
      // Revert on failure
      setData((prev) => {
        if (!prev) return prev;
        const rows = prev.rows.map((r) => r.row_index === point.row_index ? { ...r, visited: wasVisited } : r);
        return { ...prev, rows };
      });
      setSelectedPoint((prev) => prev ? { ...prev, visited: wasVisited } : prev);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-[#005FB8]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto text-rose-500 mb-4" />
          <h2 className="font-heading text-xl font-semibold mb-2">Mapa no disponible</h2>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const mapData = data
    ? {
        map: data.map,
        headers: data.headers,
        lat_column: data.lat_column,
        lng_column: data.lng_column,
        status_column: data.status_column,
        rows: data.rows,
      }
    : null;

  const validPoints = mapData?.rows?.filter((r) => typeof r.lat === "number" && typeof r.lng === "number").length || 0;
  const visiblePoints = mapData?.rows?.filter((r) => r.visible !== false && typeof r.lat === "number").length || 0;
  const visitedCount = mapData?.rows?.filter((r) => r.visited === true).length || 0;
  const ttlHours = data?.visit_ttl_hours || 12;

  // Compute remaining time until this visit expires
  let remaining = null;
  if (selectedPoint?.visited && selectedPoint?.visited_at) {
    const then = new Date(selectedPoint.visited_at);
    const expiresAt = new Date(then.getTime() + ttlHours * 3600 * 1000);
    const ms = expiresAt - new Date();
    if (ms > 0) {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      remaining = `${h}h ${m}m`;
    }
  }

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50" data-testid="public-map-page">
      <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-4 lg:px-6 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#005FB8] rounded-md flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-heading font-bold tracking-tight text-sm leading-tight">{data?.map?.name || "Mapa compartido"}</div>
            <div className="text-[10px] text-slate-500 font-mono">
              {visiblePoints}/{validPoints} puntos · <span className="text-emerald-600 font-semibold">{visitedCount} visitados</span>
            </div>
          </div>
        </div>
        <div className="text-[10px] text-slate-400 font-mono hidden sm:block">
          {data?.cached_at ? `Actualizado: ${new Date(data.cached_at).toLocaleString()}` : ""}
        </div>
      </header>
      <div className="flex-1 relative">
        <MapView
          mapData={mapData}
          loading={false}
          onMarkerClick={(p) => setSelectedPoint(p)}
          selectedPoint={selectedPoint}
          readOnly
        />
        {selectedPoint && (
          <div className="absolute right-4 top-4 max-w-sm bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-20" data-testid="public-point-info">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MapPin className={`w-4 h-4 ${selectedPoint.visited ? "text-emerald-600" : "text-[#005FB8]"}`} />
                <span className="font-heading font-semibold text-sm">Punto {selectedPoint.row_index + 1}</span>
                {selectedPoint.visited && (
                  <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wide">Visitado</span>
                )}
              </div>
              <button onClick={() => setSelectedPoint(null)} className="text-slate-400 hover:text-slate-700 text-sm">✕</button>
            </div>
            <div className="space-y-1">
              {(mapData.map.visible_columns?.length ? mapData.map.visible_columns : mapData.headers.slice(0, 5)).map((c) => (
                <div key={c} className="flex gap-2 text-xs py-0.5">
                  <span className="text-slate-500 font-medium min-w-[80px]">{c}:</span>
                  <span className="text-slate-900 break-words">{String(selectedPoint.data?.[c] ?? "—")}</span>
                </div>
              ))}
            </div>

            {/* Visited checkbox */}
            <label
              className={`mt-3 flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors border ${
                selectedPoint.visited
                  ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                  : "bg-slate-50 border-slate-200 hover:bg-slate-100"
              }`}
              data-testid="visited-toggle-label"
            >
              <Checkbox
                checked={selectedPoint.visited === true}
                disabled={busy}
                onCheckedChange={() => toggleVisited(selectedPoint)}
                data-testid="visited-checkbox"
              />
              <div className="flex-1 text-xs">
                <div className="flex items-center gap-1.5">
                  {selectedPoint.visited && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                  <span className={`font-medium ${selectedPoint.visited ? "text-emerald-800" : "text-slate-700"}`}>
                    Marcar como visitado
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {selectedPoint.visited && remaining
                    ? `Volverá al color original en ${remaining}`
                    : `Se restablece automáticamente después de ${ttlHours} horas`}
                </p>
              </div>
            </label>

            <button
              onClick={() => {
                const url = `https://www.google.com/maps/dir/?api=1&destination=${selectedPoint.lat},${selectedPoint.lng}&travelmode=driving`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
              className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium py-2 rounded-md transition-colors"
              data-testid="public-directions-btn"
            >
              <Navigation className="w-3.5 h-3.5" /> Cómo llegar en Google Maps
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
