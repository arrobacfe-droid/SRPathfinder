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
import { FileSpreadsheet, Loader2, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function CreateMapDialog({ open, onOpenChange, onCreated }) {
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [headers, setHeaders] = useState([]);
  const [latCol, setLatCol] = useState("");
  const [lngCol, setLngCol] = useState("");
  const [visibleCols, setVisibleCols] = useState([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      // reset
      setTimeout(() => {
        setStep(1);
        setSelectedFile(null);
        setSheets([]);
        setSelectedSheet("");
        setHeaders([]);
        setVisibleCols([]);
        setName("");
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
    setSheetLoading(true);
    try {
      const res = await api.get(`/onedrive/files/${file.id}/sheets`);
      setSheets(res.data.sheets);
      setStep(2);
    } catch (e) {
      toast.error("Error leyendo hojas del Excel");
    } finally {
      setSheetLoading(false);
    }
  };

  const pickSheet = async (sheetName) => {
    setSelectedSheet(sheetName);
    setSheetLoading(true);
    try {
      const res = await api.get(`/onedrive/files/${selectedFile.id}/sheets/${encodeURIComponent(sheetName)}/data`);
      setHeaders(res.data.headers);
      setLatCol(res.data.lat_column);
      setLngCol(res.data.lng_column);
      // Default visible columns: all except lat/lng
      const display = res.data.headers.filter((h) => h !== res.data.lat_column && h !== res.data.lng_column);
      setVisibleCols(display.slice(0, Math.min(4, display.length)));
      setName(`${selectedFile.name.replace(/\.xlsx$/i, "")} · ${sheetName}`);
      setStep(3);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error leyendo datos de la hoja");
    } finally {
      setSheetLoading(false);
    }
  };

  const toggleCol = (c) => {
    setVisibleCols((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await api.post("/maps", {
        name: name.trim() || `Mapa ${selectedSheet}`,
        file_id: selectedFile.id,
        file_name: selectedFile.name,
        sheet_name: selectedSheet,
        visible_columns: visibleCols,
      });
      toast.success("Mapa creado");
      onCreated(res.data);
    } catch (e) {
      toast.error("Error al crear mapa");
    } finally {
      setSaving(false);
    }
  };

  const displayCols = headers.filter((h) => h !== latCol && h !== lngCol);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden" data-testid="create-map-dialog">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="font-heading text-xl">Nuevo mapa desde Excel</DialogTitle>
          <DialogDescription className="text-xs">
            Paso {step} de 3 · {step === 1 ? "Elige un archivo .xlsx" : step === 2 ? "Selecciona una hoja" : "Configura las columnas visibles"}
          </DialogDescription>

          <div className="flex items-center gap-1 pt-3">
            {[1,2,3].map((i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-[#005FB8]" : "bg-slate-200"}`} />
            ))}
          </div>
        </DialogHeader>

        <div className="px-6 pb-2 min-h-[300px] max-h-[60vh] overflow-hidden flex flex-col">
          {/* Step 1: file picker */}
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
                      disabled={sheetLoading}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#005FB8] hover:bg-[#005FB8]/5 transition-all text-left"
                      data-testid={`file-${f.id}`}
                    >
                      <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{f.name}</p>
                        <p className="text-xs text-slate-500">
                          {f.size ? `${(f.size / 1024).toFixed(1)} KB` : ""}{" "}· {new Date(f.modified).toLocaleDateString()}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}

          {/* Step 2: sheet picker */}
          {step === 2 && (
            <div className="flex-1 overflow-auto py-2">
              {sheetLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-[#005FB8]" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500 mb-2">Archivo: <span className="font-medium text-slate-800">{selectedFile?.name}</span></p>
                  {sheets.map((s) => (
                    <button
                      key={s}
                      onClick={() => pickSheet(s)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#005FB8] hover:bg-[#005FB8]/5 transition-all text-left"
                      data-testid={`sheet-${s}`}
                    >
                      <div className="w-8 h-8 bg-slate-100 rounded-md flex items-center justify-center text-xs font-mono">
                        #{sheets.indexOf(s) + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{s}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: columns */}
          {step === 3 && (
            <div className="space-y-4 py-2 overflow-auto flex-1">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Nombre del mapa</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="map-name-input" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Latitud</p>
                  <p className="text-sm font-mono">{latCol}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Longitud</p>
                  <p className="text-sm font-mono">{lngCol}</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Columnas a mostrar en el mapa</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setVisibleCols(displayCols)}
                  >
                    Seleccionar todo
                  </Button>
                </div>
                <ScrollArea className="max-h-[200px] thin-scroll border border-slate-200 rounded-md">
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
                </ScrollArea>
              </div>
            </div>
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
            {step === 3 && (
              <Button
                onClick={handleCreate}
                disabled={saving || !name.trim()}
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
