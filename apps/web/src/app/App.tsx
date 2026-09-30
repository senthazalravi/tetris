import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { LandingPage } from "@/auth/LandingPage";
import { RegisterPage } from "@/auth/RegisterPage";
import { LoginPage } from "@/auth/LoginPage";
import { UnlockPage } from "@/auth/UnlockPage";
import { ChatShell } from "@/chat/ChatShell";
import { ThemeProvider } from "@/theme/ThemeProvider";

function BootGate({ children }: { children: React.ReactNode }) {
  const { bootState } = useAuth();
  if (bootState === "loading") {
    return (
      <div className="flex min-h-full items-center justify-center bg-background text-secondary-darker">
        Loading Lop…
      </div>
    );
  }
  return children;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { session, unlockState } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (unlockState !== "unlocked") return <Navigate to="/unlock" replace />;
  return children;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { session, unlockState } = useAuth();
  if (session && unlockState === "unlocked") {
    return <Navigate to="/app" replace />;
  }
  if (session && unlockState === "required") {
    return <Navigate to="/unlock" replace />;
  }
  return children;
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BootGate>
          <Routes>
            <Route
              path="/"
              element={
                <PublicOnly>
                  <LandingPage />
                </PublicOnly>
              }
            />
            <Route
              path="/register"
              element={
                <PublicOnly>
                  <RegisterPage />
                </PublicOnly>
              }
            />
            <Route
              path="/login"
              element={
                <PublicOnly>
                  <LoginPage />
                </PublicOnly>
              }
            />
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
        </BootGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
