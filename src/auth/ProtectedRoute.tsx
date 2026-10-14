import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { Role } from "../lib/types";

export function Splash() {
  return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm font-medium text-slate-400">Chargement…</div>;
}

/** Wrap any element that requires a session. Optionally restrict to a role. */
export default function ProtectedRoute({ children, role }: { children: ReactNode; role?: Role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
