import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { setCurrency } from "../lib/format";
import { DEFAULT_SETTINGS, type Role, type Settings, type User } from "../lib/types";

type Status = { needsSetup: boolean; shopName: string | null };
type AuthState = {
  user: User | null;
  shopName: string;
  needsSetup: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { shopName?: string; name: string; email: string; password: string; role: Role }) => Promise<{ loggedIn: boolean; recoveryCode?: string }>;
  refreshSession: () => Promise<void>;
  settings: Settings;
  refreshSettings: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>({ needsSetup: false, shopName: null });
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const refreshSettings = useCallback(async () => {
    const s = await api.get<Settings>("/settings").catch(() => null);
    if (s) { setCurrency(s.currency); setSettings(s); } // currency first: components re-render right after
  }, []);

  const refresh = useCallback(async () => {
    const [st, me] = await Promise.all([
      api.get<Status>("/auth/status").catch(() => ({ needsSetup: false, shopName: null })),
      api.get<{ user: User; shopName: string | null }>("/auth/me").catch(() => null),
    ]);
    if (me?.user) await refreshSettings();
    setStatus({ needsSetup: st.needsSetup, shopName: me?.shopName ?? st.shopName });
    setUser(me?.user ?? null);
    setLoading(false);
  }, [refreshSettings]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener("ims-auth-expired", expired);
    return () => window.removeEventListener("ims-auth-expired", expired);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    shopName: status.shopName ?? "Imprimerie",
    needsSetup: status.needsSetup,
    loading,
    async login(email, password) {
      await api.post("/auth/login", { email, password });
      await refresh();
    },
    async signup(input) {
      const res = await api.post<{ loggedIn: boolean; recoveryCode?: string }>("/auth/signup", input);
      // The first owner must see their recovery code before entering the app: the page calls refreshSession() afterwards.
      if (!res.recoveryCode) await refresh(); // an owner adding staff stays logged in as owner
      return res;
    },
    refreshSession: refresh,
    settings,
    refreshSettings,
    async logout() {
      await api.post("/auth/logout");
      setUser(null);
    },
  }), [user, status, loading, refresh, settings, refreshSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
