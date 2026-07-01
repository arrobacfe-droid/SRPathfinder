import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layers, ChevronLeft, ChevronRight, Eye, FileSpreadsheet, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ControlPanel({ mapData, loading, onUpdateColumns, onUpdateCoords }) {
  const [collapsed, setCollapsed] = useState(false);

  const headers = mapData?.headers || [];
  const latCol = mapData?.lat_column;
  const lngCol = mapData?.lng_column;
  const visible = useMemo(() => new Set(mapData?.map?.visible_columns || []), [mapData]);

  const displayHeaders = headers.filter((h) => h !== latCol && h !== lngCol);
  const totalPoints = mapData?.rows?.length || 0;
  const validPoints = mapData?.rows?.filter((r) => typeof r.lat === "number" && typeof r.lng === "number").length || 0;
  const editedPoints = mapData?.rows?.filter((r) => r.edited).length || 0;

  const toggleColumn = (col) => {
    const next = new Set(visible);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    onUpdateColumns([...next]);
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute top-4 left-4 z-10 bg-white border border-slate-200 rounded-lg shadow-md p-2 hover:bg-slate-50 transition-colors"
        data-testid="expand-panel-btn"
      >
        <ChevronRight className="w-4 h-4 text-slate-700" />
      </button>
    );
  }

  return (
    <Card
      className="absolute top-4 left-4 bottom-4 w-80 bg-white border border-slate-200 shadow-lg rounded-xl z-10 flex flex-col overflow-hidden fade-up"
      data-testid="control-panel"
    >
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#005FB8]" />
          <span className="font-heading text-sm font-semibold tracking-tight">Configuración del mapa</span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 hover:bg-slate-100 rounded-md transition-colors"
          data-testid="collapse-panel-btn"
        >
          <ChevronLeft className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {!mapData && !loading && (
        <div className="p-6 text-center text-sm text-slate-500">
          Selecciona o crea un mapa para empezar.
        </div>
      )}

      {mapData && (
        <>
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="flex items-start gap-2">
              <FileSpreadsheet className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Archivo</p>
                <p className="text-sm font-medium truncate">{mapData.map.file_name}</p>
                <p className="text-xs text-slate-500 truncate">Hoja: <span className="font-mono">{mapData.map.sheet_name}</span></p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2">
              <Stat label="Filas" value={totalPoints} />
              <Stat label="En mapa" value={validPoints} accent />
              <Stat label="Editadas" value={editedPoints} amber />
            </div>
          </div>

          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Columnas geo</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Latitud</p>
                <Select value={latCol || ""} onValueChange={(v) => onUpdateCoords({ lat_column: v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="lat-col-panel-select">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h} disabled={h === lngCol}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Longitud</p>
                <Select value={lngCol || ""} onValueChange={(v) => onUpdateCoords({ lng_column: v })}>
                  <SelectTrigger className="h-8 text-xs" data-testid="lng-col-panel-select">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h} disabled={h === latCol}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="p-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Columnas visibles</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => onUpdateColumns(displayHeaders)}
              data-testid="select-all-cols-btn"
            >
              Todas
            </Button>
          </div>

          <ScrollArea className="flex-1 px-4 pb-4 thin-scroll">
            <div className="space-y-1">
              {displayHeaders.map((h) => (
                <label
                  key={h}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer transition-colors"
                  data-testid={`col-toggle-${h}`}
                >
                  <Checkbox
                    checked={visible.has(h)}
                    onCheckedChange={() => toggleColumn(h)}
                  />
                  <span className="text-sm truncate">{h}</span>
                </label>
              ))}
              {displayHeaders.length === 0 && (
                <p className="text-xs text-slate-400 py-2">Sin columnas adicionales.</p>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, accent, amber }) {
  return (
    <div className={`rounded-md px-2 py-1.5 ${accent ? "bg-[#005FB8]/5 border border-[#005FB8]/20" : amber ? "bg-amber-50 border border-amber-200" : "bg-slate-50 border border-slate-200"}`}>
      <div className={`text-base font-semibold font-heading ${accent ? "text-[#005FB8]" : amber ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
    </div>
  );
}
