import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MapPin, RotateCcw, Save, X, Navigation } from "lucide-react";

export default function EditPointSheet({ point, headers, latColumn, lngColumn, onClose, onSave, onReset }) {
  const [draft, setDraft] = useState({});

  useEffect(() => {
    if (point) setDraft({ ...(point.data || {}) });
  }, [point]);

  if (!point) return null;

  const editableHeaders = headers.filter((h) => h !== latColumn && h !== lngColumn);

  const handleChange = (h, v) => {
    setDraft((d) => ({ ...d, [h]: v }));
  };

  const handleSave = () => {
    const overrides = {};
    editableHeaders.forEach((h) => {
      const original = point.data?.[h];
      const next = draft[h];
      if ((next ?? "") !== (original ?? "")) {
        overrides[h] = next;
      }
    });
    // Include all edited fields (also include same values if user wants to overwrite — but only changed ones)
    onSave(point.row_index, overrides);
  };

  return (
    <Sheet open={!!point} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col"
        data-testid="edit-point-sheet"
      >
        <SheetHeader className="p-6 border-b border-slate-100 space-y-1">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${point.edited ? "bg-amber-500" : "bg-[#005FB8]"}`}>
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <SheetTitle className="font-heading">Editar punto</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            Fila {point.row_index + 1} · La ubicación ({latColumn}, {lngColumn}) no se puede modificar.
          </SheetDescription>
          <div className="flex gap-2 pt-2">
            <span className="text-xs bg-slate-100 rounded px-2 py-1 font-mono">
              {latColumn}: {point.lat?.toFixed(6)}
            </span>
            <span className="text-xs bg-slate-100 rounded px-2 py-1 font-mono">
              {lngColumn}: {point.lng?.toFixed(6)}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            onClick={() => {
              const url = `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`;
              window.open(url, "_blank", "noopener,noreferrer");
            }}
            data-testid="directions-btn"
          >
            <Navigation className="w-4 h-4 mr-2" /> Cómo llegar (Google Maps)
          </Button>
        </SheetHeader>

        <ScrollArea className="flex-1 thin-scroll">
          <div className="p-6 space-y-4">
            {editableHeaders.map((h) => {
              const val = draft[h] ?? "";
              const stringVal = val === null || val === undefined ? "" : String(val);
              const isLong = stringVal.length > 60;
              return (
                <div key={h} className="space-y-1.5">
                  <Label htmlFor={`field-${h}`} className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {h}
                  </Label>
                  {isLong ? (
                    <Textarea
                      id={`field-${h}`}
                      value={stringVal}
                      onChange={(e) => handleChange(h, e.target.value)}
                      className="resize-none min-h-[80px]"
                      data-testid={`field-${h}`}
                    />
                  ) : (
                    <Input
                      id={`field-${h}`}
                      value={stringVal}
                      onChange={(e) => handleChange(h, e.target.value)}
                      data-testid={`field-${h}`}
                    />
                  )}
                </div>
              );
            })}
            {editableHeaders.length === 0 && (
              <p className="text-sm text-slate-500">No hay columnas editables.</p>
            )}
          </div>
        </ScrollArea>

        <SheetFooter className="p-4 border-t border-slate-100 flex-row gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            {point.edited && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReset(point.row_index)}
                data-testid="reset-point-btn"
              >
                <RotateCcw className="w-4 h-4 mr-1" /> Revertir
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} data-testid="cancel-edit-btn">
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button
              onClick={handleSave}
              size="sm"
              className="bg-[#005FB8] hover:bg-[#004A94]"
              data-testid="save-point-btn"
            >
              <Save className="w-4 h-4 mr-1" /> Guardar
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
