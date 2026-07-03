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
import { Separator } from "@/components/ui/separator";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy,
  RefreshCw,
  Share2,
  Loader2,
  ExternalLink,
  UserPlus,
  X,
  Users,
  Globe,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function ShareDialog({ open, onOpenChange, map: mapDoc, onMapUpdated }) {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState(null);
  const [saving, setSaving] = useState(false);

  // Editors
  const [editors, setEditors] = useState([]);
  const [ownerInfo, setOwnerInfo] = useState({ email: null, display_name: null });
  const [isOwner, setIsOwner] = useState(true);
  const [editorEmail, setEditorEmail] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);

  useEffect(() => {
    if (mapDoc && open) {
      setEnabled(!!mapDoc.is_public);
      setToken(mapDoc.share_token || null);
      loadEditors();
    }
  }, [mapDoc, open]);

  const loadEditors = async () => {
    if (!mapDoc?.id) return;
    try {
      const res = await api.get(`/maps/${mapDoc.id}/editors`);
      setEditors(res.data.editors || []);
      setOwnerInfo({ email: res.data.owner_email, display_name: res.data.owner_display_name });
      setIsOwner(!!res.data.is_owner);
    } catch (e) { /* ignore */ }
  };

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

  const addEditor = async () => {
    const email = editorEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast.error("Ingresa un email válido");
      return;
    }
    setEditorLoading(true);
    try {
      const res = await api.post(`/maps/${mapDoc.id}/editors`, { email });
      setEditors(res.data.editors);
      setEditorEmail("");
      toast.success(`${email} agregado como editor`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "No se pudo agregar");
    } finally {
      setEditorLoading(false);
    }
  };

  const removeEditor = async (email) => {
    try {
      const res = await api.delete(`/maps/${mapDoc.id}/editors/${encodeURIComponent(email)}`);
      setEditors(res.data.editors);
      toast.success("Editor eliminado");
    } catch (e) {
      toast.error("Error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto thin-scroll" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Share2 className="w-5 h-5 text-[#005FB8]" /> Compartir mapa
          </DialogTitle>
          <DialogDescription className="text-xs">
            Comparte este mapa con otras personas mediante link público (solo lectura) o dales acceso de edición por email.
          </DialogDescription>
        </DialogHeader>

        {/* ============ Public share ============ */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#005FB8]" />
            <h3 className="font-semibold text-sm">Link público (solo lectura)</h3>
          </div>

          <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-slate-50/50">
            <div>
              <Label htmlFor="share-toggle" className="font-medium text-sm">Compartir públicamente</Label>
              <p className="text-xs text-slate-500 mt-0.5">Cualquiera con el link o QR puede ver el mapa.</p>
            </div>
            <Switch
              id="share-toggle"
              checked={enabled}
              disabled={saving || !isOwner}
              onCheckedChange={handleToggle}
              data-testid="share-toggle"
            />
          </div>

          {!isOwner && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              Solo el dueño del mapa puede modificar el compartir público.
            </p>
          )}

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
                    size={160}
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

              {isOwner && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={rotate} disabled={saving} data-testid="rotate-share-btn">
                    {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                    Regenerar link
                  </Button>
                </div>
              )}

              <div className="text-xs bg-amber-50 border border-amber-200 rounded-md p-3 text-amber-800">
                <strong>Nota:</strong> El link público muestra la última versión que se abrió en el dashboard. Abre el mapa en tu dashboard para actualizar el snapshot público.
              </div>
            </>
          )}
        </section>

        <Separator />

        {/* ============ Editors ============ */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#005FB8]" />
            <h3 className="font-semibold text-sm">Editores (acceso de edición)</h3>
          </div>
          <p className="text-xs text-slate-500">
            Las personas invitadas verán este mapa en su dashboard y podrán editar puntos, columnas y filtros.
            {" "}
            <span className="text-slate-700 font-medium">Solo el dueño</span> puede eliminar el mapa o gestionar acceso.
          </p>

          {ownerInfo.email && (
            <div className="flex items-center gap-2 p-2 rounded-md bg-[#005FB8]/5 border border-[#005FB8]/20">
              <div className="w-7 h-7 rounded-full bg-[#005FB8] text-white flex items-center justify-center text-xs font-semibold">
                {(ownerInfo.display_name || ownerInfo.email).slice(0,1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{ownerInfo.display_name || ownerInfo.email}</p>
                <p className="text-[10px] text-slate-500 truncate">{ownerInfo.email}</p>
              </div>
              <span className="text-[10px] font-semibold bg-[#005FB8] text-white px-2 py-0.5 rounded-full uppercase tracking-wide">Dueño</span>
            </div>
          )}

          {isOwner && (
            <div className="flex gap-2">
              <Input
                type="email"
                value={editorEmail}
                onChange={(e) => setEditorEmail(e.target.value)}
                placeholder="editor@ejemplo.com"
                onKeyDown={(e) => e.key === "Enter" && addEditor()}
                data-testid="editor-email-input"
              />
              <Button
                onClick={addEditor}
                size="sm"
                disabled={editorLoading}
                className="bg-[#005FB8] hover:bg-[#004A94] whitespace-nowrap"
                data-testid="add-editor-btn"
              >
                {editorLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
                Invitar
              </Button>
            </div>
          )}

          {editors.length > 0 ? (
            <div className="space-y-1">
              {editors.map((email) => (
                <div key={email} className="flex items-center gap-2 p-2 rounded-md bg-slate-50 border border-slate-200">
                  <div className="w-6 h-6 rounded-full bg-slate-300 text-white flex items-center justify-center text-[10px] font-semibold">
                    {email.slice(0,1).toUpperCase()}
                  </div>
                  <span className="text-xs flex-1 truncate">{email}</span>
                  <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-wide">Editor</span>
                  {isOwner && (
                    <button
                      onClick={() => removeEditor(email)}
                      className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                      data-testid={`remove-editor-${email}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-2 text-center">Aún no hay editores invitados.</p>
          )}

          {isOwner && editors.length > 0 && (
            <p className="text-[10px] text-slate-500 italic">
              💡 Los editores deben iniciar sesión con la misma cuenta Microsoft cuyo email agregaste.
            </p>
          )}
        </section>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)} data-testid="close-share-btn">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
