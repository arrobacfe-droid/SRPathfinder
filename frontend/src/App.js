import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "@/pages/LoginPage";
import CallbackPage from "@/pages/CallbackPage";
import DashboardPage from "@/pages/DashboardPage";
import { Toaster } from "@/components/ui/sonner";

const RequireAuth = ({ children }) => {
  const sessionId = localStorage.getItem("session_id");
  if (!sessionId) return <Navigate to="/login" replace />;
  return children;
};

function App() {
  useEffect(() => {
    document.title = "Excel Maps — OneDrive";
  }, []);

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<CallbackPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </div>
  );
}

export default App;
