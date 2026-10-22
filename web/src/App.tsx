import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-screen">
        <p className="muted">読み込み中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
