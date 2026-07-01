import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

const API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.REACT_APP_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !window.google || !points?.length) return;
    const bounds = new window.google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 80);
  }, [map, points]);
  return null;
}

export default function MapView({ mapData, loading, onMarkerClick, selectedPoint }) {
  const [hovered, setHovered] = useState(null);

  const validPoints = useMemo(() => {
    if (!mapData?.rows) return [];
    return mapData.rows.filter((r) => typeof r.lat === "number" && typeof r.lng === "number");
  }, [mapData]);

  if (!API_KEY || API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-100" data-testid="map-no-key">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md text-center shadow-sm">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h3 className="font-heading text-lg font-semibold mb-2">Google Maps no configurado</h3>
          <p className="text-sm text-slate-500 mb-2">
            Agrega tu <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">REACT_APP_GOOGLE_MAPS_API_KEY</code> en <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">frontend/.env</code> y reinicia el servicio.
          </p>
          <p className="text-xs text-slate-400">Obtén tu key en console.cloud.google.com → APIs → Maps JavaScript API.</p>
        </div>
      </div>
    );
  }

  const center = validPoints[0]
    ? { lat: validPoints[0].lat, lng: validPoints[0].lng }
    : { lat: 19.4326, lng: -99.1332 };

  return (
    <div className="absolute inset-0" data-testid="map-view">
      <APIProvider apiKey={API_KEY}>
        <Map
          mapId={MAP_ID}
          defaultCenter={center}
          defaultZoom={11}
          gestureHandling="greedy"
          disableDefaultUI={false}
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          zoomControl={true}
          style={{ width: "100%", height: "100%" }}
        >
          {validPoints.map((p) => {
            const isSelected = selectedPoint?.row_index === p.row_index;
            const isHovered = hovered?.row_index === p.row_index;
            return (
              <AdvancedMarker
                key={p.row_index}
                position={{ lat: p.lat, lng: p.lng }}
                onClick={() => onMarkerClick(p)}
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className={`relative cursor-pointer transition-transform ${isSelected ? "scale-125" : ""}`}
                     data-testid={`marker-${p.row_index}`}>
                  <div className={`w-6 h-6 rounded-full border-2 border-white shadow-lg flex items-center justify-center
                    ${p.edited ? "bg-amber-500" : "bg-[#005FB8]"} ${isSelected ? "marker-active" : ""}`}>
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                  <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45
                    ${p.edited ? "bg-amber-500" : "bg-[#005FB8]"} border-r-2 border-b-2 border-white`} />
                </div>
              </AdvancedMarker>
            );
          })}

          {hovered && (
            <InfoWindow position={{ lat: hovered.lat, lng: hovered.lng }} pixelOffset={[0, -36]} disableAutoPan>
              <HoverCard point={hovered} mapData={mapData} />
            </InfoWindow>
          )}

          <FitBounds points={validPoints} />
        </Map>
      </APIProvider>

      {loading && (
        <div className="absolute top-4 right-1/2 translate-x-1/2 bg-white border border-slate-200 rounded-full shadow-md px-4 py-2 flex items-center gap-2 z-10">
          <Loader2 className="w-4 h-4 animate-spin text-[#005FB8]" />
          <span className="text-xs font-medium text-slate-700">Cargando datos del Excel...</span>
        </div>
      )}

      {!loading && mapData && validPoints.length === 0 && (
        <div className="absolute top-4 right-1/2 translate-x-1/2 bg-white border border-amber-200 rounded-md shadow-md px-4 py-2 flex items-center gap-2 z-10">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-medium text-slate-700">No hay puntos con lat/lng válidos en esta hoja.</span>
        </div>
      )}
    </div>
  );
}

function HoverCard({ point, mapData }) {
  const visible = mapData?.map?.visible_columns || [];
  const cols = visible.length ? visible : (mapData?.headers || []).slice(0, -2).slice(0, 3);
  return (
    <div className="min-w-[180px] max-w-[260px]">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Fila {point.row_index + 1}</div>
      {cols.map((c) => (
        <div key={c} className="flex gap-2 text-xs py-0.5">
          <span className="text-slate-500 font-medium">{c}:</span>
          <span className="text-slate-900 truncate">{String(point.data?.[c] ?? "—")}</span>
        </div>
      ))}
    </div>
  );
}
