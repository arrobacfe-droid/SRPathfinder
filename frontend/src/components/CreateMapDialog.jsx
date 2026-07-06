import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileSpreadsheet,
  Loader2,
  ChevronRight,
  MapPin,
  Info,
  Filter,
  SlidersHorizontal,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import SheetGridPicker from "@/components/SheetGridPicker";

export default function CreateMapDialog({ open, onOpenChange, onCreated }) {
  const [step, setStep] = useState(1);
  // Step 1
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  // Step 2 (sheet + range picker)
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [grid, setGrid] = useState([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [headerRow, setHeaderRow] = useState(1);
  const [firstCol, setFirstCol] = useState(1);
  // Step 3 (columns)
  const [headers, setHeaders] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [latCol, setLatCol] = useState("");
  const [lngCol, setLngCol] = useState("");
  const [statusCol, setStatusCol] = useState("__none__");
  const [visibleCols, setVisibleCols] = useState([]);
  const [rowFrom, setRowFrom] = useState("");
  const [rowTo, setRowTo] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [name, setName] = useState("");
  const [loadingHeaders, setLoadingHeaders] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(1);
        setSelectedFile(null);
        setSheets([]);
        setSelectedSheet("");
        setGrid([]);
        setHeaders([]);
        setSampleRows([]);
        setVisibleCols([]);
        setLatCol("");
        setLngCol("");
        setStatusCol("__none__");
        setRowFrom("");
        setRowTo("");
        setTotalRows(0);
        setName("");
        setHeaderRow(1);
        setFirstCol(1);
      }, 200);
      return;
    }
    loadFiles();
  }, [open]);

  const loadFiles = async () => {
    setFilesLoading(true);
    try {
      const res = await api.get("/onedrive/files");
      setFiles(res.data.files);
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudieron cargar los archivos de OneDrive");
    } finally {
      setFilesLoading(false);
    }
  };

  const pickFile = async (file) => {
    setSelectedFile(file);
    setFilesLoading(true);
    try {
      const res = await api.get(`/onedrive/files/${file.id}/sheets`);
      setSheets(res.data.sheets);
      // Auto-pick first sheet
      if (res.data.sheets.length > 0) {
        await pickSheet(file.id, res.data.sheets[0]);
      }
      setStep(2);
    } catch (e) {
      toast.error("Error leyendo hojas del Excel");
    } finally {
      setFilesLoading(false);
    }
  };

  const pickSheet = async (fileId, sheetName) => {
    setSelectedSheet(sheetName);
    setGridLoading(true);
    try {
      const res = await api.get(
        `/onedrive/files/${fileId}/sheets/${encodeURIComponent(sheetName)}/preview`,
        { params: { max_rows: 30, max_cols: 20 } }
      );
      setGrid(res.data.grid);
      setHeaderRow(res.data.suggested_header_row || 1);
      setFirstCol(res.data.suggested_first_col || 1);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error leyendo vista previa");
    } finally {
      setGridLoading(false);
    }
  };

  const changeSheet = (sheetName) => {
    if (sheetName === selectedSheet) return;
    pickSheet(selectedFile.id, sheetName);
  };

  const goToStep3 = async () => {
    setLoadingHeaders(true);
    try {
      const res = await api.get(
        `/onedrive/files/${selectedFile.id}/sheets/${encodeURIComponent(selectedSheet)}/data`,
        { params: { header_row: headerRow, first_col: firstCol } }
      );
      setHeaders(res.data.headers);
      setSampleRows(res.data.sample_rows || []);
      setLatCol(res.data.suggested_lat_column || "");
      setLngCol(res.data.suggested_lng_column || "");
      setTotalRows(res.data.row_count || 0);
      const auto = res.data.headers.filter(
        (h) => h !== res.data.suggested_lat_column && h !== res.data.suggested_lng_column
      );
      setVisibleCols(auto.slice(0, Math.min(4, auto.length)));
      if (!name) setName(`${selectedFile.name.replace(/\.xlsx$/i, "")} · ${selectedSheet}`);
      setStep(3);
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudieron leer las columnas con este rango. Selecciona una celda diferente en la vista.");
    } finally {
      setLoadingHeaders(false);
    }
  };

  const toggleCol = (c) => {
    setVisibleCols((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const handleCreate = async () => {
    if (!latCol || !lngCol) {
      toast.error("Selecciona las columnas de latitud y longitud");
      return;
    }
    if (latCol === lngCol) {
      toast.error("Latitud y longitud deben ser columnas distintas");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post("/maps", {
        name: name.trim() || `Mapa ${selectedSheet}`,
        file_id: selectedFile.id,
        file_name: selectedFile.name,
        sheet_name: selectedSheet,
        lat_column: latCol,
        lng_column: lngCol,
        visible_columns: visibleCols,
        header_row: Math.max(1, Number(headerRow) || 1),
        first_col: Math.max(1, Number(firstCol) || 1),
        status_column: statusCol === "__none__" ? null : statusCol,
        status_visible_values: [],
      });
      toast.success("Mapa creado");
      onCreated(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al crear mapa");
    } finally {
      setSaving(false);
    }
  };

  const displayCols = headers.filter((h) => h !== latCol && h !== lngCol);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 overflow-hidden" data-testid="create-map-dialog">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="font-heading text-xl">Nuevo mapa desde Excel</DialogTitle>
          <DialogDescription className="text-xs">
            Paso {step} de 3 · {step === 1 ? "Elige un archivo .xlsx" : step === 2 ? "Selecciona hoja y rango de datos" : "Configura columnas"}
          </DialogDescription>

          <div className="flex items-center gap-1 pt-3">
            {[1,2,3].map((i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-[#005FB8]" : "bg-slate-200"}`} />
            ))}
          </div>
        </DialogHeader>

        <div className="px-6 pb-2 min-h-[380px] max-h-[70vh] overflow-hidden flex flex-col">
          {/* Step 1: file */}
          {step === 1 && (
            <ScrollArea className="flex-1 -mx-1 px-1 thin-scroll">
              {filesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-[#005FB8]" />
                </div>
              ) : files.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">No se encontraron archivos .xlsx en tu OneDrive.</p>
              ) : (
                <div className="space-y-1.5 py-2">
                  {files.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => pickFile(f)}
                      disabled={filesLoading}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#005FB8] hover:bg-[#005FB8]/5 transition-all text-left"
                      data-testid={`file-${f.id}`}
                    >
                      <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{f.name}</p>
                        <p className="text-xs text-slate-500">
                          {f.size ? `${(f.size / 1024).toFixed(1)} KB` : ""}{" "}· {f.modified ? new Date(f.modified).toLocaleDateString() : ""}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}

          {/* Step 2: sheet + grid picker */}
          {step === 2 && (
            <div className="flex-1 overflow-hidden flex flex-col gap-3 py-2">
              <div className="flex items-center gap-3">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">Hoja</Label>
                <Select value={selectedSheet} onValueChange={changeSheet}>
                  <SelectTrigger className="w-full" data-testid="sheet-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {gridLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-[#005FB8]" />
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <SheetGridPicker
                    grid={grid}
                    headerRow={headerRow}
                    firstCol={firstCol}
                    onSelect={({ headerRow: h, firstCol: c }) => {
                      setHeaderRow(h);
                      setFirstCol(c);
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 3: columns */}
          {step === 3 && (
            <ScrollArea className="flex-1 thin-scroll">
              <div className="space-y-4 py-2 pr-2">
                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Nombre del mapa</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="map-name-input" />
                </div>

                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[#005FB8]" />
                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-700">Columnas de coordenadas</Label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[10px] uppercase text-slate-400 mb-1 block">Latitud</Label>
                      <Select value={latCol} onValueChange={setLatCol}>
                        <SelectTrigger data-testid="lat-column-select"><SelectValue placeholder="Elige columna" /></SelectTrigger>
                        <SelectContent>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h} disabled={h === lngCol}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase text-slate-400 mb-1 block">Longitud</Label>
                      <Select value={lngCol} onValueChange={setLngCol}>
                        <SelectTrigger data-testid="lng-column-select"><SelectValue placeholder="Elige columna" /></SelectTrigger>
                        <SelectContent>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h} disabled={h === latCol}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {sampleRows.length > 0 && latCol && lngCol && (
                    <div className="bg-white border border-slate-200 rounded-md p-2 text-xs">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 font-semibold flex items-center gap-1">
                        <Info className="w-3 h-3" /> Muestra de la fila 1
                      </p>
                      <div className="flex gap-4 font-mono">
                        <span>lat: <span className="text-[#005FB8] font-semibold">{String(sampleRows[0][latCol] ?? "—")}</span></span>
                        <span>lng: <span className="text-[#005FB8] font-semibold">{String(sampleRows[0][lngCol] ?? "—")}</span></span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-[#005FB8]" />
                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-700">Columna de estado (opcional)</Label>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1">Para filtrar cuáles marcadores se ven normales y cuáles tenues.</p>
                  <Select value={statusCol} onValueChange={setStatusCol}>
                    <SelectTrigger data-testid="status-col-select-create"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Ninguna</SelectItem>
                      {displayCols.map((h) => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-[#005FB8]" />
                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-700">Rango de filas (opcional)</Label>
                    <span className="ml-auto text-[10px] text-slate-500 font-mono">Total: {totalRows}</span>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1">Incluye solo un rango de filas. Útil para dividir una hoja en varios mapas.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[10px] uppercase text-slate-400 mb-1 block">Desde fila</Label>
                      <Input
                        type="number"
                        min={1}
                        value={rowFrom}
                        onChange={(e) => setRowFrom(e.target.value)}
                        placeholder="1"
                        data-testid="row-from-create-input"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase text-slate-400 mb-1 block">Hasta fila</Label>
                      <Input
                        type="number"
                        min={1}
                        value={rowTo}
                        onChange={(e) => setRowTo(e.target.value)}
                        placeholder={totalRows > 0 ? String(totalRows) : "todas"}
                        data-testid="row-to-create-input"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Columnas visibles en el marcador</Label>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setVisibleCols(displayCols)}>
                      Todas
                    </Button>
                  </div>
                  <div className="max-h-[180px] overflow-auto thin-scroll border border-slate-200 rounded-md">
                    <div className="p-2 space-y-1">
                      {displayCols.map((c) => (
                        <label
                          key={c}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer"
                        >
                          <Checkbox
                            checked={visibleCols.includes(c)}
                            onCheckedChange={() => toggleCol(c)}
                            data-testid={`create-col-${c}`}
                          />
                          <span className="text-sm">{c}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-slate-100 flex-row gap-2 sm:justify-between">
          <div>
            {step > 1 && (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} data-testid="prev-step-btn">
                Atrás
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="cancel-create-btn">
              Cancelar
            </Button>
            {step === 2 && (
              <Button
                onClick={goToStep3}
                disabled={!selectedSheet || gridLoading || loadingHeaders}
                size="sm"
                className="bg-[#005FB8] hover:bg-[#004A94]"
                data-testid="next-to-columns-btn"
              >
                {loadingHeaders && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Continuar
              </Button>
            )}
            {step === 3 && (
              <Button
                onClick={handleCreate}
                disabled={saving || !name.trim() || !latCol || !lngCol}
                size="sm"
                className="bg-[#005FB8] hover:bg-[#004A94]"
                data-testid="confirm-create-map-btn"
              >
                {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Crear mapa
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
