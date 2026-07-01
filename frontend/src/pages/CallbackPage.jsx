import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const code = params.get("code");
    const state = params.get("state");
    const errParam = params.get("error_description") || params.get("error");
    if (errParam) {
      setError(errParam);
      return;
    }
    if (!code || !state) {
      setError("Falta el parámetro code o state");
      return;
    }
    api
      .post("/auth/microsoft/callback", { code, state })
      .then((res) => {
        localStorage.setItem("session_id", res.data.session_id);
        localStorage.setItem("user", JSON.stringify(res.data.user));
        navigate("/", { replace: true });
      })
      .catch((e) => {
        setError(e.response?.data?.detail || e.message);
      });
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6" data-testid="callback-page">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
        {!error ? (
          <>
            <Loader2 className="w-10 h-10 mx-auto text-[#005FB8] animate-spin mb-4" />
            <h2 className="font-heading text-xl font-semibold mb-2">Finalizando autenticación...</h2>
            <p className="text-sm text-slate-500">Conectando con tu cuenta de Microsoft.</p>
          </>
        ) : (
          <>
            <AlertTriangle className="w-10 h-10 mx-auto text-rose-500 mb-4" />
            <h2 className="font-heading text-xl font-semibold mb-2">No se pudo iniciar sesión</h2>
            <p className="text-sm text-slate-500 mb-6 break-words">{error}</p>
            <Button onClick={() => navigate("/login")} data-testid="retry-login-btn">Volver al inicio</Button>
          </>
        )}
      </div>
    </div>
  );
}
