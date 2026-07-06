import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Map, Layers, Cloud, MoveRight } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  const connectMicrosoft = async () => {
    setLoading(true);
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const res = await api.get("/auth/microsoft/url", { params: { redirect_uri: redirectUri } });
      window.location.href = res.data.url;
    } catch (e) {
      console.error(e);
      toast.error("No se pudo iniciar la autenticación con Microsoft");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 flex flex-col lg:flex-row" data-testid="login-page">
      {/* Left brand panel */}
      <div className="lg:w-1/2 flex flex-col justify-between p-10 lg:p-16 bg-white border-r border-slate-200 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
             style={{ backgroundImage: "linear-gradient(to right, #0a0a0a 1px, transparent 1px), linear-gradient(to bottom, #0a0a0a 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-12">
            <div className="w-9 h-9 bg-[#005FB8] rounded-md flex items-center justify-center">
              <Map className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-heading font-bold text-xl tracking-tight">S.R.Pathfinder</span>
          </div>

          <div className="max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">
              OneDrive · Excel · Maps
            </p>
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tight font-bold text-slate-950 leading-[1.05] mb-6">
              Tus hojas de Excel,<br/>
              <span className="text-[#005FB8]">trazadas en el mapa.</span>
            </h1>
            <p className="text-base leading-relaxed text-slate-600 mb-10">
              Conecta tu OneDrive, elige cualquier libro de Excel y convierte cada hoja en una ruta independiente.
              Edita los datos de cada punto sin perder su ubicación.
            </p>

            <Button
              onClick={connectMicrosoft}
              disabled={loading}
              size="lg"
              className="bg-[#005FB8] hover:bg-[#004A94] text-white rounded-md px-6 py-6 text-base font-medium group"
              data-testid="ms-login-btn"
            >
              <Cloud className="w-5 h-5 mr-2" />
              {loading ? "Conectando..." : "Conectar con Microsoft"}
              <MoveRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
            <p className="text-xs text-slate-500 mt-4 max-w-sm">
              Iniciarás sesión con tu cuenta personal o de trabajo. Solo solicitamos permisos de lectura sobre tus archivos.
            </p>
          </div>
        </div>

        <div className="relative z-10 text-xs text-slate-400 font-mono">
          v1.0 · Powered by Microsoft Graph + Google Maps
        </div>
      </div>

      {/* Right preview panel */}
      <div className="lg:w-1/2 bg-slate-950 flex items-center justify-center p-10 lg:p-16 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]"
             style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        <div className="relative max-w-md text-white">
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[1,2,3,4,5,6,7,8,9].map((i) => (
              <div key={i} className="aspect-square rounded-lg border border-white/10 fade-up flex items-center justify-center"
                style={{ animationDelay: `${i * 60}ms`, background: i % 4 === 0 ? "#005FB8" : "transparent" }}>
                {i % 4 === 0 && <Layers className="w-5 h-5 text-white" />}
              </div>
            ))}
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40 mb-3">Workflow</p>
          <h2 className="font-heading text-3xl font-semibold tracking-tight mb-3">
            Una hoja → un mapa
          </h2>
          <p className="text-sm text-white/60 leading-relaxed">
            Cada hoja de tu libro Excel se convierte en una ruta distinta. Elige qué columnas mostrar en cada marcador y edita la información sin tocar la geometría.
          </p>
        </div>
      </div>
    </div>
  );
}
