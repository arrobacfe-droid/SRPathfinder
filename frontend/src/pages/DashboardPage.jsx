import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Map as MapIcon, LogOut, ChevronDown, Plus, Share2, UserCog } from "lucide-react";
import ControlPanel from "@/components/ControlPanel";
import MapView from "@/components/MapView";
import EditPointSheet from "@/components/EditPointSheet";
import CreateMapDialog from "@/components/CreateMapDialog";
import ShareDialog from "@/components/ShareDialog";

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [maps, setMaps] = useState([]);
  const [activeMapId, setActiveMapId] = useState(null);
  const [mapData, setMapData] = useState(null);
  const [loadingMap, setLoadingMap] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    const u = localStorage.getItem("user");
    if (u) setUser(JSON.parse(u));
    api.get("/auth/me").then((r) => {
      setUser(r.data);
      localStorage.setItem("user", JSON.stringify(r.data));
    }).catch(() => {});
    refreshMaps();
  }, []);

  const refreshMaps = useCallback(async () => {
    try {
      const res = await api.get("/maps");
      setMaps(res.data.maps);
      if (res.data.maps.length && !activeMapId) {
        setActiveMapId(res.data.maps[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  }, [activeMapId]);

  const loadMapData = useCallback(async (mapId) => {
    if (!mapId) return;
    setLoadingMap(true);
    try {
      const res = await api.get(`/maps/${mapId}/data`);
      setMapData(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error cargando datos del mapa");
    } finally {
      setLoadingMap(false);
    }
  }, []);

  useEffect(() => {
    if (activeMapId) loadMapData(activeMapId);
    else setMapData(null);
  }, [activeMapId, loadMapData]);

  const handleLogout = async () => {
    try { await api.post("/auth/logout"); } catch (e) { /* ignore */ }
    localStorage.removeItem("session_id");
    localStorage.removeItem("user");
    window.location.href = "/login";
  };

  const handleSwitchAccount = async () => {
    try { await api.post("/auth/logout"); } catch (e) { /* ignore */ }
    localStorage.removeItem("session_id");
    localStorage.removeItem("user");
    try {
      const res = await api.get("/auth/microsoft/url", { params: { prompt: "select_account" } });
      window.location.href = res.data.url;
    } catch (e) {
      toast.error("No se pudo iniciar el cambio de cuenta");
      window.location.href = "/login";
    }
  };

  const handleMapCreated = (newMap) => {
    setMaps((prev) => [newMap, ...prev]);
    setActiveMapId(newMap.id);
    setCreateOpen(false);
  };

  const handleSavePoint = async (rowIndex, overrides) => {
    try {
      await api.put(`/maps/${activeMapId}/points/${rowIndex}`, { overrides });
      toast.success("Punto actualizado");
      await loadMapData(activeMapId);
      setSelectedPoint(null);
    } catch (e) {
      toast.error("No se pudo guardar");
    }
  };

  const handleResetPoint = async (rowIndex) => {
    try {
      await api.delete(`/maps/${activeMapId}/points/${rowIndex}`);
      toast.success("Cambios revertidos");
      await loadMapData(activeMapId);
      setSelectedPoint(null);
    } catch (e) {
      toast.error("Error al revertir");
    }
  };

  const handleDeleteMap = async (mapId) => {
    if (!window.confirm("¿Eliminar este mapa? Esto no afecta tu archivo de OneDrive.")) return;
    try {
      await api.delete(`/maps/${mapId}`);
      toast.success("Mapa eliminado");
      const remaining = maps.filter((m) => m.id !== mapId);
      setMaps(remaining);
      if (activeMapId === mapId) {
        setActiveMapId(remaining[0]?.id || null);
      }
    } catch (e) {
      toast.error("Error al eliminar");
    }
  };

  const handleUpdateColumns = async (visibleColumns) => {
    try {
      const res = await api.patch(`/maps/${activeMapId}`, { visible_columns: visibleColumns });
      setMapData((prev) => prev ? { ...prev, map: res.data } : prev);
      setMaps((prev) => prev.map((m) => m.id === res.data.id ? res.data : m));
    } catch (e) {
      toast.error("No se pudieron guardar las columnas");
    }
  };

  const handleUpdateCoords = async (partial) => {
    try {
      await api.patch(`/maps/${activeMapId}`, partial);
      toast.success("Columnas de coordenadas actualizadas");
      await loadMapData(activeMapId);
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudo actualizar");
    }
  };

  const handleUpdateStatus = async (partial) => {
    try {
      const res = await api.patch(`/maps/${activeMapId}`, partial);
      setMaps((prev) => prev.map((m) => m.id === res.data.id ? res.data : m));
      await loadMapData(activeMapId);
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudo actualizar");
    }
  };

  const handleUpdateRange = async (partial) => {
    try {
      await api.patch(`/maps/${activeMapId}`, partial);
      toast.success("Rango actualizado");
      await loadMapData(activeMapId);
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudo actualizar");
    }
  };

  const handleShareUpdate = (updatedMap) => {
    setMaps((prev) => prev.map((m) => m.id === updatedMap.id ? updatedMap : m));
    setMapData((prev) => prev ? { ...prev, map: updatedMap } : prev);
  };

  const activeMap = maps.find((m) => m.id === activeMapId);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-slate-50" data-testid="dashboard-page">
      <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-4 lg:px-6 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#005FB8] rounded-md flex items-center justify-center">
            <MapIcon className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-heading font-bold tracking-tight">S.R.Pathfinder</span>
          <span className="text-xs text-slate-400 font-mono ml-2 hidden md:inline">/ {activeMap?.name || "sin mapa activo"}</span>
          {activeMap?.is_public && (
            <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wide">Público</span>
          )}
          {activeMap && !activeMap.is_owner && (
            <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-wide" data-testid="editor-badge">Editor</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="maps-dropdown">
                <span className="truncate max-w-[180px]">{activeMap?.name || "Seleccionar mapa"}</span>
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-slate-500">Tus mapas</DropdownMenuLabel>
              {maps.length === 0 && (
                <div className="px-2 py-3 text-sm text-slate-500">Aún no tienes mapas.</div>
              )}
              {maps.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => setActiveMapId(m.id)}
                  className="flex flex-col items-start py-2 cursor-pointer"
                  data-testid={`map-item-${m.id}`}
                >
                  <div className="flex w-full justify-between items-center">
                    <span className="font-medium text-sm">{m.name}</span>
                    {m.id === activeMapId && <span className="text-[10px] font-semibold text-[#005FB8]">ACTIVO</span>}
                  </div>
                  <span className="text-xs text-slate-500 truncate">{m.file_name} · {m.sheet_name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateOpen(true)} className="cursor-pointer" data-testid="new-map-menu-btn">
                <Plus className="w-4 h-4 mr-2" /> Nuevo mapa
              </DropdownMenuItem>
              {activeMap && activeMap.is_owner && (
                <DropdownMenuItem
                  onClick={() => handleDeleteMap(activeMap.id)}
                  className="text-rose-600 cursor-pointer"
                  data-testid="delete-map-menu-btn"
                >
                  Eliminar mapa actual
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeMap && (
            <Button
              onClick={() => setShareOpen(true)}
              variant="outline"
              size="sm"
              data-testid="share-btn"
              className={activeMap.is_public ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : ""}
            >
              <Share2 className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Compartir</span>
            </Button>
          )}

          <Button onClick={() => setCreateOpen(true)} className="bg-[#005FB8] hover:bg-[#004A94] text-white" size="sm" data-testid="new-map-btn">
            <Plus className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">Nuevo</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="user-menu-btn">
                <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center text-xs font-semibold">
                  {(user?.display_name || user?.email || "?").slice(0,1).toUpperCase()}
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <div className="text-sm font-semibold">{user?.display_name}</div>
                <div className="text-xs text-slate-500 font-normal">{user?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSwitchAccount} className="cursor-pointer" data-testid="switch-account-btn">
                <UserCog className="w-4 h-4 mr-2" /> Cambiar cuenta
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-rose-600" data-testid="logout-btn">
                <LogOut className="w-4 h-4 mr-2" /> Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex-1 relative overflow-hidden">
        {maps.length === 0 ? (
          <div className="h-full flex items-center justify-center p-8">
            <div className="max-w-md text-center bg-white border border-slate-200 rounded-xl p-10 shadow-sm">
              <MapIcon className="w-12 h-12 text-[#005FB8] mx-auto mb-4" />
              <h2 className="font-heading text-2xl font-semibold mb-2">Crea tu primer mapa</h2>
              <p className="text-sm text-slate-500 mb-6">
                Elige un archivo Excel de tu OneDrive y selecciona la hoja que quieres visualizar como ruta.
              </p>
              <Button onClick={() => setCreateOpen(true)} className="bg-[#005FB8] hover:bg-[#004A94]" data-testid="empty-new-map-btn">
                <Plus className="w-4 h-4 mr-1" /> Crear mapa desde Excel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <MapView
              mapData={mapData}
              loading={loadingMap}
              onMarkerClick={(point) => setSelectedPoint(point)}
              selectedPoint={selectedPoint}
            />
            <ControlPanel
              mapData={mapData}
              loading={loadingMap}
              onUpdateColumns={handleUpdateColumns}
              onUpdateCoords={handleUpdateCoords}
              onUpdateStatus={handleUpdateStatus}
              onUpdateRange={handleUpdateRange}
            />
            <EditPointSheet
              point={selectedPoint}
              headers={mapData?.headers || []}
              latColumn={mapData?.lat_column}
              lngColumn={mapData?.lng_column}
              onClose={() => setSelectedPoint(null)}
              onSave={handleSavePoint}
              onReset={handleResetPoint}
            />
          </>
        )}
      </div>

      <CreateMapDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleMapCreated}
      />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        map={activeMap}
        onMapUpdated={handleShareUpdate}
      />
    </div>
  );
}
