import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { client, type Features, type User } from "./api";

interface AuthState {
  user: User | null;
  features: Features | null;
  links: { google: boolean; github: boolean } | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [links, setLinks] = useState<{ google: boolean; github: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await client.me();
    setUser(data.user);
    setFeatures(data.features ?? null);
    setLinks(data.links ?? null);
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    await client.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, features, links, loading, refresh, logout }),
    [user, features, links, loading, refresh, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
