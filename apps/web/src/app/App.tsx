import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { LandingPage } from "@/auth/LandingPage";
import { RegisterPage } from "@/auth/RegisterPage";
import { LoginPage } from "@/auth/LoginPage";
import { UnlockPage } from "@/auth/UnlockPage";
import { ChatShell } from "@/chat/ChatShell";

function Protected({ children }: { children: React.ReactNode }) {
  const { session, unlockState } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (unlockState !== "unlocked") return <Navigate to="/unlock" replace />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/unlock" element={<UnlockPage />} />
        <Route
          path="/app/*"
          element={
            <Protected>
              <ChatShell />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
