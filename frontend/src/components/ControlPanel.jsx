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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Layers,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileSpreadsheet,
  MapPin,
  SlidersHorizontal,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ControlPanel({ mapData, loading, onUpdateColumns, onUpdateCoords, onUpdateStatus, onUpdateRange, onUpdateRowRange }) {
  const [collapsed, setCollapsed] = useState(false);

  const headers = mapData?.headers || [];
  const latCol = mapData?.lat_column;
  const lngCol = mapData?.lng_column;
  const statusCol = mapData?.status_column;
  const statusValues = mapData?.status_values || [];
  const statusVisibleSet = useMemo(
    () => new Set(mapData?.map?.status_visible_values || []),
    [mapData]
  );
  const visible = useMemo(() => new Set(mapData?.map?.visible_columns || []), [mapData]);
  const headerRow = mapData?.map?.header_row ?? 1;
  const firstCol = mapData?.map?.first_col ?? 1;
  const rowFrom = mapData?.map?.data_row_from ?? "";
  const rowTo = mapData?.map?.data_row_to ?? "";

  const [localHeaderRow, setLocalHeaderRow] = useState(headerRow);
  const [localFirstCol, setLocalFirstCol] = useState(firstCol);
  const [localRowFrom, setLocalRowFrom] = useState(rowFrom);
  const [localRowTo, setLocalRowTo] = useState(rowTo);

  // Reset local when map changes
  useMemo(() => {
    setLocalHeaderRow(headerRow);
    setLocalFirstCol(firstCol);
    setLocalRowFrom(rowFrom);
    setLocalRowTo(rowTo);
  }, [headerRow, firstCol, rowFrom, rowTo]);

  const displayHeaders = headers.filter((h) => h !== latCol && h !== lngCol);
  const totalPoints = mapData?.rows?.length || 0;
  const validPoints = mapData?.rows?.filter((r) => typeof r.lat === "number" && typeof r.lng === "number").length || 0;
  const editedPoints = mapData?.rows?.filter((r) => r.edited).length || 0;
  const visiblePoints = mapData?.rows?.filter((r) => r.visible !== false && typeof r.lat === "number").length || 0;

  const toggleColumn = (col) => {
    const next = new Set(visible);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    onUpdateColumns([...next]);
  };

  const toggleStatusValue = (val) => {
    const next = new Set(statusVisibleSet);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onUpdateStatus({ status_visible_values: [...next] });
  };

  const applyRange = () => {
    onUpdateRange({
      header_row: Math.max(1, Number(localHeaderRow) || 1),
      first_col: Math.max(1, Number(localFirstCol) || 1),
    });
  };

  const applyRowRange = () => {
    const from = localRowFrom === "" ? null : Math.max(1, Number(localRowFrom) || 1);
    const to = localRowTo === "" ? null : Math.max(1, Number(localRowTo) || 1);
    onUpdateRowRange({ data_row_from: from, data_row_to: to });
  };

  const clearRowRange = () => {
    setLocalRowFrom("");
    setLocalRowTo("");
    onUpdateRowRange({ data_row_from: null, data_row_to: null });
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
        <ScrollArea className="flex-1 thin-scroll">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="flex items-start gap-2">
              <FileSpreadsheet className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Archivo</p>
                <p className="text-sm font-medium truncate">{mapData.map.file_name}</p>
                <p className="text-xs text-slate-500 truncate">Hoja: <span className="font-mono">{mapData.map.sheet_name}</span></p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 pt-2">
              <Stat label="Filas" value={totalPoints} />
              <Stat label="Válidos" value={validPoints} accent />
              <Stat label="Visibles" value={visiblePoints} success />
              <Stat label="Edit." value={editedPoints} amber />
            </div>
          </div>

          {/* Data range section */}
          <div className="p-4 border-b border-slate-100 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Rango de datos</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase text-slate-400 mb-0.5 block">Fila encabezados</Label>
                <Input
                  type="number"
                  min={1}
                  value={localHeaderRow}
                  onChange={(e) => setLocalHeaderRow(e.target.value)}
                  className="h-8 text-xs"
                  data-testid="header-row-input"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-slate-400 mb-0.5 block">Primera columna</Label>
                <Input
                  type="number"
                  min={1}
                  value={localFirstCol}
                  onChange={(e) => setLocalFirstCol(e.target.value)}
                  className="h-8 text-xs"
                  data-testid="first-col-input"
                />
              </div>
            </div>
            {(Number(localHeaderRow) !== headerRow || Number(localFirstCol) !== firstCol) && (
              <Button
                size="sm"
                className="w-full h-7 text-xs bg-[#005FB8] hover:bg-[#004A94]"
                onClick={applyRange}
                data-testid="apply-range-btn"
              >
                Aplicar rango
              </Button>
            )}
          </div>

          {/* Row-range slice (para dividir una hoja en varios mapas) */}
          <div className="p-4 border-b border-slate-100 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Filas a incluir</p>
              </div>
              {(rowFrom !== "" || rowTo !== "") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-slate-500"
                  onClick={clearRowRange}
                  data-testid="clear-row-range-btn"
                >
                  Todas
                </Button>
              )}
            </div>
            <p className="text-[10px] text-slate-500 -mt-1">Divide una hoja en varios mapas (ej. filas 1–45 en uno y 46–91 en otro).</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase text-slate-400 mb-0.5 block">Desde fila</Label>
                <Input
                  type="number"
                  min={1}
                  value={localRowFrom}
                  onChange={(e) => setLocalRowFrom(e.target.value)}
                  placeholder="1"
                  className="h-8 text-xs"
                  data-testid="row-from-input"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-slate-400 mb-0.5 block">Hasta fila</Label>
                <Input
                  type="number"
                  min={1}
                  value={localRowTo}
                  onChange={(e) => setLocalRowTo(e.target.value)}
                  placeholder="—"
                  className="h-8 text-xs"
                  data-testid="row-to-input"
                />
              </div>
            </div>
            {(String(localRowFrom) !== String(rowFrom) || String(localRowTo) !== String(rowTo)) && (
              <Button
                size="sm"
                className="w-full h-7 text-xs bg-[#005FB8] hover:bg-[#004A94]"
                onClick={applyRowRange}
                data-testid="apply-row-range-btn"
              >
                Aplicar
              </Button>
            )}
          </div>

          {/* Coord columns */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Columnas geo</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase text-slate-400 mb-0.5 block">Latitud</Label>
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
                <Label className="text-[10px] uppercase text-slate-400 mb-0.5 block">Longitud</Label>
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

          {/* Status filter */}
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Columna de estado</p>
            </div>
            <Select
              value={statusCol || "__none__"}
              onValueChange={(v) => onUpdateStatus({ status_column: v === "__none__" ? null : v, status_visible_values: [] })}
            >
              <SelectTrigger className="h-8 text-xs" data-testid="status-col-select">
                <SelectValue placeholder="Ninguna" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Ninguna (todos visibles)</SelectItem>
                {headers.filter((h) => h !== latCol && h !== lngCol).map((h) => (
                  <SelectItem key={h} value={h}>{h}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {statusCol && (statusValues.length > 0 || mapData?.status_has_empty) && (
              <div className="mt-2">
                <p className="text-[10px] uppercase text-slate-400 mb-1">Valores visibles (los demás quedan tenues)</p>
                <div className="border border-slate-200 rounded-md p-1 max-h-[160px] overflow-auto thin-scroll">
                  {mapData?.status_has_empty && (
                    <label
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer border-b border-slate-100 mb-1"
                    >
                      <Checkbox
                        checked={statusVisibleSet.has("__EMPTY__")}
                        onCheckedChange={() => toggleStatusValue("__EMPTY__")}
                        data-testid="status-val-empty"
                      />
                      <span className="text-xs italic text-slate-500">(vacío / sin valor)</span>
                    </label>
                  )}
                  {statusValues.map((v) => (
                    <label
                      key={v}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer"
                    >
                      <Checkbox
                        checked={statusVisibleSet.has(v)}
                        onCheckedChange={() => toggleStatusValue(v)}
                        data-testid={`status-val-${v}`}
                      />
                      <span className="text-xs truncate">{v}</span>
                    </label>
                  ))}
                </div>
                {statusVisibleSet.size === 0 && (
                  <p className="text-[10px] text-slate-500 mt-1">Sin selección: todos los marcadores se muestran normales.</p>
                )}
              </div>
            )}
          </div>

          {/* Visible columns */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-slate-400" />
                <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Columnas en popup</p>
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
          </div>
        </ScrollArea>
      )}
    </Card>
  );
}

function Stat({ label, value, accent, amber, success }) {
  const style = accent
    ? "bg-[#005FB8]/5 border-[#005FB8]/20 text-[#005FB8]"
    : amber
    ? "bg-amber-50 border-amber-200 text-amber-700"
    : success
    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : "bg-slate-50 border-slate-200 text-slate-900";
  return (
    <div className={`rounded-md px-1.5 py-1 border ${style}`}>
      <div className={`text-sm font-semibold font-heading`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
    </div>
  );
}
