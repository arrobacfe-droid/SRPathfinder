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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { QRCodeSVG } from "qrcode.react";
import { Copy, RefreshCw, Share2, Loader2, ExternalLink } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function ShareDialog({ open, onOpenChange, map: mapDoc, onMapUpdated }) {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mapDoc) {
      setEnabled(!!mapDoc.is_public);
      setToken(mapDoc.share_token || null);
    }
  }, [mapDoc]);

  const publicUrl = token ? `${window.location.origin}/public/${token}` : "";

  const handleToggle = async (val) => {
    setSaving(true);
    try {
      if (val) {
        const res = await api.post(`/maps/${mapDoc.id}/share`);
        setEnabled(true);
        setToken(res.data.share_token);
        onMapUpdated?.(res.data.map);
        toast.success("Mapa compartido");
      } else {
        await api.delete(`/maps/${mapDoc.id}/share`);
        setEnabled(false);
        onMapUpdated?.({ ...mapDoc, is_public: false });
        toast.success("Compartir deshabilitado");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error");
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    if (!window.confirm("¿Regenerar el link? El link anterior dejará de funcionar.")) return;
    setSaving(true);
    try {
      const res = await api.post(`/maps/${mapDoc.id}/share/rotate`);
      setToken(res.data.share_token);
      toast.success("Nuevo link generado");
    } catch (e) {
      toast.error("Error");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Link copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const downloadQR = () => {
    const svg = document.querySelector("#share-qr-svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${mapDoc?.name || "mapa"}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Share2 className="w-5 h-5 text-[#005FB8]" /> Compartir mapa
          </DialogTitle>
          <DialogDescription className="text-xs">
            Genera un link público (solo lectura) que muestre este mapa. Cualquiera con el link o QR podrá verlo sin iniciar sesión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-slate-50/50">
            <div>
              <Label htmlFor="share-toggle" className="font-medium">Compartir públicamente</Label>
              <p className="text-xs text-slate-500 mt-0.5">Cualquiera con el link puede ver el mapa en modo lectura.</p>
            </div>
            <Switch
              id="share-toggle"
              checked={enabled}
              disabled={saving}
              onCheckedChange={handleToggle}
              data-testid="share-toggle"
            />
          </div>

          {enabled && token && (
            <>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 block">Link público</Label>
                <div className="flex gap-2">
                  <Input value={publicUrl} readOnly className="font-mono text-xs" data-testid="share-url-input" />
                  <Button size="sm" variant="outline" onClick={copy} data-testid="copy-share-btn">
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => window.open(publicUrl, "_blank")} data-testid="open-share-btn">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col items-center bg-white border border-slate-200 rounded-lg p-4">
                <div className="p-3 bg-white rounded-md">
                  <QRCodeSVG
                    id="share-qr-svg"
                    value={publicUrl}
                    size={180}
                    level="M"
                    marginSize={0}
                    fgColor="#0A0A0A"
                    bgColor="#FFFFFF"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-3">Escanea este QR desde cualquier celular para abrir el mapa.</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={downloadQR} data-testid="download-qr-btn">
                  Descargar QR (SVG)
                </Button>
              </div>

              <div className="text-xs bg-amber-50 border border-amber-200 rounded-md p-3 text-amber-800">
                <strong>Nota:</strong> El mapa público usa la última versión que abriste tú (snapshot). Si editas puntos o cambias columnas, abre el mapa en tu dashboard para actualizar el snapshot público.
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <div>
            {enabled && (
              <Button variant="ghost" size="sm" onClick={rotate} disabled={saving} data-testid="rotate-share-btn">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                Regenerar link
              </Button>
            )}
          </div>
          <Button size="sm" onClick={() => onOpenChange(false)} data-testid="close-share-btn">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
