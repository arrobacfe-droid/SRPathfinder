import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  UploadCloud,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

/**
 * Batch update: user uploads a new .xlsx once, then applies it to all selected maps.
 * All selected maps become source="upload" with the new file_id.
 */
export default function BatchUpdateDialog({ open, onOpenChange, maps, onDone }) {
  const [selected, setSelected] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null); // {id, filename, size}
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setSelected(new Set());
        setUploadedFile(null);
      }, 200);
    }
  }, [open]);

  // Only owner maps can be batch-refreshed (backend rejects others)
  const eligibleMaps = (maps || []).filter((m) => m.is_owner);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === eligibleMaps.length) setSelected(new Set());
    else setSelected(new Set(eligibleMaps.map((m) => m.id)));
  };

  const handleFile = async (event) => {
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
      setUploadedFile(res.data);
      toast.success(`${res.data.filename} subido — listo para aplicar`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al subir");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const apply = async () => {
    if (!uploadedFile || selected.size === 0) return;
    setApplying(true);
    try {
      const res = await api.post("/maps/batch-refresh-source", {
        map_ids: [...selected],
        upload_id: uploadedFile.id,
      });
      toast.success(`${res.data.updated} mapa(s) actualizado(s)`);
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al aplicar");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden" data-testid="batch-update-dialog">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="font-heading flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-[#005FB8]" /> Actualizar mapas en lote
          </DialogTitle>
          <DialogDescription className="text-xs">
            Sube un nuevo archivo .xlsx y aplícalo a varios mapas a la vez. Todos los mapas seleccionados apuntarán al archivo nuevo (los datos se refrescan).
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-2 flex-1 overflow-hidden flex flex-col gap-4">
          {/* Upload area */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 block">Paso 1 · Sube el nuevo archivo</Label>
            {uploadedFile ? (
              <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{uploadedFile.filename}</p>
                  <p className="text-xs text-emerald-700">
                    {(uploadedFile.size / 1024).toFixed(1)} KB · Archivo subido correctamente
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setUploadedFile(null); fileInputRef.current?.click(); }}
                  data-testid="reupload-btn"
                >
                  Cambiar
                </Button>
                <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-slate-300 hover:border-[#005FB8] hover:bg-[#005FB8]/5 rounded-lg p-5 cursor-pointer transition-colors text-center"
                onClick={() => fileInputRef.current?.click()}
                data-testid="batch-upload-dropzone"
              >
                {uploading ? (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <Loader2 className="w-5 h-5 animate-spin text-[#005FB8]" />
                    <span className="text-sm text-slate-600">Subiendo archivo...</span>
                  </div>
                ) : (
                  <>
                    <UploadCloud className="w-8 h-8 text-[#005FB8] mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-800">Click para elegir un .xlsx</p>
                    <p className="text-xs text-slate-500 mt-0.5">Máx. 15 MB</p>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
              </div>
            )}
          </div>

          <Separator />

          {/* Maps selection */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Paso 2 · Elige los mapas a actualizar</Label>
              {eligibleMaps.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleAll}
                  className="h-6 text-xs"
                  data-testid="toggle-all-maps-btn"
                >
                  {selected.size === eligibleMaps.length ? "Ninguno" : "Todos"}
                </Button>
              )}
            </div>

            {eligibleMaps.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No tienes mapas propios para actualizar.</p>
            ) : (
              <div className="flex-1 side-scroll border border-slate-200 rounded-lg" style={{ minHeight: "180px", maxHeight: "320px" }}>
                <div className="p-2 space-y-1">
                  {eligibleMaps.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-50 cursor-pointer"
                      data-testid={`batch-map-${m.id}`}
                    >
                      <Checkbox
                        checked={selected.has(m.id)}
                        onCheckedChange={() => toggle(m.id)}
                      />
                      <FileSpreadsheet className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        <p className="text-xs text-slate-500 truncate">
                          <span className="font-mono">{m.file_name}</span> · {m.sheet_name}
                          {m.source === "upload" && <span className="ml-1 text-[10px] uppercase text-blue-600">upload</span>}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[10px] text-slate-500 mt-2">
              💡 Los rangos de filas, columnas geo y demás configuración de cada mapa se conservan. Solo cambia el archivo fuente.
            </p>
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-slate-100 flex-row gap-2 sm:justify-between">
          <div className="text-xs text-slate-500 self-center">
            {selected.size} seleccionado(s)
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="batch-cancel-btn">
              Cancelar
            </Button>
            <Button
              onClick={apply}
              disabled={!uploadedFile || selected.size === 0 || applying}
              size="sm"
              className="bg-[#005FB8] hover:bg-[#004A94]"
              data-testid="batch-apply-btn"
            >
              {applying && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Aplicar a {selected.size} mapa{selected.size === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
