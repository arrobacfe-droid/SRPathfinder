import { useEffect, useState, useRef } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  FileSpreadsheet,
  Loader2,
  ChevronRight,
  MapPin,
  Info,
  Filter,
  SlidersHorizontal,
  UploadCloud,
  Trash2,
  Cloud,
  HardDrive,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import SheetGridPicker from "@/components/SheetGridPicker";

export default function CreateMapDialog({ open, onOpenChange, onCreated }) {
  const [step, setStep] = useState(1);
  const [source, setSource] = useState("onedrive"); // "onedrive" or "upload"

  // Step 1 - OneDrive
  const [odFiles, setOdFiles] = useState([]);
  const [odLoading, setOdLoading] = useState(false);
  // Step 1 - Uploads
  const [upFiles, setUpFiles] = useState([]);
  const [upLoading, setUpLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [selectedFile, setSelectedFile] = useState(null);
  // Step 2
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [grid, setGrid] = useState([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [headerRow, setHeaderRow] = useState(1);
  const [firstCol, setFirstCol] = useState(1);
  // Step 3
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

  const basePath = source === "upload" ? "/uploads/files" : "/onedrive/files";

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(1);
        setSource("onedrive");
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
    loadOneDrive();
    loadUploads();
  }, [open]);

  const loadOneDrive = async () => {
    setOdLoading(true);
    try {
      const res = await api.get("/onedrive/files");
      setOdFiles(res.data.files || []);
    } catch (e) {
      // Non-blocking: user can still use upload
      setOdFiles([]);
    } finally {
      setOdLoading(false);
    }
  };

  const loadUploads = async () => {
    setUpLoading(true);
    try {
      const res = await api.get("/uploads/files");
      setUpFiles(res.data.files || []);
    } catch (e) {
      setUpFiles([]);
    } finally {
      setUpLoading(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Solo se aceptan archivos .xlsx");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Archivo demasiado grande (máx. 15 MB)");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post("/uploads/excel", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`${res.data.filename} subido`);
      await loadUploads();
      // Auto-select the freshly uploaded file
      pickFile({ ...res.data, name: res.data.filename }, "upload");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al subir");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const pickFile = async (file, src) => {
    const chosenSource = src || source;
    setSource(chosenSource);
    setSelectedFile(file);
    setGridLoading(true);
    try {
      const path = chosenSource === "upload" ? "/uploads/files" : "/onedrive/files";
      const res = await api.get(`${path}/${file.id}/sheets`);
      setSheets(res.data.sheets);
      if (res.data.sheets.length > 0) {
        await pickSheet(file.id, res.data.sheets[0], chosenSource);
      }
      setStep(2);
    } catch (e) {
      toast.error("Error leyendo hojas del Excel");
    } finally {
      setGridLoading(false);
    }
  };

  const pickSheet = async (fileId, sheetName, src) => {
    const chosenSource = src || source;
    setSelectedSheet(sheetName);
    setGridLoading(true);
    try {
      const path = chosenSource === "upload" ? "/uploads/files" : "/onedrive/files";
      const res = await api.get(
        `${path}/${fileId}/sheets/${encodeURIComponent(sheetName)}/preview`,
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
        `${basePath}/${selectedFile.id}/sheets/${encodeURIComponent(selectedSheet)}/data`,
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
      const fname = selectedFile.name || selectedFile.filename || "";
      if (!name) setName(`${fname.replace(/\.xlsx$/i, "")} · ${selectedSheet}`);
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
      const fname = selectedFile.name || selectedFile.filename || "archivo.xlsx";
      const res = await api.post("/maps", {
        name: name.trim() || `Mapa ${selectedSheet}`,
        source,
        file_id: selectedFile.id,
        file_name: fname,
        sheet_name: selectedSheet,
        lat_column: latCol,
        lng_column: lngCol,
        visible_columns: visibleCols,
        header_row: Math.max(1, Number(headerRow) || 1),
        first_col: Math.max(1, Number(firstCol) || 1),
        status_column: statusCol === "__none__" ? null : statusCol,
        status_visible_values: [],
        data_row_from: rowFrom === "" ? null : Math.max(1, Number(rowFrom) || 1),
        data_row_to: rowTo === "" ? null : Math.max(1, Number(rowTo) || 1),
      });
      toast.success("Mapa creado");
      onCreated(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al crear mapa");
    } finally {
      setSaving(false);
    }
  };

  const deleteUpload = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("¿Eliminar este archivo subido? Los mapas creados desde él dejarán de funcionar.")) return;
    try {
      await api.delete(`/uploads/files/${id}`);
      toast.success("Archivo eliminado");
      loadUploads();
    } catch (err) {
      toast.error("Error al eliminar");
    }
  };

  const displayCols = headers.filter((h) => h !== latCol && h !== lngCol);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 overflow-hidden" data-testid="create-map-dialog">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="font-heading text-xl">Nuevo mapa desde Excel</DialogTitle>
          <DialogDescription className="text-xs">
            Paso {step} de 3 · {step === 1 ? "Elige el origen del archivo" : step === 2 ? "Selecciona hoja y rango de datos" : "Configura columnas"}
          </DialogDescription>

          <div className="flex items-center gap-1 pt-3">
            {[1,2,3].map((i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-[#005FB8]" : "bg-slate-200"}`} />
            ))}
          </div>
        </DialogHeader>

        <div className="px-6 pb-2 min-h-[400px] max-h-[70vh] overflow-hidden flex flex-col">
          {/* Step 1: source picker */}
          {step === 1 && (
            <Tabs value={source} onValueChange={setSource} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="grid w-full grid-cols-2 mb-3">
                <TabsTrigger value="onedrive" data-testid="tab-onedrive">
                  <Cloud className="w-4 h-4 mr-1.5" /> OneDrive
                </TabsTrigger>
                <TabsTrigger value="upload" data-testid="tab-upload">
                  <HardDrive className="w-4 h-4 mr-1.5" /> Subir desde mi dispositivo
                </TabsTrigger>
              </TabsList>

              <TabsContent value="onedrive" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full -mx-1 px-1 thin-scroll">
                  {odLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-[#005FB8]" />
                    </div>
                  ) : odFiles.length === 0 ? (
                    <div className="text-center py-8">
                      <Cloud className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm text-slate-500 mb-1">No se encontraron archivos .xlsx en tu OneDrive.</p>
                      <p className="text-xs text-slate-400 mb-4">Puede que tu OneDrive no tenga archivos Excel o que la sesión haya expirado.</p>
                      <div className="flex gap-2 justify-center">
                        <Button variant="outline" size="sm" onClick={loadOneDrive} data-testid="reload-onedrive-btn">
                          <Loader2 className={`w-4 h-4 mr-1 ${odLoading ? "animate-spin" : ""}`} /> Reintentar
                        </Button>
                        <Button size="sm" onClick={() => setSource("upload")} className="bg-[#005FB8] hover:bg-[#004A94]" data-testid="switch-to-upload-btn">
                          <UploadCloud className="w-4 h-4 mr-1" /> Subir desde dispositivo
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 py-2">
                      {odFiles.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => pickFile(f, "onedrive")}
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
              </TabsContent>

              <TabsContent value="upload" className="flex-1 overflow-hidden mt-0">
                <div className="flex flex-col h-full gap-3">
                  {/* Upload zone */}
                  <div
                    className="border-2 border-dashed border-slate-300 hover:border-[#005FB8] hover:bg-[#005FB8]/5 rounded-lg p-6 cursor-pointer transition-colors text-center"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="upload-dropzone"
                  >
                    {uploading ? (
                      <div className="flex items-center justify-center gap-2 py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-[#005FB8]" />
                        <span className="text-sm text-slate-600">Subiendo archivo...</span>
                      </div>
                    ) : (
                      <>
                        <UploadCloud className="w-10 h-10 text-[#005FB8] mx-auto mb-2" />
                        <p className="text-sm font-medium text-slate-800">Haz click o arrastra un archivo .xlsx aquí</p>
                        <p className="text-xs text-slate-500 mt-1">Máximo 15 MB · Solo formato .xlsx</p>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={handleFileUpload}
                      data-testid="file-input"
                    />
                  </div>

                  {/* Existing uploads */}
                  <div className="flex-1 overflow-hidden">
                    <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Archivos subidos previamente</p>
                    <ScrollArea className="h-[calc(100%-24px)] thin-scroll">
                      {upLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-[#005FB8]" />
                        </div>
                      ) : upFiles.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-4">Aún no has subido ningún archivo.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {upFiles.map((f) => (
                            <div
                              key={f.id}
                              className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#005FB8] hover:bg-[#005FB8]/5 transition-all"
                            >
                              <button
                                onClick={() => pickFile(f, "upload")}
                                className="flex-1 flex items-center gap-3 text-left min-w-0"
                                data-testid={`upload-file-${f.id}`}
                              >
                                <FileSpreadsheet className="w-5 h-5 text-blue-600 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{f.filename}</p>
                                  <p className="text-xs text-slate-500">
                                    {(f.size / 1024).toFixed(1)} KB · {new Date(f.created_at).toLocaleDateString()}
                                  </p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              </button>
                              <button
                                onClick={(e) => deleteUpload(f.id, e)}
                                className="p-1 hover:bg-rose-50 rounded transition-colors text-slate-400 hover:text-rose-600"
                                data-testid={`delete-upload-${f.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
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

          {/* Step 3 */}
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
