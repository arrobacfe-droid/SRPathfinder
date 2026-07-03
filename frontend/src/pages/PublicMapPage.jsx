import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import MapView from "@/components/MapView";
import { Loader2, MapPin, AlertTriangle, Navigation } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function PublicMapPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPoint, setSelectedPoint] = useState(null);

  useEffect(() => {
    setLoading(true);
    axios
      .get(`${API}/public/maps/${token}`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.data?.detail || "No se pudo cargar el mapa"))
      .finally(() => setLoading(false));
  }, [token]);

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

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50" data-testid="public-map-page">
      <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-4 lg:px-6 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#005FB8] rounded-md flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-heading font-bold tracking-tight text-sm leading-tight">{data?.map?.name || "Mapa compartido"}</div>
            <div className="text-[10px] text-slate-500 font-mono">{visiblePoints}/{validPoints} puntos · vista pública</div>
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
                <MapPin className="w-4 h-4 text-[#005FB8]" />
                <span className="font-heading font-semibold text-sm">Punto {selectedPoint.row_index + 1}</span>
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
