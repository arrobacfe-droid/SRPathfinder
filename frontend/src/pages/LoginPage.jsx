import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Map, Layers, Cloud, MoveRight, User, LogIn, UserPlus, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  // Local auth
  const [mode, setMode] = useState("login"); // "login" or "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [localLoading, setLocalLoading] = useState(false);

  const connectMicrosoft = async () => {
    setLoading(true);
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const res = await api.get("/auth/microsoft/url", { params: { redirect_uri: redirectUri } });
      window.location.href = res.data.url;
    } catch (e) {
      toast.error("No se pudo iniciar la autenticación con Microsoft");
      setLoading(false);
    }
  };

  const submitLocal = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Ingresa email y contraseña");
      return;
    }
    setLocalLoading(true);
    try {
      const url = mode === "signup" ? "/auth/local/signup" : "/auth/local/login";
      const body = mode === "signup"
        ? { email, password, display_name: displayName || undefined }
        : { email, password };
      const res = await api.post(url, body);
      localStorage.setItem("session_id", res.data.session_id);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      window.location.href = "/";
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Error de autenticación");
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 flex flex-col lg:flex-row" data-testid="login-page">
      {/* Left panel */}
      <div className="lg:w-1/2 flex flex-col justify-between p-8 lg:p-14 bg-white border-r border-slate-200 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
             style={{ backgroundImage: "linear-gradient(to right, #0a0a0a 1px, transparent 1px), linear-gradient(to bottom, #0a0a0a 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-[#005FB8] rounded-md flex items-center justify-center">
              <Map className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-heading font-bold text-xl tracking-tight">S.R.Pathfinder</span>
          </div>

          <div className="max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-3">
              OneDrive · Excel · Maps
            </p>
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tight font-bold text-slate-950 leading-[1.05] mb-4">
              Tus hojas de Excel,<br/>
              <span className="text-[#005FB8]">trazadas en el mapa.</span>
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 mb-6">
              Conecta OneDrive o crea una cuenta local para subir tus Excel y visualizarlos como rutas en Google Maps.
            </p>

            {/* Auth Tabs */}
            <Tabs defaultValue="microsoft" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="microsoft" data-testid="tab-microsoft">
                  <Cloud className="w-4 h-4 mr-1.5" /> Microsoft
                </TabsTrigger>
                <TabsTrigger value="local" data-testid="tab-local">
                  <User className="w-4 h-4 mr-1.5" /> Cuenta local
                </TabsTrigger>
              </TabsList>

              <TabsContent value="microsoft" className="mt-0 space-y-3">
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
                  <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                    Accede con tu cuenta Microsoft para importar archivos directamente desde tu OneDrive.
                  </p>
                  <Button
                    onClick={connectMicrosoft}
                    disabled={loading}
                    size="lg"
                    className="w-full bg-[#005FB8] hover:bg-[#004A94] text-white group"
                    data-testid="ms-login-btn"
                  >
                    <Cloud className="w-4 h-4 mr-2" />
                    {loading ? "Conectando..." : "Conectar con Microsoft"}
                    <MoveRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="local" className="mt-0">
                <form onSubmit={submitLocal} className="space-y-3">
                  <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-3">
                    {mode === "signup" && (
                      <div>
                        <Label htmlFor="displayName" className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Nombre</Label>
                        <Input
                          id="displayName"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Tu nombre"
                          data-testid="local-name-input"
                        />
                      </div>
                    )}
                    <div>
                      <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="tucorreo@ejemplo.com"
                        required
                        data-testid="local-email-input"
                      />
                    </div>
                    <div>
                      <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Contraseña</Label>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={mode === "signup" ? "Mínimo 8 caracteres" : "Contraseña"}
                        required
                        data-testid="local-password-input"
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={localLoading}
                      className="w-full bg-[#005FB8] hover:bg-[#004A94] text-white"
                      data-testid="local-submit-btn"
                    >
                      {localLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : mode === "signup" ? (
                        <UserPlus className="w-4 h-4 mr-2" />
                      ) : (
                        <LogIn className="w-4 h-4 mr-2" />
                      )}
                      {mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode(mode === "signup" ? "login" : "signup")}
                    className="w-full text-xs text-slate-500 hover:text-[#005FB8] transition-colors"
                    data-testid="toggle-signup-btn"
                  >
                    {mode === "signup" ? "¿Ya tienes cuenta? Inicia sesión" : "¿No tienes cuenta? Regístrate"}
                  </button>
                </form>
                <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
                  Las cuentas locales guardan tus archivos Excel directamente en la app. No dependen de OneDrive.
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <div className="relative z-10 text-xs text-slate-400 font-mono">
          v1.2 · Microsoft Graph + Google Maps + Cuentas locales
        </div>
      </div>

      {/* Right panel */}
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
            Cada hoja de tu libro Excel se convierte en una ruta distinta. Comparte por link, escanea con QR, y actualiza todos tus mapas con un solo re-upload.
          </p>
        </div>
      </div>
    </div>
  );
}
